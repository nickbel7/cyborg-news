#!/usr/bin/env node
/* Proof sheets: one PNG per page, for looking at the thing. node tools/shoot.js */
const { execFileSync } = require('child_process');
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.env.OUT || path.join(ROOT, 'build');
fs.mkdirSync(OUT, { recursive: true });
execFileSync(process.execPath, [path.join(__dirname, 'build.js')], { stdio: 'inherit' });
const built = fs.readdirSync(ROOT).filter(f => /^cyborg-news-.*\.html$/.test(f))
  .map(f => ({ f, t: fs.statSync(path.join(ROOT, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0].f;

const n = Number(process.argv[2] || 3);
for (let i = 1; i <= n; i++) {
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--force-device-scale-factor=2', '--hide-scrollbars',
    '--virtual-time-budget=20000', '--window-size=794,1123',
    '--default-background-color=FFFFFFFF',
    `--screenshot=${path.join(OUT, `page-${i}.png`)}`,
    'file://' + path.join(ROOT, built) + `?only=${i}&bare=1`], { stdio: 'ignore' });
  console.log('  page ' + i);
}
console.log('proof sheets in build/');
