#!/usr/bin/env node
/* =========================================================================
   site.js — build the reader: one page of the paper at a time, with every
   issue ever printed stacked beside it.

   The reader renders the committed PDF rather than shipping page images
   beside it. That was measured, not assumed: a page of this paper is a
   clustered-dot halftone, which is high-frequency noise that lossy codecs
   cannot compress — dropping WebP quality from 78 to 55 moved a two-page
   issue only from 2,019KB to 1,733KB, so images would have added about
   90MB a year of pixels duplicating a 937KB PDF that already holds them.

   Rendering the PDF instead costs nothing in the repository, stays sharp at
   any zoom because the type is still vector, and keeps one canonical
   artefact. Only a small thumbnail is committed, for the archive stack,
   because rendering five PDFs just to draw five thumbnails is slow.

   Static files throughout, so GitHub Pages serves it with nothing running.
   The archive is read from issues/<date>/, which is what run.js files after
   a build passes the gate — so the reader cannot show an issue that never
   printed.

     node tools/site.js          issues/ -> site/
   ========================================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'site');
const ISSUES = path.join(ROOT, 'issues');
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Every dated folder that actually contains a printed paper. */
const editions = (fs.existsSync(ISSUES) ? fs.readdirSync(ISSUES) : [])
  .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
  .filter(d => fs.existsSync(path.join(ISSUES, d, 'paper.pdf')))
  .sort().reverse()
  .map(d => {
    const dir = path.join(ISSUES, d);
    let issue = null;
    try { issue = JSON.parse(fs.readFileSync(path.join(dir, 'issue.json'), 'utf8')); } catch {}
    const arts = (issue?.articles || []).slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return {
      date: d,
      long: issue?.issue?.dateline_long || d,
      lead: arts[0]?.headline || null,
      hasThumb: fs.existsSync(path.join(dir, 'thumb.webp')),
      kb: Math.round(fs.statSync(path.join(dir, 'paper.pdf')).size / 1024)
    };
  });

const manifest = editions.map(e => ({
  date: e.date, long: e.long, lead: e.lead, kb: e.kb,
  pdf: `issues/${e.date}/paper.pdf`,
  thumb: e.hasThumb ? `issues/${e.date}/thumb.webp` : null
}));

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CYBORG NEWS</title>
<meta name="description" content="A printed newspaper for the lab, set weekly from the week's reporting on AI, cognition and human-machine systems.">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@500;600&display=swap">
<style>
  :root{
    --paper:#f2f1ee;          /* the wall the sheet hangs on */
    --ink:#16150f;
    --muted:#8b8780;
    --chip:#e7e5e1;           /* resting control */
    --chip-ink:#9c988f;
    --go:#141310;             /* the one active control */
    --go-ink:#ffffff;
    --sheet:#fbfaf8;
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{
    margin:0; background:var(--paper); color:var(--ink);
    font-family:'Libre Franklin',system-ui,-apple-system,'Segoe UI',sans-serif;
    font-size:14px; -webkit-font-smoothing:antialiased;
    padding-left:20px; padding-right:20px; padding-block:0;
  }
  .wordmark{
    position:fixed; top:22px; left:24px; z-index:5;
    font-size:11px; font-weight:600; letter-spacing:.18em; color:var(--muted);
  }

  /* page | controls | archive */
  .room{
    min-height:100vh; display:grid; gap:34px;
    grid-template-columns:minmax(0,1fr) 44px 150px;
    align-items:center; justify-content:center;
    max-width:1080px; margin:0 auto; padding-block:64px 40px;
  }

  .viewer{display:flex; flex-direction:column; align-items:center; gap:24px; min-width:0}
  .sheet{
    position:relative; width:100%; max-width:540px; aspect-ratio:1123/1587;
    background:var(--sheet); border-radius:2px; margin:0;
    box-shadow:
      0 1px 1px rgba(20,19,16,.05),
      0 8px 18px rgba(20,19,16,.07),
      0 26px 48px rgba(20,19,16,.09);
    overflow:hidden;
  }
  .sheet canvas{width:100%; height:100%; display:block}
  .sheet .state{
    position:absolute; inset:0; display:grid; place-items:center;
    font-size:11px; letter-spacing:.14em; color:var(--chip-ink);
  }
  .sheet .state[hidden]{display:none}
  .sheet canvas[hidden]{display:none}
  /* shown only if the PDF will not render: the thumbnail, softly, with a
     plain instruction over it — never an indefinite spinner */
  .sheet .fall{position:absolute; inset:0}
  .sheet .fall[hidden]{display:none}
  .sheet .fall img{width:100%; height:100%; object-fit:cover; object-position:top center;
                   display:block; opacity:.45; filter:saturate(0)}
  .sheet .fall img[hidden]{display:none}
  .sheet .fall span{
    position:absolute; inset:0; display:grid; place-items:center;
    font-size:11px; font-weight:600; letter-spacing:.14em; color:var(--muted);
  }

  .pager{display:flex; gap:10px}
  .pill{
    appearance:none; border:0; cursor:pointer; font:inherit; font-weight:600;
    font-size:11px; letter-spacing:.12em; padding:10px 20px; border-radius:999px;
    background:var(--go); color:var(--go-ink); transition:opacity .15s, transform .15s;
  }
  .pill:hover{opacity:.85}
  .pill:active{transform:translateY(1px)}
  .pill[disabled]{background:var(--chip); color:var(--chip-ink); cursor:default; opacity:1}
  .pill[disabled]:hover{opacity:1}

  .tools{display:flex; flex-direction:column; gap:14px; align-self:start; margin-top:8px}
  .tool{
    appearance:none; border:0; cursor:pointer; width:44px; height:44px; border-radius:50%;
    background:var(--chip); color:var(--ink); display:grid; place-items:center;
    transition:background .15s, transform .15s; text-decoration:none;
  }
  .tool:hover{background:#dedbd5}
  .tool:active{transform:translateY(1px)}
  .tool svg{width:19px; height:19px; fill:none; stroke:currentColor; stroke-width:1.9;
            stroke-linecap:round; stroke-linejoin:round}

  .archive{align-self:start; padding-top:4px}
  .archive h2{
    font-size:10px; font-weight:600; letter-spacing:.16em; color:var(--muted);
    margin:0 0 18px; text-align:center;
  }
  .stack{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; align-items:center}
  .stack li{width:100%; display:flex; justify-content:center}
  .card{
    appearance:none; border:0; padding:0; cursor:pointer; display:block;
    background:var(--sheet); border-radius:2px; overflow:hidden;
    aspect-ratio:1123/1587; width:100%;
    box-shadow:0 2px 6px rgba(20,19,16,.07), 0 12px 24px rgba(20,19,16,.07);
    transition:transform .18s, box-shadow .18s, opacity .18s;
  }
  .card img{width:100%; height:100%; object-fit:cover; object-position:top center; display:block}
  .card:hover{transform:translateY(-3px); box-shadow:0 4px 10px rgba(20,19,16,.09), 0 18px 34px rgba(20,19,16,.11)}
  .card .none{width:100%; height:100%; display:grid; place-items:center;
              font-size:9px; letter-spacing:.12em; color:var(--chip-ink)}

  .empty-state{grid-column:1/-1; text-align:center; color:var(--muted); font-size:13px}

  dialog.big{
    border:0; padding:0; background:transparent; width:100%; height:100%;
    max-width:100vw; max-height:100vh; margin:0; overflow:auto;
  }
  dialog.big::backdrop{background:rgba(24,23,20,.9)}
  dialog.big canvas{
    display:block; margin:3vh auto; max-width:94vw; height:auto;
    box-shadow:0 30px 80px rgba(0,0,0,.5); background:var(--sheet);
  }
  dialog.big .close{
    position:fixed; top:20px; right:22px; width:40px; height:40px; border-radius:50%;
    border:0; cursor:pointer; background:rgba(255,255,255,.14); color:#fff;
    display:grid; place-items:center;
  }

  @media (max-width:860px){
    .room{
      grid-template-columns:minmax(0,1fr); gap:26px; padding-block:56px 32px;
      justify-items:center;
    }
    .tools{flex-direction:row; align-self:center; margin-top:0}
    .archive{width:100%; max-width:420px}
    .stack{flex-direction:row; flex-wrap:wrap; gap:10px; justify-content:center}
    .stack li{width:74px}
    .card{margin-top:0 !important; opacity:1 !important; width:74px}
  }
</style>
</head>
<body>
<div class="wordmark">CYBORG NEWS</div>

${manifest.length ? `<main class="room">
  <div class="viewer">
    <figure class="sheet" id="sheet">
      <canvas id="canvas"></canvas>
      <div class="fall" id="fall" hidden>
        <img id="fallimg" alt="" hidden>
        <span id="fallnote">OPEN THE PDF</span>
      </div>
      <div class="state" id="state">LOADING</div>
    </figure>
    <div class="pager">
      <button class="pill" id="prev" type="button" disabled>PREV</button>
      <button class="pill" id="next" type="button" disabled>NEXT</button>
    </div>
  </div>

  <div class="tools">
    <button class="tool" id="expand" type="button" title="Full screen" aria-label="Full screen">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"/></svg>
    </button>
    <a class="tool" id="dl" download title="Download PDF" aria-label="Download PDF">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v13M6 12l6 6 6-6"/></svg>
    </a>
  </div>

  <nav class="archive">
    <h2>PREVIOUS ISSUES</h2>
    <ul class="stack" id="stack"></ul>
  </nav>
</main>` : `<main class="room"><p class="empty-state">No issue has printed yet. The first one is set on Sunday.</p></main>`}

<dialog class="big" id="big">
  <button class="close" id="bigclose" type="button" aria-label="Close">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
  </button>
  <canvas id="bigcanvas"></canvas>
</dialog>

<script src="${PDFJS}/pdf.min.js"></script>
<script>
const ISSUES = ${JSON.stringify(manifest)};
if (ISSUES.length) {
  const $ = id => document.getElementById(id);
  const docs = new Map();            // one fetch per issue, however often it is opened
  let issue = 0, page = 1, pages = 1, token = 0;

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '${PDFJS}/pdf.worker.min.js';
  }

  const say = t => { const s = $('state'); s.textContent = t; s.hidden = !t; };

  function openDoc(url) {
    if (!docs.has(url)) docs.set(url, pdfjsLib.getDocument(url).promise);
    return docs.get(url);
  }

  async function draw(canvas, pdfPage, cssWidth) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const base = pdfPage.getViewport({ scale: 1 });
    const vp = pdfPage.getViewport({ scale: (cssWidth * dpr) / base.width });
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = Math.round(vp.height / dpr) + 'px';
    await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  }

  async function paint() {
    const e = ISSUES[issue];
    const mine = ++token;                      // a later click must win
    $('dl').href = e.pdf;
    $('dl').setAttribute('download', 'cyborg-news-' + e.date + '.pdf');
    document.querySelectorAll('.card').forEach((c, i) =>
      c.setAttribute('aria-current', String(i === issue)));

    /* A reader must never sit on LOADING for ever. pdf.js can hang without
       ever rejecting — its worker simply stops — so the render is raced
       against a clock and the page falls back to the thumbnail and a plain
       download rather than showing nothing at all. */
    const fallback = msg => {
      say('');
      $('canvas').hidden = true;
      $('fallimg').src = e.thumb || '';
      $('fallimg').hidden = !e.thumb;
      $('fall').hidden = false;
      $('fallnote').textContent = msg;
      document.body.dataset.ready = 'fallback';
    };
    const ok = () => {
      $('fall').hidden = true;
      $('canvas').hidden = false;
      say('');
      document.body.dataset.ready = '1';
    };

    if (!window.pdfjsLib) { fallback('OPEN THE PDF'); return; }
    say('LOADING');
    $('fall').hidden = true;
    $('canvas').hidden = false;
    try {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000));
      const doc = await Promise.race([openDoc(e.pdf), timeout]);
      if (mine !== token) return;
      pages = doc.numPages;
      if (page > pages) page = 1;
      const p = await Promise.race([doc.getPage(page), timeout]);
      if (mine !== token) return;
      await Promise.race([draw($('canvas'), p, $('sheet').clientWidth), timeout]);
      if (mine !== token) return;
      ok();
    } catch (err) {
      if (mine !== token) return;
      docs.delete(e.pdf);                  // a hung load must not be cached
      fallback('OPEN THE PDF');
    }
    $('prev').disabled = page <= 1;
    $('next').disabled = page >= pages;
  }

  // the receding stack: each sheet clearly smaller and quieter than the one
  // above, overlapping enough to read as a pile rather than a list
  $('stack').innerHTML = ISSUES.map((e, i) => {
    const w = Math.max(42, 100 - i * 22);
    const op = Math.max(.4, 1 - i * .2);
    const art = e.thumb
      ? '<img src="' + e.thumb + '" alt="" loading="lazy">'
      : '<span class="none">PDF</span>';
    return '<li style="width:' + w + '%">' +
      '<button class="card" type="button" data-i="' + i + '" title="' + e.long + '" ' +
      'style="margin-top:' + (i ? -34 : 0) + 'px;opacity:' + op.toFixed(2) + ';z-index:' + (99 - i) + '">' +
      art + '</button></li>';
  }).join('');

  $('stack').addEventListener('click', ev => {
    const b = ev.target.closest('.card');
    if (!b) return;
    issue = Number(b.dataset.i); page = 1; paint();
  });
  $('prev').addEventListener('click', () => { if (page > 1) { page--; paint(); } });
  $('next').addEventListener('click', () => { if (page < pages) { page++; paint(); } });

  $('expand').addEventListener('click', async () => {
    const e = ISSUES[issue];
    if (!window.pdfjsLib) { window.open(e.pdf, '_blank'); return; }
    $('big').showModal();
    const doc = await openDoc(e.pdf);
    const p = await doc.getPage(page);
    await draw($('bigcanvas'), p, Math.min(window.innerWidth * .94, 1100));
  });
  $('bigclose').addEventListener('click', () => $('big').close());
  $('big').addEventListener('click', ev => { if (ev.target.id === 'big') $('big').close(); });

  addEventListener('keydown', ev => {
    if (ev.key === 'ArrowRight') $('next').click();
    if (ev.key === 'ArrowLeft') $('prev').click();
  });

  let t;
  addEventListener('resize', () => { clearTimeout(t); t = setTimeout(paint, 200); });

  paint();
}
</script>
</body>
</html>
`;

/* --- write the site ---------------------------------------------------- */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'issues'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), page);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');   // keep Pages off Jekyll

let bytes = 0;
for (const e of editions) {
  const dst = path.join(OUT, 'issues', e.date);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of ['paper.pdf', 'thumb.webp']) {
    const from = path.join(ISSUES, e.date, f);
    if (!fs.existsSync(from)) continue;
    fs.copyFileSync(from, path.join(dst, f));
    bytes += fs.statSync(from).size;
  }
}

console.log(`\nsite/ built — ${editions.length} issue${editions.length === 1 ? '' : 's'}, ` +
  `${Math.round(bytes / 1024)} KB served`);
for (const e of editions) {
  console.log(`  ${e.date}  ${String(e.kb).padStart(4)} KB pdf  ` +
    `${e.hasThumb ? 'thumb' : 'no thumb'}  ${(e.lead || '').slice(0, 40)}`);
}
if (!editions.length) console.log('  (nothing printed yet)');
