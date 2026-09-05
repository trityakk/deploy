const fs = require('node:fs/promises');
const path = require('node:path');
const terser = require('terser');
// Only explicit public files are published. Never copy the repository root.
const pages = ['index.html','cabinet.html','enter.html','payment-success.html','payment-failed.html'];
const assets = ['landing.js','auth-route.js','cabinet.js','cabinet-progress.js','cabinet-loader.js',
  'cabinet-early.js','enter.js','platform-client.js','ui-accessibility.js',
  'landing.css','styles-glass.css','light-theme.css','cabinet-guest.css','cabinet-overrides.css','enter.css'];
async function copyTree(source,target) {
  await fs.mkdir(target,{recursive:true});
  for(const e of await fs.readdir(source,{withFileTypes:true})) {
    if(e.name.startsWith('.') || ['originals','archive-originals','onboard-1.jpg','onboard-2.jpg','LB.png'].includes(e.name))continue;
    const from=path.join(source,e.name),to=path.join(target,e.name);
    if(e.isDirectory())await copyTree(from,to);else await fs.copyFile(from,to);
  }
}
(async()=>{
  // dist contains only this script's generated output, never source files.
  await fs.rm(path.resolve(__dirname,'../dist'),{recursive:true,force:true});
  await fs.mkdir('dist',{recursive:true});
  for(const f of pages) await fs.copyFile(f,'dist/'+f);
  for(const f of assets) {
    let text=await fs.readFile(f,'utf8');
    if(f.endsWith('.js'))text=(await terser.minify(text,{compress:true,mangle:true})).code;
    // Preserve CSS cascade exactly; minification is not worth changing overrides blindly.
    await fs.writeFile('dist/'+f,text);
  }
  await copyTree('photo','dist/photo');await copyTree('font','dist/font');
  await fs.writeFile('dist/.nojekyll','');
  console.log('Public build prepared in dist; private course, migrations and tests excluded.');
})().catch(e=>{console.error(e);process.exitCode=1;});
