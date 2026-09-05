const test = require('node:test');
const assert = require('node:assert/strict');
const create = require('../cabinet-progress.js');
function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {get length() {return data.size;}, key:i=>[...data.keys()][i],
    getItem:k=>data.get(k) ?? null, setItem:(k,v)=>data.set(k,String(v)), removeItem:k=>data.delete(k)};
}
function setup() {
  let row = {sa_read:'["preface"]',sa_display_name:'Name',sa_tour_seen:'1'};
  let failRead=false, failWrite=false;
  const session = {user:{id:'account-a',email:'test@example.invalid',user_metadata:{}}};
  const client = {
    from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{data:{...row}},error:failRead?Error('offline'):null})})})}),
    auth:{getSession:async()=>({data:{session}})},
    rpc:async(_, {p_patch,p_lists})=>{
      if(failWrite)return {error:Error('offline')};
      for(const [k,v] of Object.entries(p_patch))if(v===null)delete row[k];else row[k]=v;
      for(const [k,v] of Object.entries(p_lists))row[k]=JSON.stringify([...new Set([...JSON.parse(row[k]||'[]'),...v.add])].filter(x=>!v.remove.includes(x)).sort());
      return {data:{...row}};
    }
  };
  return {client,session,get row(){return row;}, failRead:v=>failRead=v,failWrite:v=>failWrite=v};
}
test('a new browser restores name, tutorial and progress before writes', async()=>{
  const env=setup(), s=storage(), p=create(env.client,s);await p.init(env.session);
  assert.equal(s.getItem('sa_read'),'["preface"]');assert.equal(s.getItem('sa_tour_seen'),'1');
  p.set('sa_read',['preface','ch1']);assert.equal(await p.flush(),true);
  const fresh=storage(), q=create(env.client,fresh);await q.init(env.session);
  assert.deepEqual(JSON.parse(fresh.getItem('sa_read')),['ch1','preface']);
  assert.equal(fresh.getItem('sa_display_name'),'Name');
});
test('two independent clients preserve each other’s completed chapters',async()=>{
  const e=setup(), a=create(e.client,storage()),b=create(e.client,storage());
  await a.init(e.session);await b.init(e.session);
  a.set('sa_read',['preface','ch1']);b.set('sa_read',['preface','ch2']);
  await Promise.all([a.flush(),b.flush()]);assert.deepEqual(JSON.parse(e.row.sa_read),['ch1','ch2','preface']);
});
test('failed writes remain pending and survive a reload',async()=>{
  const e=setup(), s=storage(), p=create(e.client,s);await p.init(e.session);
  e.failWrite(true);p.set('sa_read',['preface','ch1']);assert.equal(await p.flush(),false);
  e.failWrite(false);const q=create(e.client,s);await q.init(e.session);assert.equal(await q.flush(),true);
  assert.ok(JSON.parse(e.row.sa_read).includes('ch1'));
});
test('failed bootstrap cannot write empty progress',async()=>{
  const e=setup(), p=create(e.client,storage());e.failRead(true);
  await assert.rejects(p.init(e.session));p.set('sa_read',[]);assert.equal(await p.flush(),false);
  assert.equal(e.row.sa_read,'["preface"]');
});
test('switching account clears visible cached data and refuses old-account writes',async()=>{
  const e=setup(),s=storage({sa_user:'other@example.invalid',sa_read:'["ch18"]'}),p=create(e.client,s);
  await p.init(e.session);assert.equal(s.getItem('sa_read'),'["preface"]');
  p.set('sa_read',['ch1']);e.session.user.id='different-account';assert.equal(await p.flush(),false);
});
test('explicit removal and reset remain removed after fresh init',async()=>{
  const e=setup(),p=create(e.client,storage());await p.init(e.session);
  p.set('sa_read',[]);await p.flush();assert.equal(e.row.sa_read,'[]');
  p.set('sa_tour_seen',null);await p.flush();assert.equal(e.row.sa_tour_seen,undefined);
});
test('offline queue is rebased onto changes from another browser before rendering',async()=>{
  const e=setup(),s=storage(),a=create(e.client,s),b=create(e.client,storage());
  await a.init(e.session);await b.init(e.session);
  e.failWrite(true);a.set('sa_read',['ch1']);await a.flush();
  e.failWrite(false);b.set('sa_read',['preface','ch2']);await b.flush();
  const fresh=create(e.client,s);await fresh.init(e.session);
  assert.deepEqual(JSON.parse(s.getItem('sa_read')).sort(),['ch1','ch2']);
  await fresh.flush();assert.deepEqual(JSON.parse(e.row.sa_read),['ch1','ch2']);
});
test('failed reinitialization disables writes from the previous initialization',async()=>{
  const e=setup(),p=create(e.client,storage());await p.init(e.session);
  e.failRead(true);await assert.rejects(p.init(e.session));
  p.set('sa_read',[]);assert.equal(await p.flush(),false);
  assert.equal(e.row.sa_read,'["preface"]');
});
