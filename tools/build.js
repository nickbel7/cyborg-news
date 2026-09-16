#!/usr/bin/env node
/* Inlines the issue data into a standalone HTML file you can double-click.
   npm run build  [--  path/to/other-issue.json ]                            */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const src = process.argv[2] || path.join(ROOT, 'data', 'issue.json');
const data = JSON.parse(fs.readFileSync(src, 'utf8'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* Canvas-bound plates are inlined as data URIs. A file:// canvas is tainted
   by a file:// image, so getImageData throws — and passing Chrome a
   --allow-file-access-from-files flag would fix our renderer while leaving
   the built file broken for anyone who just double-clicks it. Inlining
   makes the artefact self-contained and works everywhere. */
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
let inlined = 0;
(function inlineArt(o) {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) return o.forEach(inlineArt);
  if (o.art && typeof o.art.src === 'string' && !o.art.src.startsWith('data:')) {
    const f = path.join(ROOT, o.art.src);
    if (fs.existsSync(f)) {
      const mime = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
      o.art.src = `data:${mime};base64,${fs.readFileSync(f).toString('base64')}`;
      inlined++;
    } else {
      console.warn('missing plate: ' + o.art.src);
    }
  }
  Object.values(o).forEach(inlineArt);
})(data);
if (inlined) console.log(`inlined ${inlined} plate${inlined > 1 ? 's' : ''}`);

const date = (data.issue.dateline_long || '').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()
  .replace(/^-|-$/g, '') || 'issue';
const out = path.join(ROOT, `cyborg-news-${date}.html`);

const injected = html
  .replace('<script src="js/art.js"></script>',
    `<script>window.ISSUE = ${JSON.stringify(data)};</script>\n<script src="js/art.js"></script>`)
  .replace('class="has-toolbar"', 'class="has-toolbar" data-built="1"');

fs.writeFileSync(out, injected);
console.log('wrote ' + path.relative(ROOT, out) + '  (open it, then Cmd-P → Save as PDF, A3, no margins)');
