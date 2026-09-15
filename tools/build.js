#!/usr/bin/env node
/* Inlines the issue data into a standalone HTML file you can double-click.
   npm run build  [--  path/to/other-issue.json ]                            */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const src = process.argv[2] || path.join(ROOT, 'data', 'issue.json');
const data = JSON.parse(fs.readFileSync(src, 'utf8'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const date = (data.issue.dateline_long || '').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()
  .replace(/^-|-$/g, '') || 'issue';
const out = path.join(ROOT, `cyborg-news-${date}.html`);

const injected = html
  .replace('<script src="js/art.js"></script>',
    `<script>window.ISSUE = ${JSON.stringify(data)};</script>\n<script src="js/art.js"></script>`)
  .replace('class="has-toolbar"', 'class="has-toolbar" data-built="1"');

fs.writeFileSync(out, injected);
console.log('wrote ' + path.relative(ROOT, out) + '  (open it, then Cmd-P → Save as PDF, A4, no margins)');
