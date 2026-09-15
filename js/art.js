/* =========================================================================
   art.js — generated plates. Everything here is drawn, not photographed:
   charts, schematics and 1-bit halftone illustrations, all monochrome so the
   page prints identically on any lab printer.
   ========================================================================= */
(function (global) {
  'use strict';

  const SVG = 'http://www.w3.org/2000/svg';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function el(tag, attrs, html) {
    const n = document.createElement(tag);
    for (const k in (attrs || {})) {
      if (k === 'class') n.className = attrs[k]; else n.setAttribute(k, attrs[k]);
    }
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* shared svg defs: hatch textures stand in for a second colour ---------- */
  const DEFS = `
    <defs>
      <pattern id="hatch45" width="3" height="3" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="3" stroke="#000" stroke-width="1.35"/>
      </pattern>
      <pattern id="hatch135" width="3" height="3" patternTransform="rotate(135)" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="3" stroke="#000" stroke-width="1.1"/>
      </pattern>
      <pattern id="stipple" width="4" height="4" patternUnits="userSpaceOnUse">
        <rect width="1.2" height="1.2" x="0" y="0" fill="#000"/>
        <rect width="1.2" height="1.2" x="2" y="2" fill="#000"/>
      </pattern>
      <marker id="arw" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7.5" markerHeight="7.5" orient="auto-start-reverse">
        <path d="M0,1 L9,5 L0,9 z" fill="#000"/>
      </marker>
      <marker id="arwOpen" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M1,1 L9,5 L1,9" fill="none" stroke="#000" stroke-width="1.4"/>
      </marker>
    </defs>`;

  const FS = { tick: 8.2, label: 8.6, note: 7.6, axis: 7.4, head: 9.6 };
  const T = {
    mono: "'IBM Plex Mono',monospace",
    sans: "'Libre Franklin',Arial,sans-serif",
    serif: "'Source Serif 4',Georgia,serif"
  };

  function frame(w, h, inner, extra) {
    return `<svg xmlns="${SVG}" viewBox="0 0 ${w} ${h}" ${extra || ''} style="width:100%;height:auto;display:block">${DEFS}${inner}</svg>`;
  }

  /* ======================================================================
     1. Diverging bar chart — one measure, one axis, zero baseline.
        Used for "how much each reported number moved".
     ====================================================================== */
  function divergingBars(spec) {
    const rows = spec.rows;
    const W = 460, padL = 128, padR = 72, padT = 26, rowH = 26, gap = 7;
    const H = padT + rows.length * (rowH + gap) + 34;
    const plotW = W - padL - padR;
    const max = Math.max(...rows.map(r => Math.abs(r.change))) * 1.08;
    // zero sits proportionally so both directions fit on one scale
    const negMax = Math.max(0, ...rows.map(r => -r.change));
    const posMax = Math.max(0, ...rows.map(r => r.change));
    const span = negMax + posMax || 1;
    const zeroX = padL + plotW * (negMax / span) * (max / max);
    const scale = v => plotW * (v / span);

    let g = '';
    // axis furniture, kept recessive
    g += `<line x1="${zeroX}" y1="${padT - 8}" x2="${zeroX}" y2="${padT + rows.length * (rowH + gap)}" stroke="#000" stroke-width="1"/>`;
    g += `<text x="${zeroX}" y="${padT - 12}" font-family="${T.mono}" font-size="${FS.axis}" text-anchor="middle" fill="#5a544c">NO CHANGE</text>`;

    rows.forEach((r, i) => {
      const y = padT + i * (rowH + gap);
      const w = Math.abs(scale(r.change));
      const x = r.change >= 0 ? zeroX : zeroX - w;
      const fill = r.change >= 0 ? '#000' : 'url(#hatch45)';
      const barH = rowH - 8;
      g += `<rect x="${x}" y="${y}" width="${Math.max(w, 1.2)}" height="${barH}" fill="${fill}" stroke="#000" stroke-width="0.8"/>`;
      // category label
      g += `<text x="${padL - 12}" y="${y + barH - 3}" font-family="${T.sans}" font-size="${FS.label}" font-weight="700" text-anchor="end" fill="#000">${esc(r.label)}</text>`;
      g += `<text x="${padL - 12}" y="${y + barH + 7}" font-family="${T.mono}" font-size="${FS.note}" text-anchor="end" fill="#5a544c">${esc(r.sub || '')}</text>`;
      // direct label: the two absolute figures, which are the real story
      const lx = r.change >= 0 ? x + w + 7 : x - 7;
      const anchor = r.change >= 0 ? 'start' : 'end';
      g += `<text x="${lx}" y="${y + barH - 4}" font-family="${T.mono}" font-size="${FS.tick}" font-weight="600" text-anchor="${anchor}" fill="#000">${esc(r.from)} → ${esc(r.to)}</text>`;
      g += `<text x="${lx}" y="${y + barH + 6}" font-family="${T.mono}" font-size="${FS.note}" text-anchor="${anchor}" fill="#5a544c">${r.change >= 0 ? '+' : ''}${r.change.toFixed(r.change % 1 ? 1 : 0)}%</text>`;
    });

    const legY = padT + rows.length * (rowH + gap) + 16;
    g += `<rect x="${padL - 12}" y="${legY - 7}" width="9" height="9" fill="#000"/>`;
    g += `<text x="${padL + 1}" y="${legY + 1}" font-family="${T.sans}" font-size="${FS.note}" fill="#23211e">Revised up</text>`;
    g += `<rect x="${padL + 58}" y="${legY - 7}" width="9" height="9" fill="url(#hatch45)" stroke="#000" stroke-width="0.8"/>`;
    g += `<text x="${padL + 71}" y="${legY + 1}" font-family="${T.sans}" font-size="${FS.note}" fill="#23211e">Revised down</text>`;

    return frame(W, H, g);
  }

  /* ======================================================================
     2. Schematic — labelled boxes and flows. Used for architecture diagrams.
     ====================================================================== */
  function schematic(spec) {
    const W = spec.width || 460, H = spec.height || 300;
    let g = '';
    (spec.zones || []).forEach(z => {
      g += `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" fill="${z.fill || 'none'}"
            stroke="#000" stroke-width="1" stroke-dasharray="${z.dash || '4 3'}"/>`;
      if (z.label) g += `<text x="${z.x + 6}" y="${z.y + 12}" font-family="${T.mono}" font-size="7.4"
            letter-spacing="1" fill="#5a544c">${esc(z.label.toUpperCase())}</text>`;
    });
    (spec.boxes || []).forEach(b => {
      const fill = b.fill === 'solid' ? '#000' : b.fill === 'hatch' ? 'url(#stipple)' : '#fff';
      g += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${fill}" stroke="#000" stroke-width="${b.strong ? 1.8 : 1}"/>`;
      const ink = b.fill === 'solid' ? '#fff' : '#000';
      const lines = String(b.t).split('|');
      const startY = b.y + b.h / 2 - (lines.length - 1) * 5.4 + 3.4;
      if (b.fill === 'hatch') {          // keep the label readable over texture
        const th = lines.length * 10.8 + 4;
        g += `<rect x="${b.x + 6}" y="${startY - 10}" width="${b.w - 12}" height="${th}" fill="#fff"/>`;
      }
      lines.forEach((ln, i) => {
        const bold = i === 0 ? '700' : '400';
        const fam = i === 0 ? T.sans : T.mono;
        const sz = i === 0 ? 8.6 : 7.2;
        g += `<text x="${b.x + b.w / 2}" y="${startY + i * 10.8}" font-family="${fam}" font-size="${sz}"
              font-weight="${bold}" text-anchor="middle" fill="${i === 0 ? ink : (b.fill === 'solid' ? '#ddd' : '#5a544c')}">${esc(ln)}</text>`;
      });
    });
    (spec.flows || []).forEach(f => {
      const dash = f.dash ? `stroke-dasharray="${f.dash}"` : '';
      const marker = f.open ? 'url(#arwOpen)' : 'url(#arw)';
      g += `<path d="${f.d}" fill="none" stroke="#000" stroke-width="${f.w || 1.5}" ${dash} marker-end="${marker}"/>`;
      if (f.t) {
        const [lx, ly] = f.at;
        const tw = String(f.t).length * 3.9 + 6;
        g += `<rect x="${lx - tw / 2}" y="${ly - 7}" width="${tw}" height="10" fill="#fff"/>`;
        g += `<text x="${lx}" y="${ly + 1}" font-family="${T.mono}" font-size="6.9" text-anchor="middle" fill="#23211e">${esc(f.t)}</text>`;
      }
    });
    (spec.notes || []).forEach(n => {
      g += `<text x="${n.x}" y="${n.y}" font-family="${T.mono}" font-size="6.9" text-anchor="${n.anchor || 'start'}" fill="#5a544c">${esc(n.t)}</text>`;
    });
    return frame(W, H, g);
  }

  /* ======================================================================
     3. Step/line chart — magnitude over an ordered axis, single series.
     ====================================================================== */
  function lineChart(spec) {
    const W = 460, padL = 40, padR = 58, padT = 20, padB = 34;
    const H = spec.height || 190;
    const pw = W - padL - padR, ph = H - padT - padB;
    const pts = spec.points;
    const maxY = spec.max != null ? spec.max : Math.max(...pts.map(p => p.y)) * 1.15;
    const X = i => padL + (pw * i) / (pts.length - 1);
    const Y = v => padT + ph - (ph * v) / maxY;
    let g = '';
    (spec.gridlines || [0.25, 0.5, 0.75, 1]).forEach(t => {
      const y = padT + ph - ph * t;
      g += `<line x1="${padL}" y1="${y}" x2="${padL + pw}" y2="${y}" stroke="#000" stroke-width="0.4" opacity="0.28"/>`;
      g += `<text x="${padL - 6}" y="${y + 2.6}" font-family="${T.mono}" font-size="6.8" text-anchor="end" fill="#5a544c">${Math.round(maxY * t).toLocaleString()}</text>`;
    });
    g += `<line x1="${padL}" y1="${padT + ph}" x2="${padL + pw}" y2="${padT + ph}" stroke="#000" stroke-width="1"/>`;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i)},${Y(p.y)}`).join(' ');
    g += `<path d="${d} L${X(pts.length - 1)},${padT + ph} L${padL},${padT + ph} Z" fill="url(#hatch135)" opacity="0.5"/>`;
    g += `<path d="${d}" fill="none" stroke="#000" stroke-width="2" stroke-linejoin="round"/>`;
    pts.forEach((p, i) => {
      if (p.mark) {
        g += `<circle cx="${X(i)}" cy="${Y(p.y)}" r="4" fill="#000" stroke="#fff" stroke-width="1.6"/>`;
        g += `<text x="${X(i)}" y="${Y(p.y) - 9}" font-family="${T.mono}" font-size="7.4" font-weight="600" text-anchor="middle" fill="#000">${esc(p.mark)}</text>`;
      }
      if (p.x) g += `<text x="${X(i)}" y="${padT + ph + 12}" font-family="${T.mono}" font-size="6.8" text-anchor="middle" fill="#5a544c">${esc(p.x)}</text>`;
    });
    if (spec.axisLabel) g += `<text x="${padL}" y="${H - 5}" font-family="${T.sans}" font-size="6.9" fill="#5a544c">${esc(spec.axisLabel)}</text>`;
    return frame(W, H, g);
  }

  /* ======================================================================
     4. Halftone plate — a procedural field pushed through an ordered dither,
        so an illustration reproduces as true 1-bit newsprint.
     ====================================================================== */
  const BAYER8 = (() => {
    const m = [[0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]];
    return m.map(r => r.map(v => (v + 0.5) / 64));
  })();

  function hash(x, y, s) {
    let h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
    return h - Math.floor(h);
  }
  function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }
  function fbm(x, y, s) {
    let v = 0, a = 0.5, f = 1;
    for (let i = 0; i < 5; i++) { v += a * vnoise(x * f, y * f, s + i); f *= 2.03; a *= 0.5; }
    return v;
  }

  /* fields: each returns 0(dark)..1(light) for a normalised coordinate */
  const FIELDS = {
    // interlocking lattice fading into noise — reads as a structural photo
    lattice(u, v, s) {
      const r = Math.hypot(u - .5, v - .42);
      const rings = 0.5 + 0.5 * Math.sin((r * 26) - fbm(u * 3, v * 3, s) * 5.5);
      const grid = Math.min(
        Math.abs(((u * 15 + fbm(u * 2, v * 2, s + 9) * 2) % 1) - .5),
        Math.abs(((v * 15 + fbm(u * 2, v * 2, s + 3) * 2) % 1) - .5)) * 2;
      const vign = 1 - Math.pow(r * 1.25, 2.1);
      return Math.max(0, Math.min(1, (rings * .45 + grid * .55) * vign + (1 - vign) * .95));
    },
    // dense branching field — a proof tree / dependency graph impression.
    // Aspect-aware: a wide plate grows a stand of trees rather than one
    // stretched one, so a banner crop still reads as branching structure.
    tree(u, v, s, aspect) {
      const A = aspect || 1;
      const x = u * A;
      let d = 1;
      const branch = (x0, y0, ang, len, depth, seed) => {
        if (depth > 7 || len < .010) return;
        const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
        const dx = x1 - x0, dy = y1 - y0;
        const t = Math.max(0, Math.min(1, ((x - x0) * dx + (v - y0) * dy) / (dx * dx + dy * dy || 1e-6)));
        const dist = Math.hypot(x - (x0 + t * dx), v - (y0 + t * dy));
        d = Math.min(d, dist / (0.006 + depth * 0.0016));
        const sp = 0.42 + hash(depth, Math.round(x0 * 90), seed) * 0.5;
        branch(x1, y1, ang - sp, len * 0.72, depth + 1, seed);
        branch(x1, y1, ang + sp * 0.8, len * 0.7, depth + 1, seed);
      };
      const N = Math.max(1, Math.round(A / 1.1));
      for (let i = 0; i < N; i++) {
        branch(A * (i + 0.5) / N, 1.06, -Math.PI / 2, 0.30, 0, s + i * 17);
      }
      const haze = fbm(u * 5, v * 5, s) - 0.5;
      const ground = 0.80 + haze * 0.30;          // dithered ground, not blank paper
      return Math.max(0, Math.min(1, Math.min(1, d) * ground));
    },
    // soft turbulent cloud — generic atmospheric plate
    field(u, v, s) {
      const n = fbm(u * 3.4, v * 3.4, s);
      const vign = 1 - Math.pow(Math.hypot(u - .5, v - .5) * 1.35, 2);
      return Math.max(0, Math.min(1, n * 1.25 * vign + (1 - vign)));
    }
  };

  function halftone(spec) {
    const wmm = spec.wmm || 90, hmm = spec.hmm || 58;
    const px = spec.px || 3.2;                  // sample cells per mm -> print resolution
    const w = Math.round(wmm * px), h = Math.round(hmm * px);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.className = 'halftone';
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(w, h);
    const fn = FIELDS[spec.field] || FIELDS.field;
    const seed = spec.seed || 1;
    const gain = spec.gain == null ? 1 : spec.gain;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let l = fn(x / w, y / h, seed, w / h);
        l = Math.pow(Math.max(0, Math.min(1, l)), gain);
        const on = l > BAYER8[y & 7][x & 7] ? 255 : 0;   // ordered dither -> 1-bit
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = on;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    cv.style.width = '100%';
    return cv;
  }

  /* ======================================================================
     5. Small furniture
     ====================================================================== */
  function statStrip(spec) {
    const n = el('div', { class: 'stats' + (spec.stack ? ' stack' : '') });
    spec.items.forEach(it => {
      n.appendChild(el('div', { class: 'stat' },
        `<div class="n">${esc(it.n)}${it.unit ? `<small> ${esc(it.unit)}</small>` : ''}</div>
         <div class="l">${esc(it.l)}</div>`));
    });
    return n;
  }

  function dataTable(spec) {
    const t = el('table', { class: 'data' });
    let html = spec.caption ? `<caption>${esc(spec.caption)}</caption>` : '';
    html += '<thead><tr>' + spec.head.map(h => `<th>${esc(h)}</th>`).join('') + '</tr></thead><tbody>';
    spec.rows.forEach(r => {
      html += '<tr>' + r.map((c, i) => {
        const cell = typeof c === 'object' ? c : { v: c };
        const cls = [i === 0 ? 'name' : '', cell.dir || ''].filter(Boolean).join(' ');
        return `<td${cls ? ` class="${cls}"` : ''}>${esc(cell.v)}</td>`;
      }).join('') + '</tr>';
    });
    t.innerHTML = html + '</tbody>';
    return t;
  }

  const PLATES = {
    bars: divergingBars, schematic, line: lineChart,
    halftone, stats: statStrip, table: dataTable
  };

  /* returns a <figure> for an article's `art` spec */
  function buildFigure(art) {
    if (!art) return null;
    const fig = el('figure');
    const plate = el('div', { class: 'plate' });
    const maker = PLATES[art.type];
    if (!maker) return null;
    const out = maker(art);
    if (typeof out === 'string') plate.innerHTML = out; else plate.appendChild(out);
    fig.appendChild(plate);
    if (art.caption || art.credit) {
      const cap = el('figcaption');
      cap.innerHTML = (art.capLabel ? `<b>${esc(art.capLabel)}</b> ` : '') +
        (art.caption ? esc(art.caption) : '') +
        (art.credit ? `<span class="credit">${esc(art.credit)}</span>` : '');
      fig.appendChild(cap);
    }
    return fig;
  }

  global.Art = { buildFigure, el, esc, PLATES };
})(window);
