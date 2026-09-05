const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const pages = ['index.html','enter.html','cabinet.html','payment-success.html','payment-failed.html'];
for (const file of fs.readdirSync('.').filter(f=>f.endsWith('.js'))) {
  new vm.Script(fs.readFileSync(file,'utf8'), {filename:file});
}
for (const file of pages) {
  const html = fs.readFileSync(file,'utf8');
  assert.match(html, /<html\b/i, file);
  assert.match(html, /<title>[^<]+<\/title>/i, file);
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const url = match[1].split(/[?#]/)[0];
    if (!url || /^(?:[a-z]+:|\/\/)/i.test(url)) continue;
    assert.ok(fs.existsSync(path.resolve(url)), `${file}: missing ${url}`);
  }
  for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/application\/ld\+json/.test(match[1])) JSON.parse(match[2]);
    else if (!/\bsrc=/.test(match[1])) new vm.Script(match[2], {filename:file});
  }
}
assert.ok(!fs.existsSync('dist/private-course-content'));
assert.ok(!fs.existsSync('dist/supabase'));
console.log('PASS: JavaScript syntax, inline scripts, structured data, local links and private build exclusions.');
