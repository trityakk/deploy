// Mechanical image conversion. Original files remain recoverable locally.
const fs = require('node:fs/promises');
const {execFileSync}=require('node:child_process');
const os=require('node:os');
const path=require('node:path');
const sharp=require('/Users/dmitrotritak/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/dist/index.cjs');
(async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'amazon-images-'));
  await fs.mkdir('photo/originals',{recursive:true});
  for(const name of ['onboard-1.jpg','onboard-2.jpg','LB.png']) {
    const original='photo/'+name;
    const output=original.replace(/\.(jpg|png)$/i,'.webp');
    const before=(await fs.stat(original)).size;
    let source=original;
    if(name==='onboard-3.jpg') {
      source=path.join(temp,name);
      execFileSync('sips',['-s','format','jpeg',original,'--out',source],{stdio:'ignore'});
    }
    await sharp(source).rotate().resize({width:1920,withoutEnlargement:true}).webp({quality:90}).toFile(output);
    // Refuse to overwrite any previous original archive.
    await fs.copyFile(original,'photo/originals/'+name, require('node:fs').constants.COPYFILE_EXCL);
    for(const file of (await fs.readdir('.')).filter(f=>/\.(html|css|js)$/.test(f))) {
      const text=await fs.readFile(file,'utf8');
      if(text.includes(original)) await fs.writeFile(file,text.split(original).join(output));
    }
    console.log(name,before,'→',(await fs.stat(output)).size,'bytes; original archived');
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
