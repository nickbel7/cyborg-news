#!/usr/bin/env node
/* Renders the issue to a print-ready PDF with headless Chrome: npm run pdf */
const { execFileSync } = require('child_process');
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

execFileSync(process.execPath, [path.join(__dirname, 'build.js'), ...process.argv.slice(2)],
  { stdio: 'inherit' });
const built = fs.readdirSync(ROOT).filter(f => /^cyborg-news-.*\.html$/.test(f))
  .map(f => ({ f, t: fs.statSync(path.join(ROOT, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0].f;
const out = path.join(ROOT, built.replace(/\.html$/, '.pdf'));

execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--virtual-time-budget=15000', '--run-all-compositor-stages-before-draw',
  '--no-pdf-header-footer', `--print-to-pdf=${out}`,
  'file://' + path.join(ROOT, built)], { stdio: 'inherit' });
console.log('wrote ' + path.relative(ROOT, out));
