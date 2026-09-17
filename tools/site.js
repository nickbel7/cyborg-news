#!/usr/bin/env node
/* =========================================================================
   site.js — build the reader: the current issue large and centred, with
   every issue ever printed receding behind it in a dated carousel.

   The viewer renders the committed PDF with pdf.js rather than shipping page
   images beside it. That was measured, not assumed: a page of this paper is
   a clustered-dot halftone — high-frequency noise that lossy codecs cannot
   compress. Dropping WebP quality from 78 to 55 moved a two-page issue only
   from 2,019KB to 1,733KB, so images would have added about 90MB a year of
   pixels duplicating a 937KB PDF that already contains them. Rendering the
   PDF costs nothing in the repository and stays sharp at any zoom. Only an
   84KB thumbnail per issue is committed, for the carousel.

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

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const stamp = d => {
  const [y, m, day] = d.split('-');
  return `${Number(day)} ${MON[Number(m) - 1]} ${y}`;
};
const longDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US',
  { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toUpperCase();

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
      long: issue?.issue?.dateline_long || longDate(d),
      volume: issue?.issue?.volume || '',
      lead: arts[0]?.headline || null,
      hasThumb: fs.existsSync(path.join(dir, 'thumb.webp')),
      kb: Math.round(fs.statSync(path.join(dir, 'paper.pdf')).size / 1024)
    };
  });

const manifest = editions.map(e => ({
  date: e.date, long: e.long, volume: e.volume, lead: e.lead, kb: e.kb,
  label: stamp(e.date),
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Libre+Franklin:wght@500;600&display=swap">
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
    --rail:210px;             /* the carousel's column */
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{
    margin:0; background:var(--paper); color:var(--ink);
    font-family:'Libre Franklin',system-ui,-apple-system,'Segoe UI',sans-serif;
    font-size:14px; -webkit-font-smoothing:antialiased;
    padding-left:20px; padding-right:20px; padding-block:0;
  }

  /* The paper is centred in the window; the carousel floats at the right so
     it cannot pull the sheet off centre. */
  /* The paper takes whatever height is left once the dateline and the pager
     have had theirs, so it is always as large as the window allows and can
     never collide with them. An absolutely positioned dateline did collide:
     growing the sheet pushed its top edge up over the volume line. */
  .room{
    min-height:100vh; display:flex; flex-direction:column;
    align-items:center; gap:10px;
    padding-block:20px 16px;
  }

  /* the masthead date, set in the newspaper's own display face */
  .dateline{text-align:center; flex:0 0 auto; max-width:92vw}
  .dateline .day{
    font-family:'Playfair Display',Georgia,serif; font-weight:700;
    font-size:clamp(15px,2.1vw,21px); letter-spacing:.02em; margin:0;
  }

  /* sheet + its tools travel together, and the pair is centred.

     align-items is flex-start, not center. .tools is absolutely positioned
     with top:0, which anchors it to .stage's own top edge. .sheet's height
     (calc(100vh - 150px)) is only an estimate of what the dateline and
     pager need, so it rarely fills .stage exactly — centering .sheet then
     left a gap between .stage's top and .sheet's top that .tools, pinned to
     .stage, did not share, so the two drifted apart. flex-start makes
     .sheet's top edge coincide with .stage's top edge always, which is
     exactly where .tools is anchored, so they align by construction rather
     than by matching a guessed number. Any leftover space falls below the
     sheet instead of being split top and bottom, which costs nothing here
     since nothing sits under it but the pager. */
  .stage{
    position:relative; flex:1 1 auto; min-height:0;
    display:flex; align-items:flex-start; justify-content:center;
  }
  .sheet{
    position:relative; aspect-ratio:1123/1587;
    /* A definite height. A percentage height inside a flex item has no
       definite parent height to resolve against, so the sheet silently fell
       back to sizing from its aspect-ratio and shrank to 424px. This leaves
       exactly the room the dateline, the pager and the padding need, and
       gives the paper everything else. (No backticks in here: this stylesheet
       lives inside a template literal.) */
    height:min(calc(100vh - 150px), 1320px); width:auto; max-width:min(92vw, 820px);
    background:var(--sheet); border-radius:2px; margin:0;
    box-shadow:
      0 1px 1px rgba(20,19,16,.05),
      0 10px 22px rgba(20,19,16,.08),
      0 32px 60px rgba(20,19,16,.10);
    overflow:hidden;
  }
  .sheet canvas{width:100%; height:100%; display:block}
  .sheet canvas[hidden]{display:none}
  .sheet .state{
    position:absolute; inset:0; display:grid; place-items:center;
    font-size:11px; letter-spacing:.14em; color:var(--chip-ink);
  }
  .sheet .state[hidden]{display:none}
  .sheet .fall{position:absolute; inset:0}
  .sheet .fall[hidden]{display:none}
  .sheet .fall img{width:100%; height:100%; object-fit:cover; object-position:top center;
                   display:block; opacity:.45; filter:saturate(0)}
  .sheet .fall img[hidden]{display:none}
  .sheet .fall span{
    position:absolute; inset:0; display:grid; place-items:center;
    font-size:11px; font-weight:600; letter-spacing:.14em; color:var(--muted);
  }

  /* hugging the sheet, not the archive */
  .tools{
    position:absolute; left:calc(100% + 14px); top:0;
    display:flex; flex-direction:column; gap:12px;
  }
  /* One of these is a button and one is an anchor. Resetting the border but
     not the padding left the button carrying the browser's default padding,
     so the two glyphs sat at different offsets inside their circles. */
  .tool{
    appearance:none; border:0; padding:0; margin:0; line-height:0;
    box-sizing:border-box; font:inherit;
    cursor:pointer; width:42px; height:42px; border-radius:50%;
    background:var(--chip); color:var(--ink); display:grid; place-items:center;
    transition:background .15s, transform .15s; text-decoration:none;
  }
  .tool:hover{background:#dedbd5}
  .tool:active{transform:translateY(1px)}
  .tool svg{width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.9;
            stroke-linecap:round; stroke-linejoin:round}

  .pager{display:flex; gap:10px}
  .pill{
    appearance:none; border:0; cursor:pointer; font:inherit; font-weight:600;
    font-size:11px; letter-spacing:.12em; padding:10px 22px; border-radius:999px;
    background:var(--go); color:var(--go-ink); transition:opacity .15s, transform .15s;
  }
  .pill:hover{opacity:.85}
  .pill:active{transform:translateY(1px)}
  .pill[disabled]{background:var(--chip); color:var(--chip-ink); cursor:default}
  .pill[disabled]:hover{opacity:1}

  /* ---- the carousel: a pile of sheets receding down and away ---------- */
  .archive{
    position:fixed; right:26px; top:50%; transform:translateY(-50%);
    width:var(--rail); text-align:center; z-index:4;
  }
  .archive h2{
    font-size:10px; font-weight:600; letter-spacing:.16em; color:var(--muted);
    margin:0 0 20px;
  }
  /* A wheel over this area drives the carousel: every card's position and
     zoom is computed per frame from a scroll offset that eases toward its
     target, which is what makes it move smoothly rather than snapping
     between fixed poses. */
  .deck{
    position:relative; height:min(62vh, 545px); margin:0 auto;
    overflow:hidden; touch-action:none; cursor:ns-resize;
  }
  .card{
    appearance:none; border:0; padding:0; cursor:pointer;
    position:absolute; top:0; left:50%; width:140px;
    background:transparent; color:inherit;
    transform-origin:top center; will-change:transform,opacity;
  }
  .card .sheetlet{
    position:relative; display:block; width:100%; aspect-ratio:1123/1587;
    overflow:hidden; background:var(--sheet); border-radius:12px;
    box-shadow:0 2px 8px rgba(20,19,16,.10), 0 20px 38px rgba(20,19,16,.14);
  }
  .card img{width:100%; height:100%; object-fit:cover; object-position:top center; display:block}
  .card .none{position:absolute; inset:0; display:grid; place-items:center;
              font-size:9px; letter-spacing:.12em; color:var(--chip-ink)}
  /* the date rides the bottom edge, which stays visible as cards recede */
  .card .when{
    position:absolute; left:0; right:0; bottom:0; padding:14px 0 7px;
    font-size:9px; font-weight:600; letter-spacing:.13em; color:var(--ink);
    background:linear-gradient(to top, rgba(251,250,248,.96) 55%, rgba(251,250,248,0));
  }
  .card:hover{filter:brightness(.97)}
  /* the plate that closes the carousel */
  .endcap{cursor:default}
  .endcap .sheetlet{
    background:var(--chip);
    box-shadow:0 1px 4px rgba(20,19,16,.05), 0 10px 20px rgba(20,19,16,.06);
  }
  .endcap .endtext{
    position:absolute; inset:0; display:grid; place-items:center; text-align:center;
    padding:0 14px; font-size:10px; font-weight:600; letter-spacing:.14em;
    line-height:1.7; color:var(--chip-ink);
  }

  .empty-state{color:var(--muted); font-size:13px}

  /* ---- full screen: every page, scrolled like a PDF ------------------- */
  dialog.big{
    border:0; padding:0; background:transparent; width:100%; height:100%;
    max-width:100vw; max-height:100vh; margin:0; overflow-y:auto; overscroll-behavior:contain;
  }
  /* near-opaque: at 8% transparency the archive rail ghosted through the
     backdrop and read as a rendering fault rather than depth */
  dialog.big::backdrop{background:rgba(20,19,16,.975)}
  .reel{display:flex; flex-direction:column; align-items:center; gap:22px; padding:26px 0 40px}
  .reel canvas{
    display:block; width:min(92vw,1020px); height:auto;
    box-shadow:0 24px 70px rgba(0,0,0,.5); background:var(--sheet);
  }
  .reel .loading{color:#bdb9b1; font-size:11px; letter-spacing:.14em; padding:40px 0}
  dialog.big .close{
    position:fixed; top:20px; right:22px; width:40px; height:40px; border-radius:50%;
    border:0; cursor:pointer; background:rgba(255,255,255,.16); color:#fff;
    display:grid; place-items:center; z-index:2;
  }

  @media (max-width:1000px){
    .archive{position:static; transform:none; width:100%; max-width:420px; margin:8px auto 0}
    .deck{height:auto; display:flex; flex-wrap:wrap; gap:12px; justify-content:center}
    .card{position:static; transform:none !important; opacity:1 !important; width:84px}
    .card .when{position:static; background:none; padding:6px 0 0; color:var(--muted)}
    .tools{position:static; flex-direction:row; margin-top:14px; justify-content:center}
    .stage{flex-direction:column; align-items:center}
    .sheet{height:auto; width:min(92vw,540px)}
  }
</style>
</head>
<body>
${manifest.length ? `<main class="room">
  <div class="dateline">
    <p class="day" id="dateline">&nbsp;</p>
  </div>

  <div class="stage">
    <figure class="sheet" id="sheet">
      <canvas id="canvas"></canvas>
      <div class="fall" id="fall" hidden>
        <img id="fallimg" alt="" hidden>
        <span id="fallnote">OPEN THE PDF</span>
      </div>
      <div class="state" id="state">LOADING</div>
    </figure>
    <div class="tools">
      <button class="tool" id="expand" type="button" title="Full screen" aria-label="Full screen">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"/></svg>
      </button>
      <a class="tool" id="dl" download title="Download PDF" aria-label="Download PDF">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>
      </a>
    </div>
  </div>

  <div class="pager">
    <button class="pill" id="prev" type="button" disabled>PREV</button>
    <button class="pill" id="next" type="button" disabled>NEXT</button>
  </div>
</main>

<nav class="archive">
  <h2>PREVIOUS ISSUES</h2>
  <div class="deck" id="deck"></div>
</nav>` : `<main class="room"><p class="empty-state">No issue has printed yet. The first one is set on Sunday.</p></main>`}

<dialog class="big" id="big">
  <button class="close" id="bigclose" type="button" aria-label="Close">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
  </button>
  <div class="reel" id="reel"></div>
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
  const openDoc = url => {
    if (!docs.has(url)) docs.set(url, pdfjsLib.getDocument(url).promise);
    return docs.get(url);
  };

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
    const mine = ++token;
    $('dateline').textContent = e.long;
    $('dl').href = e.pdf;
    $('dl').setAttribute('download', 'cyborg-news-' + e.date + '.pdf');

    /* A reader must never sit on LOADING for ever. pdf.js can hang without
       ever rejecting, so the render is raced against a clock and falls back
       to the thumbnail rather than showing nothing at all. */
    const fallback = () => {
      say(''); $('canvas').hidden = true;
      $('fallimg').src = e.thumb || ''; $('fallimg').hidden = !e.thumb;
      $('fall').hidden = false;
      document.body.dataset.ready = 'fallback';
    };

    if (!window.pdfjsLib) { fallback(); return; }
    say('LOADING'); $('fall').hidden = true; $('canvas').hidden = false;
    try {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000));
      const doc = await Promise.race([openDoc(e.pdf), timeout]);
      if (mine !== token) return;
      pages = doc.numPages;
      if (page > pages) page = 1;
      const p = await Promise.race([doc.getPage(page), timeout]);
      if (mine !== token) return;
      const box = $('sheet').getBoundingClientRect();
      await Promise.race([draw($('canvas'), p, Math.round(box.width)), timeout]);
      if (mine !== token) return;
      $('fall').hidden = true; $('canvas').hidden = false; say('');
      document.body.dataset.ready = '1';
    } catch (err) {
      if (mine !== token) return;
      docs.delete(e.pdf);
      fallback();
    }
    $('prev').disabled = page <= 1;
    $('next').disabled = page >= pages;
  }

  /* ---- the carousel ---------------------------------------------------
     A vertical wheel of sheets. The card at the front is full size; the
     ones behind recede down and away, each smaller and quieter than the
     one before. A wheel over the rail moves a continuous offset, and every
     card's zoom and position is recomputed from it each frame, so the
     whole stack telescopes smoothly under the cursor instead of jumping
     between poses. Clicking a card is what changes issue — prev and next
     never leave the paper you are reading. */
  const flat = () => window.matchMedia('(max-width:1000px)').matches;
  let cards = [], focus = 0, aim = 0, running = false;

  /* The rail is PREVIOUS issues, so the one on the table is not in it. The
     last plate is the end of the archive: reaching it, or having nothing to
     show at all, says so rather than leaving a void. */
  function build() {
    const others = ISSUES.map((e, i) => ({ e, i })).filter(x => x.i !== issue);
    const sheets = others.map(({ e, i }) => {
      const art = e.thumb
        ? '<img src="' + e.thumb + '" alt="" loading="lazy">'
        : '<span class="none">PDF</span>';
      return '<button class="card" type="button" data-i="' + i + '" title="' + e.long + '">' +
        '<span class="sheetlet">' + art + '<span class="when">' + e.label + '</span></span>' +
        '</button>';
    });
    sheets.push('<div class="card endcap"><span class="sheetlet">' +
      '<span class="endtext">SORRY,<br>WE RAN OUT</span></span></div>');
    $('deck').innerHTML = sheets.join('');
    cards = [].slice.call($('deck').querySelectorAll('.card'));
    focus = 0; aim = 0;
  }

  function layout() {
    if (flat()) { cards.forEach(c => { c.style.transform = ''; c.style.opacity = ''; }); return; }
    const W = 140, H = W * 1587 / 1123;                      // a sheet at the front
    cards.forEach((c, i) => {
      const d = i - focus;                                   // 0 = at the front
      const s = d >= 0 ? Math.max(0.40, 1 - 0.15 * d) : 1;   // zoom by depth
      /* Each sheet starts near the foot of the one in front of it, so the
         stack telescopes. Stepping by a flat 46px hid every card but the
         first behind it and clipped their dates. The sum of the shrinking
         card heights, in closed form so it stays smooth for a fractional
         scroll position. */
      const y = d >= 0 ? H * 0.72 * (d - 0.075 * d * (d - 1)) : d * H * 0.8;
      const o = d >= 0 ? Math.max(0, 1 - 0.17 * d) : Math.max(0, 1 + d);
      c.style.transform = 'translateX(-50%) translateY(' + y.toFixed(1) + 'px) scale(' + s.toFixed(3) + ')';
      c.style.opacity = o.toFixed(2);
      c.style.zIndex = String(200 - Math.round(d * 10));
      c.style.pointerEvents = o < 0.08 ? 'none' : 'auto';
    });
  }

  function glide() {
    running = true;
    const step = () => {
      focus += (aim - focus) * 0.18;
      if (Math.abs(aim - focus) < 0.002) { focus = aim; layout(); running = false; return; }
      layout();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const aimAt = v => {
    aim = Math.max(0, Math.min(ISSUES.length - 1, v));
    if (!running) glide();
  };

  $('deck').addEventListener('wheel', ev => {
    if (flat()) return;
    ev.preventDefault();                     // the rail scrolls, not the page
    aimAt(aim + ev.deltaY / 220);
  }, { passive: false });

  /* dragging works too, for trackpads and touch */
  let dragging = false, lastY = 0;
  $('deck').addEventListener('pointerdown', ev => {
    if (flat()) return;
    dragging = true; lastY = ev.clientY; $('deck').setPointerCapture(ev.pointerId);
  });
  $('deck').addEventListener('pointermove', ev => {
    if (!dragging) return;
    aimAt(aim - (ev.clientY - lastY) / 90);
    lastY = ev.clientY;
  });
  const drop = () => { dragging = false; };
  $('deck').addEventListener('pointerup', drop);
  $('deck').addEventListener('pointercancel', drop);

  $('deck').addEventListener('click', ev => {
    const b = ev.target.closest('.card');
    if (!b || !b.dataset.i) return;            // the end plate is not a link
    const i = Number(b.dataset.i);
    if (i === issue) return;
    issue = i; page = 1;
    build(); layout(); paint();                // the rail's membership changed
  });

  addEventListener('resize', () => layout());

  $('prev').addEventListener('click', () => { if (page > 1) { page--; paint(); } });
  $('next').addEventListener('click', () => { if (page < pages) { page++; paint(); } });

  /* Full screen shows the whole paper as one scrolling reel — no controls,
     the way a PDF reads. */
  $('expand').addEventListener('click', async () => {
    const e = ISSUES[issue];
    if (!window.pdfjsLib) { window.open(e.pdf, '_blank'); return; }
    $('reel').innerHTML = '<p class="loading">LOADING</p>';
    $('big').showModal();
    try {
      const doc = await openDoc(e.pdf);
      const width = Math.min(window.innerWidth * 0.92, 1020);
      $('reel').innerHTML = '';
      for (let n = 1; n <= doc.numPages; n++) {
        const c = document.createElement('canvas');
        $('reel').appendChild(c);
        await draw(c, await doc.getPage(n), width);
      }
    } catch (err) {
      $('reel').innerHTML = '<p class="loading">COULD NOT RENDER \\u2014 OPEN THE PDF</p>';
    }
  });
  const shut = () => { $('big').close(); $('reel').innerHTML = ''; };
  $('bigclose').addEventListener('click', shut);
  $('big').addEventListener('click', ev => { if (ev.target.id === 'big') shut(); });

  addEventListener('keydown', ev => {
    if ($('big').open) return;                 // full screen scrolls, it does not page
    if (ev.key === 'ArrowRight') $('next').click();
    if (ev.key === 'ArrowLeft') $('prev').click();
  });

  let t;
  addEventListener('resize', () => { clearTimeout(t); t = setTimeout(paint, 200); });

  build();
  layout();
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
