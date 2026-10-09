// Runtime resolution smoke test: require every compiled file except main.js
const fs = require('fs');
const path = require('path');

const root = process.argv[2] || './dist';
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
})(root);

let ok = 0;
const failures = [];
for (const f of files) {
  if (path.basename(f) === 'main.js') continue;
  try {
    require(path.resolve(f));
    ok++;
  } catch (err) {
    failures.push({ file: f, code: err.code || err.name, msg: String(err.message).split('\n')[0].slice(0, 160) });
  }
}
console.log(`total=${files.length} ok=${ok} failed=${failures.length}`);
for (const f of failures.slice(0, 25)) console.log(`  FAIL ${f.file} :: ${f.code} :: ${f.msg}`);
