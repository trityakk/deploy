const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('overview badges count chapters and appendices without intro/exam',()=>{
  const source=fs.readFileSync('cabinet.js','utf8');
  const start=source.indexOf('  totalChapters = chapterOrder.length;');
  const end=source.indexOf('  function escHtml',start);
  assert.ok(start>=0&&end>start);
  const badges=[{},{}];
  const tabs=['overviewChapters','overviewAppendix'].map((target,i)=>({dataset:{target},querySelector:()=>badges[i]}));
  const chapterOrder=['preface','appendix_intro','final_exam',
    ...Array.from({length:18},(_,i)=>'ch'+(i+1)),
    ...Array.from({length:21},(_,i)=>'appendix_'+String.fromCharCode(97+i))];
  const context={chapterOrder,document:{querySelectorAll:()=>tabs}};
  vm.runInNewContext(source.slice(start,end),context);
  assert.equal(context.totalChapters,42);
  assert.equal(badges[0].textContent,18);
  assert.equal(badges[1].textContent,21);
});
