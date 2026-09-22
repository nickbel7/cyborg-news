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

/* The greeter: an animated portrait in the bottom-left corner that says
   hello and points people at the paper. The frames themselves are generated
   outside this repo (an image model run through Weave, then keyed and
   sliced by scratch tooling) and dropped in assets/avatar/. The widget is
   gated on that file existing, so the site ships cleanly without it and
   switches on the moment the sheet lands. */
const AVATAR_DIR = path.join(ROOT, 'assets', 'avatar');
const avatarFile = f => fs.existsSync(path.join(AVATAR_DIR, f)) ? f : null;
const avatar = {
  /* Preferred: a sprite sheet — N same-sized frames side by side — stepped
     through with CSS steps(), so a pixel-art character stays pixel-sharp.
     A video model would interpolate between frames and smear the pixels. */
  sprite: avatarFile('sprite.png') || avatarFile('sprite.webp') || avatarFile('sprite.gif'),
  frames: 4, fps: 6, frameW: 2, frameH: 3,
  /* Fallback: a rendered loop, for a painted rather than pixel character. */
  mp4: avatarFile('idle.mp4'),
  webm: avatarFile('idle.webm'),
  poster: avatarFile('poster.webp') || avatarFile('poster.jpg') || avatarFile('poster.png')
};
if (avatar.sprite) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(AVATAR_DIR, 'sprite.json'), 'utf8'));
    Object.assign(avatar, {
      frames: j.frames || avatar.frames, fps: j.fps || avatar.fps,
      frameW: j.frameW || avatar.frameW, frameH: j.frameH || avatar.frameH,
      sequence: Array.isArray(j.sequence) && j.sequence.length ? j.sequence : null
    });
  } catch {}
}
const hasAvatar = Boolean(avatar.sprite || avatar.mp4 || avatar.webm);

/* An idle is not N equal beats: the neutral face holds for a second or
   two, a blink is gone in a tenth of one. sprite.json may therefore carry
   a `sequence` of [frame, ms] pairs, which becomes a keyframe list with
   step-end timing — each frame held for its own duration, in any order,
   with repeats. Without one the frames simply play evenly at `fps`. */
function greeterMotion() {
  const N = avatar.frames;
  if (!avatar.sequence) return {
    keyframes: '@keyframes greeterStep{to{transform:translateX(-100%)}}',
    animation: `greeterStep ${(N / avatar.fps).toFixed(3)}s steps(${N}) infinite`
  };
  const total = avatar.sequence.reduce((s, [, ms]) => s + ms, 0);
  let at = 0;
  const stops = avatar.sequence.map(([frame, ms]) => {
    const stop = `${(at / total * 100).toFixed(2)}%{transform:translateX(${(-frame * 100 / N).toFixed(3)}%)}`;
    at += ms;
    return stop;
  });
  return {
    keyframes: `@keyframes greeterStep{${stops.join('')}}`,
    animation: `greeterStep ${(total / 1000).toFixed(2)}s step-end infinite`
  };
}
const motion = hasAvatar ? greeterMotion() : null;

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

  /* Mobile paging: a circular chevron pinned to each edge of the viewport,
     not a pill with text. Hidden entirely on desktop, where the labelled
     pills under the sheet already do this job. */
  .edge{display:none}

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
    text-align:center;
    background:linear-gradient(to top, rgba(251,250,248,.96) 55%, rgba(251,250,248,0));
  }
  .card:hover{filter:brightness(.97)}
  /* The newest issue, seen from an older one. The rail is what you came
     from as well as where you are going, so the sheet that takes you back
     to the current paper is framed and named rather than left to be picked
     out of a run of dates. It only ever renders here when you are reading
     something older, since the paper on the table is never in the rail. */
  /* The ring is drawn inside the sheet, not hung around it. The deck clips
     to its own box, and the front card sits flush against the deck's top
     edge, so a ring cast outward by a box-shadow lost its top stroke. An
     inset border cannot be clipped by an ancestor whatever the overflow. */
  .card .sheetlet::after{
    content:''; position:absolute; inset:0; border-radius:12px;
    border:0 solid var(--ink); pointer-events:none;
  }
  .card .when b{
    display:block; font-size:7.5px; font-weight:700;
    letter-spacing:.18em; opacity:.68; margin-bottom:1px;
  }
  /* the sheet on the table: ringed and inverted, so the stack always says
     where you are without you having to read the dates */
  .card.is-current .sheetlet::after{border-width:3px}
  .card.is-current .when{background:var(--ink); color:var(--sheet); padding-top:6px}
  .card.is-current .when b{opacity:.72}
  .card.is-current{cursor:default}
  /* the newest, when it is not the one you are on */
  .card.is-latest .when b{color:var(--ink)}
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
    .tools{position:static; flex-direction:row; margin-top:14px; justify-content:center}
    .stage{flex-direction:column; align-items:center}
    .sheet{height:auto; width:min(92vw,540px)}

    /* A wheel-driven vertical stack is a desktop-mouse idiom; a phone pages
       with a thumb. The labelled PREV/NEXT pills are hidden and replaced by
       plain chevrons pinned to the two edges of the screen — always within
       thumb reach regardless of scroll position, and out of the way (faded)
       once the archive row below is what's actually being read. */
    .pager{display:none}
    .edge{
      display:grid; place-items:center;
      position:fixed; top:50%; transform:translateY(-50%);
      width:46px; height:46px; border-radius:50%; z-index:6;
      border:0; padding:0; margin:0; cursor:pointer;
      background:rgba(231,229,225,.92); color:var(--ink);
      box-shadow:0 3px 12px rgba(20,19,16,.14);
      transition:opacity .2s, background .15s;
      -webkit-tap-highlight-color:transparent;
    }
    .edge svg{width:20px; height:20px; fill:none; stroke:currentColor;
              stroke-width:2.1; stroke-linecap:round; stroke-linejoin:round}
    .edge-prev{left:10px}
    .edge-next{right:10px}
    .edge:active{background:rgba(216,213,207,.92)}
    .edge:disabled{opacity:.25; pointer-events:none}
    .edge.is-hidden{opacity:0; pointer-events:none}

    /* The archive, rebuilt as a real horizontally-scrolling row instead of a
       grid the small cards were wrapping into. scroll-snap-align:start plus
       scroll-padding-left means each swipe settles the next card flush
       against the same inset the row starts from, like paging through a
       stack rather than a list of little contact sheets. */
    .archive{
      position:static; transform:none; width:100%; max-width:none;
      margin:22px 0 0; text-align:left;
    }
    .archive h2{padding-left:20px}
    .deck{
      position:static; height:auto;
      display:flex; flex-wrap:nowrap; align-items:flex-start;
      gap:16px; overflow-x:auto; overflow-y:visible;
      padding:20px 20px 44px; margin:0;
      scroll-snap-type:x mandatory; scroll-padding-left:20px;
      -webkit-overflow-scrolling:touch; touch-action:pan-x; cursor:auto;
      scrollbar-width:none;
    }
    .deck::-webkit-scrollbar{display:none}
    .card{
      position:static; flex:0 0 auto; scroll-snap-align:start;
      transform-origin:center center;
      width:64vw; max-width:230px; min-width:190px;
    }
  }
  /* ---- the greeter ----------------------------------------------------
     A small framed portrait pinned to the bottom-left, with a speech
     bubble above it that cycles through a few lines. It is page chrome,
     not content: it never covers the paper, and on a phone it steps aside
     (fades) once the archive row is what is on screen. */
  .greeter{
    position:fixed; left:56px; bottom:16px; z-index:5;
    display:flex; flex-direction:column; align-items:flex-start; gap:10px;
    transition:opacity .25s;
  }
  .greeter.is-hidden{opacity:0; pointer-events:none}
  .greeter .portrait{
    appearance:none; border:0; padding:0; cursor:pointer; display:block;
    width:150px; border-radius:14px; overflow:hidden; background:var(--sheet);
    box-shadow:0 2px 6px rgba(20,19,16,.10), 0 18px 34px rgba(20,19,16,.14);
    transition:transform .2s;
  }
  .greeter .portrait:hover{transform:translateY(-2px)}
  .greeter .portrait:active{transform:translateY(0)}
  /* He hops when he speaks: up, a small squash on landing, a half-bounce. */
  @keyframes greeterHop{
    0%{transform:translateY(0)}
    30%{transform:translateY(-10px) scaleY(1.04)}
    55%{transform:translateY(0) scaleY(.96)}
    75%{transform:translateY(-3px) scaleY(1)}
    100%{transform:translateY(0)}
  }
  .greeter .portrait.is-talking{transform-origin:50% 100%; animation:greeterHop .55s cubic-bezier(.3,.7,.3,1)}
  /* A keyed sprite needs no card: the character stands on the page, with a
     shadow that follows the pixels rather than a box around them. */
  .greeter .portrait.is-cutout{
    background:transparent; box-shadow:none; border-radius:0; overflow:visible;
    filter:drop-shadow(0 4px 3px rgba(20,19,16,.12)) drop-shadow(0 14px 18px rgba(20,19,16,.14));
  }
  .greeter video, .greeter img{display:block; width:100%; height:auto}
  .greeter .poster{display:none}
  /* Sprite sheet: a window one frame wide, and inside it the whole sheet
     stepping left one frame at a time. steps(N) over translateX(-100%) of
     an image N frames wide lands on exactly frames 0..N-1 and never on the
     empty space past the last one. Nearest-neighbour scaling keeps the
     pixels square when the sheet is shown larger than it is. */
  .greeter .spriteWin{display:block; width:100%; overflow:hidden}
  .greeter .spriteWin img{
    display:block; height:100%; width:auto; max-width:none;
    image-rendering:pixelated; image-rendering:crisp-edges;
  }
  ${motion ? motion.keyframes : ''}
  .greeter .bubble{
    position:relative; max-width:230px; padding:11px 30px 11px 14px;
    background:var(--sheet); color:var(--ink); border-radius:12px;
    font-size:12.5px; line-height:1.4; font-weight:500;
    box-shadow:0 2px 6px rgba(20,19,16,.08), 0 10px 22px rgba(20,19,16,.10);
    opacity:0; transform:translateY(6px); transition:opacity .28s, transform .28s;
  }
  .greeter .bubble.is-on{opacity:1; transform:translateY(0)}
  /* the tail, pointing down at the portrait */
  .greeter .bubble::after{
    content:''; position:absolute; left:22px; bottom:-7px; width:14px; height:14px;
    background:var(--sheet); transform:rotate(45deg); border-radius:2px;
    box-shadow:3px 3px 6px rgba(20,19,16,.06);
  }
  .greeter .bubble .shut{
    appearance:none; border:0; background:transparent; cursor:pointer;
    position:absolute; top:6px; right:6px; width:20px; height:20px; border-radius:50%;
    color:var(--chip-ink); display:grid; place-items:center; padding:0;
  }
  .greeter .bubble .shut:hover{background:var(--chip); color:var(--ink)}
  .greeter .bubble .shut svg{width:11px; height:11px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round}

  @media (max-width:1000px){
    .greeter{left:34px; bottom:12px; gap:8px}
    .greeter .portrait{width:104px; border-radius:11px}
    .greeter .bubble{max-width:200px; font-size:12px; padding:9px 26px 9px 12px}
  }
  /* Motion is the one thing this element is made of, so under reduced
     motion it becomes a still: the loop is paused and the poster shown. */
  @media (prefers-reduced-motion: reduce){
    .greeter video{display:none}
    .greeter .poster{display:block}
    .greeter .spriteWin img{animation:none !important}   /* holds on frame 0 */
    .greeter .portrait{transition:none; animation:none !important}
    .greeter .bubble{transition:none}
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
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>
      </a>
    </div>
  </div>

  <div class="pager">
    <button class="pill" id="prev" type="button" disabled>PREV</button>
    <button class="pill" id="next" type="button" disabled>NEXT</button>
  </div>

  <button class="edge edge-prev" id="edgePrev" type="button" aria-label="Previous page" disabled>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
  </button>
  <button class="edge edge-next" id="edgeNext" type="button" aria-label="Next page" disabled>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
  </button>
</main>

<nav class="archive" id="archive">
  <h2>PREVIOUS ISSUES</h2>
  <div class="deck" id="deck"></div>
</nav>` : `<main class="room"><p class="empty-state">No issue has printed yet. The first one is set on Sunday.</p></main>`}

${hasAvatar ? `<aside class="greeter" id="greeter" aria-label="Greeter">
  <div class="bubble" id="greeterBubble" role="status" aria-live="polite">
    <span id="greeterText"></span>
    <button class="shut" id="greeterShut" type="button" aria-label="Dismiss">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
  </div>
  <button class="portrait${avatar.sprite ? ' is-cutout' : ''}" id="greeterPortrait" type="button" title="Say something else" aria-label="Say something else">
${avatar.sprite ? `    <span class="spriteWin" style="aspect-ratio:${avatar.frameW}/${avatar.frameH}">
      <img src="avatar/${avatar.sprite}" alt="" style="animation:${motion.animation}">
    </span>` : `    <video id="greeterVideo" autoplay muted loop playsinline${avatar.poster ? ` poster="avatar/${avatar.poster}"` : ''}>
      ${avatar.webm ? `<source src="avatar/${avatar.webm}" type="video/webm">` : ''}
      ${avatar.mp4 ? `<source src="avatar/${avatar.mp4}" type="video/mp4">` : ''}
    </video>
    ${avatar.poster ? `<img class="poster" src="avatar/${avatar.poster}" alt="">` : ''}`}
  </button>
</aside>` : ''}

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
    const atStart = page <= 1, atEnd = page >= pages;
    $('prev').disabled = atStart; $('next').disabled = atEnd;
    if ($('edgePrev')) $('edgePrev').disabled = atStart;
    if ($('edgeNext')) $('edgeNext').disabled = atEnd;
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

  /* ---- mobile: a real horizontally-scrolling row --------------------
     The card flush against the row's leading inset is "in focus"; as a
     card scrolls away from that inset it shrinks and fades. This is the
     same idea as the desktop wheel carousel — position drives zoom — but
     driven by the browser's own native momentum/snap scroll rather than a
     custom wheel/drag loop, so it inherits real touch physics instead of
     fighting them. Costs one getBoundingClientRect per card per frame,
     which is nothing for the handful of issues this rail ever holds. */
  let mobileRaf = null;
  function mobileFocus() {
    mobileRaf = null;
    if (!flat() || !cards.length) return;
    const deckBox = $('deck').getBoundingClientRect();
    const anchor = deckBox.left + 20;         // matches .deck's scroll-padding-left
    cards.forEach(c => {
      const r = c.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, r.left - anchor) / (r.width * 1.15));
      const tt = t * t;
      c.style.transform = 'scale(' + (1 - 0.16 * tt).toFixed(3) + ')';
      c.style.opacity = Math.max(0.35, 1 - 0.55 * tt).toFixed(2);
    });
  }
  const queueMobileFocus = () => { if (!mobileRaf) mobileRaf = requestAnimationFrame(mobileFocus); };

  /* Every issue is in the rail, with the one on the table marked rather
     than removed. It used to be dropped from the rail, which meant the
     membership changed on every switch: the stack rebuilt, every sheet
     below moved up a place, and the scroll position had to be thrown away
     because the indices no longer meant the same thing. Keeping the list
     fixed and marking the current sheet instead costs one card and makes
     the rail stable — it stays where you left it, and it says which sheet
     you are on. The last plate is the end of the archive: reaching it, or
     having nothing to show at all, says so rather than leaving a void. */
  function build() {
    const sheets = ISSUES.map((e, i) => {
      const art = e.thumb
        ? '<img src="' + e.thumb + '" alt="" loading="lazy">'
        : '<span class="none">PDF</span>';
      const current = i === issue;
      const latest = i === 0 && !current;
      const tag = current ? '<b>READING</b>' : latest ? '<b>LATEST</b>' : '';
      const cls = 'card' + (current ? ' is-current' : '') + (latest ? ' is-latest' : '');
      return '<button class="' + cls + '" type="button" data-i="' + i + '" ' +
        (current ? 'aria-current="true" ' : '') +
        'title="' + (current ? 'Reading — ' : latest ? 'Latest issue — ' : '') + e.long + '">' +
        '<span class="sheetlet">' + art + '<span class="when">' + tag + e.label + '</span></span>' +
        '</button>';
    });
    sheets.push('<div class="card endcap"><span class="sheetlet">' +
      '<span class="endtext">SORRY,<br>WE RAN OUT</span></span></div>');
    /* The rail keeps its place across a rebuild. The list is the same
       length and in the same order every time, so a position still means
       the same sheet afterwards. */
    const deck = $('deck');
    const keepScroll = deck.scrollLeft;
    deck.innerHTML = sheets.join('');
    cards = [].slice.call(deck.querySelectorAll('.card'));
    deck.scrollLeft = keepScroll;
    queueMobileFocus();
  }

  function layout() {
    if (flat()) {
      /* Flex items respect z-index even at position:static, so a stale
         desktop depth value or a pointer-events:none from a receded card
         would otherwise silently carry over into the mobile row. */
      cards.forEach(c => {
        c.style.transform = ''; c.style.opacity = '';
        c.style.zIndex = ''; c.style.pointerEvents = '';
      });
      queueMobileFocus();
      return;
    }
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
    aim = Math.max(0, Math.min(Math.max(0, cards.length - 1), v));
    if (!running) glide();
  };

  /* A gesture moves the stack continuously, but it comes to rest on a
     sheet rather than between two of them — the mobile row gets this from
     scroll-snap and the desktop stack had nothing equivalent, so it
     settled wherever the wheel happened to stop, half a card down. A wheel
     arrives as a stream of small deltas with no end event, so the settle
     is what happens once they stop coming; a drag has a real end. */
  let settleTimer = null;
  const settle = ms => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => aimAt(Math.round(aim)), ms);
  };

  $('deck').addEventListener('wheel', ev => {
    if (flat()) return;
    ev.preventDefault();                     // the rail scrolls, not the page
    aimAt(aim + ev.deltaY / 220);
    settle(130);
  }, { passive: false });

  /* Dragging works too, for trackpads and touch — but the pointer is only
     captured once the gesture is actually a drag, never on pointerdown.
     Capturing on pointerdown retargets every later pointer event to the
     deck, the click included, so the closest('.card') lookup in the
     handler below saw the deck and returned null: pressing a sheet did
     nothing at all, and had done nothing since the stack was built. Real
     press-and-release said so plainly — pointerdown on the IMG, pointerup
     and click on the deck — while element.click() in a test skips the
     pointer sequence entirely and never sees it. */
  const SLOP = 5;                            // px of travel before it counts as a drag
  let down = null, dragging = false, lastY = 0, travel = 0, afterDrag = false;

  $('deck').addEventListener('pointerdown', ev => {
    if (flat()) return;
    clearTimeout(settleTimer);               // a grab cancels a pending settle
    down = ev.pointerId; lastY = ev.clientY; travel = 0; dragging = false;
  });
  $('deck').addEventListener('pointermove', ev => {
    if (down === null || ev.pointerId !== down) return;
    /* A pointerup can go missing — the pointer leaves the window, another
       element takes capture, the tab loses focus mid-gesture. Without this
       the stack would stay armed and follow the bare cursor afterwards. */
    if (!ev.buttons) { drop(); return; }
    travel += Math.abs(ev.clientY - lastY);
    if (!dragging) {
      if (travel < SLOP) { lastY = ev.clientY; return; }   // still a click
      dragging = true;
      $('deck').setPointerCapture(down);      // now it is a drag, so keep the pointer
    }
    aimAt(aim - (ev.clientY - lastY) / 90);
    lastY = ev.clientY;
  });
  const drop = () => {
    if (down === null) return;
    down = null;
    if (!dragging) return;                    // a plain click: leave it to the click handler
    dragging = false;
    afterDrag = true;                         // the click that follows a drag is not a choice
    settle(0);                                // let go and it lands on a sheet
  };
  $('deck').addEventListener('pointerup', drop);
  $('deck').addEventListener('pointercancel', drop);

  $('deck').addEventListener('click', ev => {
    if (afterDrag) { afterDrag = false; return; }   // ending a drag over a sheet is not picking it
    const b = ev.target.closest('.card');
    if (!b || !b.dataset.i) return;            // the end plate is not a link
    const i = Number(b.dataset.i);
    if (i === issue) return;
    issue = i; page = 1;
    build(); layout(); paint();                // the rail's membership changed
  });

  $('deck').addEventListener('scroll', queueMobileFocus, { passive: true });

  addEventListener('resize', () => layout());

  /* One page-turn function for all four controls: the labelled pills under
     the sheet on desktop, and the two edge chevrons on mobile. */
  const go = delta => {
    const p = page + delta;
    if (p < 1 || p > pages) return;
    page = p; paint();
  };
  $('prev').addEventListener('click', () => go(-1));
  $('next').addEventListener('click', () => go(1));
  if ($('edgePrev')) $('edgePrev').addEventListener('click', () => go(-1));
  if ($('edgeNext')) $('edgeNext').addEventListener('click', () => go(1));

  /* The edge chevrons are for paging the paper, so they step out of the way
     (fade out) once the archive row they'd otherwise float over is what is
     actually on screen. */
  if ('IntersectionObserver' in window && $('archive')) {
    const edges = [$('edgePrev'), $('edgeNext')].filter(Boolean);
    new IntersectionObserver(
      entries => edges.forEach(el => el.classList.toggle('is-hidden', entries[0].isIntersecting)),
      { threshold: 0.12 }
    ).observe($('archive'));
  }

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
${hasAvatar ? `<script>
/* The greeter is its own script, deliberately outside the reader's scope:
   it must work on a page with no issues at all, and nothing in it should
   be able to break the paper. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var root = $('greeter'), bubble = $('greeterBubble'), text = $('greeterText');
  if (!root || !bubble || !text) return;

  /* He talks like a shopkeeper NPC: a greeting when you arrive, a bark
     when you do something, idle chatter in between — and he hops when he
     speaks. Every line is a joke or something true of the paper: the gate
     checks every quote, the run is on Monday, the masthead says free to
     humans. Nothing here claims anything about the lab. */
  var GREET = [
    'Oh! A reader! Come in, come in.',
    'Welcome, human. This week\\u2019s issue is hot off the press.',
    'Hey, you made it. Grab a paper!'
  ];
  var IDLE = [
    'Get yours!',
    'Extra! Extra! Read all about it.',
    'Free to humans. Cyborgs pay double.',
    'Go on, take one. They\\u2019re free.',
    'Every quote in here? Checked against its source. I\\u2019m thorough like that.',
    'New issue every Monday. I never sleep.',
    'It\\u2019s all real. I only print what I can prove.',
    'Yes, I look like the editor. Long story.',
    'Print it. Fold it. Leave it on someone\\u2019s desk.'
  ];
  var ON = {
    turn:     ['Page two\\u2019s where the good stuff is.', 'Turning pages, are we? Take your time.', 'Careful \\u2014 the ink\\u2019s still wet.'],
    download: ['Going to press! That\\u2019s the spirit.', 'One for the road. Good choice.', 'Print it. Fold it. Leave it on someone\\u2019s desk.'],
    expand:   ['Ah, the big screen. Now we\\u2019re talking.', 'Front row seat. Enjoy.'],
    pick:     ['An old one! Good taste.', 'Ah, a classic. I remember that week.'],
    empty:    ['That\\u2019s all of them. I\\u2019m new here.', 'Nothing older, sorry. Come back Monday.']
  };
  var SHOW_MS = 5200, GAP_MS = 3200, FIRST_MS = 900;
  var timer = null, dismissed = false, bag = [];
  try { dismissed = sessionStorage.getItem('greeter-off') === '1'; } catch (e) {}

  var pick = function (list) { return list[Math.floor(Math.random() * list.length)]; };
  /* Idle lines come out of a shuffled bag: nothing repeats until every
     line has been said once. */
  function nextIdle() {
    if (!bag.length) bag = IDLE.slice().sort(function () { return Math.random() - 0.5; });
    return bag.pop();
  }

  var portrait = $('greeterPortrait');
  function hop() {
    portrait.classList.remove('is-talking');
    void portrait.offsetWidth;                       // restart the animation
    portrait.classList.add('is-talking');
  }
  function say(line) {
    clearTimeout(timer);
    if (dismissed) return;
    text.textContent = line || nextIdle();
    bubble.classList.add('is-on');
    hop();
    timer = setTimeout(function () {
      bubble.classList.remove('is-on');
      timer = setTimeout(function () { say(); }, GAP_MS);
    }, SHOW_MS);
  }
  var react = function (key) { say(pick(ON[key])); };

  portrait.addEventListener('click', function () {
    if (dismissed) { dismissed = false; try { sessionStorage.removeItem('greeter-off'); } catch (e) {} }
    say();
  });
  $('greeterShut').addEventListener('click', function (ev) {
    ev.stopPropagation();
    dismissed = true; clearTimeout(timer); bubble.classList.remove('is-on');
    try { sessionStorage.setItem('greeter-off', '1'); } catch (e) {}
  });

  /* Reactions ride on the page's own controls by delegation, so this
     script never needs to know how they work — only that they were used.
     A disabled button fires no click, so there is no bark for a page turn
     that could not happen. */
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('#prev,#next,#edgePrev,#edgeNext,#dl,#expand,.card,.endcap') : null;
    if (!t || dismissed) return;
    if (t.id === 'dl') react('download');
    else if (t.id === 'expand') react('expand');
    else if (t.classList.contains('card')) react('pick');
    else if (t.classList.contains('endcap')) react('empty');
    else react('turn');
  });
  document.addEventListener('keydown', function (ev) {
    var big = $('big');
    if (big && big.open) return;
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') react('turn');
  });

  /* On a phone the archive row lives at the foot of the page, exactly
     where this sits. Step aside while that row is what is being read. */
  var flat = function () { return window.matchMedia('(max-width:1000px)').matches; };
  var archive = $('archive');
  if (archive && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      root.classList.toggle('is-hidden', flat() && entries[0].isIntersecting);
    }, { threshold: 0.12 }).observe(archive);
  }

  /* Reduced motion: the loop is hidden by CSS; pause it too so it is not
     decoding video nobody can see. */
  var v = $('greeterVideo');
  if (v && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { try { v.pause(); } catch (e) {} }

  setTimeout(function () { say(pick(GREET)); }, FIRST_MS);
})();
</script>` : ''}
</body>
</html>
`;

/* --- write the site ---------------------------------------------------- */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'issues'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), page);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');   // keep Pages off Jekyll
/* Pages is published here from an Actions artifact, not a branch, and an
   artifact-based deployment does not carry the custom domain the way a
   branch-based one does — the domain has to travel with the build output
   itself. Set via the CUSTOM_DOMAIN env var so the workflow controls it,
   not this script; leave it unset and no file is written. */
if (process.env.CUSTOM_DOMAIN) fs.writeFileSync(path.join(OUT, 'CNAME'), process.env.CUSTOM_DOMAIN.trim() + '\n');

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

/* the greeter's loop and poster, only when they exist */
if (hasAvatar) {
  const dst = path.join(OUT, 'avatar');
  fs.mkdirSync(dst, { recursive: true });
  for (const f of [avatar.sprite, avatar.mp4, avatar.webm, avatar.poster].filter(Boolean)) {
    fs.copyFileSync(path.join(AVATAR_DIR, f), path.join(dst, f));
    bytes += fs.statSync(path.join(AVATAR_DIR, f)).size;
  }
}

console.log(`\nsite/ built — ${editions.length} issue${editions.length === 1 ? '' : 's'}, ` +
  `${Math.round(bytes / 1024)} KB served` + (hasAvatar ? ', greeter on' : ', greeter off (no assets/avatar/idle.mp4 yet)'));
for (const e of editions) {
  console.log(`  ${e.date}  ${String(e.kb).padStart(4)} KB pdf  ` +
    `${e.hasThumb ? 'thumb' : 'no thumb'}  ${(e.lead || '').slice(0, 40)}`);
}
if (!editions.length) console.log('  (nothing printed yet)');
