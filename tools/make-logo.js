#!/usr/bin/env node
/* Generates the CYBORG NEWS pixel wordmark as SVG from a 5x7 bitmap font.
   Re-run after editing NAME below:  node tools/make-logo.js            */
const fs = require('fs');
const path = require('path');

const NAME = ['CYBORG', 'NEWS'];      // stacked lockup, line by line
const CELL = 10;                       // svg units per pixel

// 5x7 bitmap font, squared-off terminals to match the supplied mark
const FONT = {
  A:['01110','10001','10001','11111','10001','10001','10001'],
  B:['11110','10001','10001','11110','10001','10001','11110'],
  C:['11111','10000','10000','10000','10000','10000','11111'],
  D:['11110','10001','10001','10001','10001','10001','11110'],
  E:['11111','10000','10000','11110','10000','10000','11111'],
  F:['11111','10000','10000','11110','10000','10000','10000'],
  G:['11111','10000','10000','10111','10001','10001','11111'],
  H:['10001','10001','10001','11111','10001','10001','10001'],
  I:['11111','00100','00100','00100','00100','00100','11111'],
  J:['00111','00010','00010','00010','00010','10010','01100'],
  K:['10001','10010','10100','11000','10100','10010','10001'],
  L:['10000','10000','10000','10000','10000','10000','11111'],
  M:['10001','11011','10101','10101','10001','10001','10001'],
  N:['10001','11001','11001','10101','10011','10011','10001'],
  O:['11111','10001','10001','10001','10001','10001','11111'],
  P:['11110','10001','10001','11110','10000','10000','10000'],
  Q:['11111','10001','10001','10001','10101','10010','11101'],
  R:['11110','10001','10001','11110','10100','10010','10001'],
  S:['11111','10000','10000','11111','00001','00001','11111'],
  T:['11111','00100','00100','00100','00100','00100','00100'],
  U:['10001','10001','10001','10001','10001','10001','11111'],
  V:['10001','10001','10001','10001','10001','01010','00100'],
  W:['10001','10001','10001','10101','10101','11011','10001'],
  X:['10001','10001','01010','00100','01010','10001','10001'],
  Y:['10001','10001','10001','01110','00100','00100','00100'],
  Z:['11111','00001','00010','00100','01000','10000','11111'],
  '0':['11111','10011','10101','10101','11001','10001','11111'],
  '1':['00100','01100','00100','00100','00100','00100','11111'],
  '2':['11111','00001','00001','11111','10000','10000','11111'],
  '3':['11111','00001','00001','01111','00001','00001','11111'],
  '4':['10001','10001','10001','11111','00001','00001','00001'],
  '5':['11111','10000','10000','11111','00001','00001','11111'],
  '6':['11111','10000','10000','11111','10001','10001','11111'],
  '7':['11111','00001','00010','00100','01000','01000','01000'],
  '8':['11111','10001','10001','11111','10001','10001','11111'],
  '9':['11111','10001','10001','11111','00001','00001','11111'],
  ' ':['00000','00000','00000','00000','00000','00000','00000'],
};

const GW = 5, GH = 7, TRACK = 1;               // glyph w/h + letterspacing in cells
const wordCells = w => w.length * GW + (w.length - 1) * TRACK;

// merge horizontally adjacent lit pixels into single rects -> far fewer nodes
function rectsFor(word, ox, oy, scale) {
  const out = [];
  for (let r = 0; r < GH; r++) {
    let run = null;
    for (let i = 0; i < word.length; i++) {
      const rows = FONT[word[i]] || FONT[' '];
      const base = i * (GW + TRACK);
      for (let c = 0; c < GW; c++) {
        const on = rows[r][c] === '1';
        const x = base + c;
        if (on) { if (run && run.end === x) run.end = x + 1; else { if (run) out.push(run); run = { y: r, start: x, end: x + 1 }; } }
      }
      if (run && run.end !== (base + GW)) { out.push(run); run = null; }
    }
    if (run) out.push(run);
  }
  return out.map(r =>
    `<rect x="${((ox + r.start) * CELL * scale).toFixed(2)}" y="${((oy + r.y) * CELL * scale).toFixed(2)}" ` +
    `width="${((r.end - r.start) * CELL * scale).toFixed(2)}" height="${(CELL * scale).toFixed(2)}"/>`);
}

function svg(w, h, body, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}" role="img" aria-label="${title}">
<title>${title}</title>
<g fill="#000" shape-rendering="crispEdges">
${body.join('\n')}
</g>
</svg>\n`;
}

/* ---- stacked lockup: line 2 slightly smaller, tucked right (as supplied) ---- */
function stacked() {
  const s2 = 0.86, gap = 0.6;
  const w1 = wordCells(NAME[0]), w2 = wordCells(NAME[1]) * s2;
  const W = Math.max(w1, w2), H = GH + gap + GH * s2;
  const body = [
    ...rectsFor(NAME[0], 0, 0, 1),
    ...rectsFor(NAME[1], (W - w2) / s2, (GH + gap) / s2, s2),
  ];
  return svg(W * CELL, H * CELL, body, NAME.join(' '));
}

/* ---- inline wordmark: one line, for the front-page nameplate ---- */
function inline() {
  const word = NAME.join(' ');
  const W = wordCells(word);
  return svg(W * CELL, GH * CELL, rectsFor(word, 0, 0, 1), word);
}

const dir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'logo-stacked.svg'), stacked());
fs.writeFileSync(path.join(dir, 'logo-inline.svg'), inline());
console.log('wrote assets/logo-stacked.svg + assets/logo-inline.svg');
