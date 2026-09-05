const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('callback routing preserves PKCE code and recovery hash',()=>{
  const location=new URL('https://example.test/deploy/cabinet.html?code=sample-code&type=recovery#sample');let target;
  location.replace=u=>target=new URL(u);
  vm.runInNewContext(fs.readFileSync('auth-route.js','utf8'),{window:{},location,URL,URLSearchParams});
  assert.equal(target.searchParams.get('code'),'sample-code');assert.equal(target.searchParams.get('mode'),'activate');
  assert.equal(target.pathname,'/deploy/enter.html');
});
test('valid recovery session enables saving instead of being lost by finally',async()=>{
  const els=new Map();const el=id=>{if(!els.has(id))els.set(id,{style:{},classList:{add(){},toggle(){}},querySelector:()=>el('submit'),addEventListener(){}});return els.get(id);};
  const session={user:{id:'test-user'}};
  let replaced;
  const window={courseAuthCallback:{active:true},location:new URL('https://example.test/enter.html?mode=activate'),
    history:{replaceState:(_,__,u)=>replaced=u},startAmazonSupabase:{auth:{
      getSession:async()=>({data:{session}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})
    }}};
  vm.runInNewContext(fs.readFileSync('enter.js','utf8'),{window,document:{getElementById:el,querySelectorAll:()=>[]},
    URL,URLSearchParams,setInterval,clearInterval,setTimeout,clearTimeout,console});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(el('submit').disabled,false);assert.match(el('activateStatus').textContent,/підтверджено/);
  assert.equal(new URL(replaced).searchParams.get('mode'),'activate');
});
