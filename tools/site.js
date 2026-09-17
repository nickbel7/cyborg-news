#!/usr/bin/env node
/* =========================================================================
   site.js — build the reader: a front page listing every issue ever printed,
   with the PDFs beside it.

   Static files only, so GitHub Pages can serve it with nothing running. The
   archive is read from issues/<date>/, which is what run.js files after a
   build passes the gate — meaning the site cannot show an issue that never
   printed.

     node tools/site.js          issues/ -> site/
   ========================================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'site');
const ISSUES = path.join(ROOT, 'issues');

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
      volume: issue?.issue?.volume || '',
      kb: Math.round(fs.statSync(path.join(dir, 'paper.pdf')).size / 1024),
      lead: arts[0]?.headline || null,
      deck: arts[0]?.deck || null,
      also: arts.slice(1, 4).map(a => a.headline).filter(Boolean),
      count: arts.length
    };
  });

const card = (e, i) => `
      <article class="issue${i === 0 ? ' latest' : ''}">
        <a class="wrap" href="issues/${esc(e.date)}/paper.pdf">
          <p class="when">${esc(e.long)}${e.volume ? ` &middot; ${esc(e.volume)}` : ''}</p>
          ${e.lead ? `<h2>${esc(e.lead)}</h2>` : `<h2>Issue of ${esc(e.date)}</h2>`}
          ${e.deck ? `<p class="deck">${esc(e.deck)}</p>` : ''}
          ${e.also.length ? `<ul class="also">${e.also.map(h => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
          <p class="meta">${e.count} stories &middot; 2 pages, A3 &middot; ${e.kb} KB PDF</p>
        </a>
      </article>`;

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CYBORG NEWS</title>
<meta name="description" content="A printed newspaper for the lab, set weekly from the week's reporting on AI, policy and cognition.">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=Libre+Franklin:wght@500;700&display=swap">
<style>
  :root{
    --ink:#14130f; --paper:#f7f5ef; --rule:#cdc8ba; --muted:#5f5a4e; --accent:#7a1f12;
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      --ink:#ece8dd; --paper:#14130f; --rule:#3a3730; --muted:#9a9384; --accent:#d4826f;
    }
  }
  :root[data-theme="dark"]{
    --ink:#ece8dd; --paper:#14130f; --rule:#3a3730; --muted:#9a9384; --accent:#d4826f;
  }
  *{box-sizing:border-box}
  body{
    margin:0; background:var(--paper); color:var(--ink);
    font-family:'Source Serif 4',Georgia,'Times New Roman',serif;
    font-size:17px; line-height:1.5;
    padding-block:0; padding-left:16px; padding-right:16px;
  }
  .sheet{max-width:940px; margin:0 auto}
  header{border-bottom:3px solid var(--ink); padding-block:28px 10px}
  .ears{
    display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;
    font-family:'Libre Franklin',system-ui,sans-serif; font-size:11px;
    letter-spacing:.12em; text-transform:uppercase; color:var(--muted);
  }
  h1{
    font-family:'Playfair Display',Georgia,serif; font-weight:900;
    font-size:clamp(2.6rem,11vw,5.6rem); line-height:.92; margin:.12em 0 .16em;
    letter-spacing:-.02em; text-wrap:balance;
  }
  .standfirst{
    font-size:1.02rem; color:var(--muted); margin:0 0 6px; max-width:62ch;
  }
  main{padding-block:26px 8px; display:grid; gap:0}
  .issue{border-bottom:1px solid var(--rule)}
  .issue .wrap{display:block; padding-block:22px; color:inherit; text-decoration:none}
  .issue .wrap:hover h2, .issue .wrap:focus-visible h2{color:var(--accent); text-decoration:underline}
  .wrap:focus-visible{outline:2px solid var(--accent); outline-offset:3px}
  .when{
    font-family:'Libre Franklin',system-ui,sans-serif; font-size:11px; letter-spacing:.12em;
    text-transform:uppercase; color:var(--muted); margin:0 0 6px;
  }
  .issue h2{
    font-family:'Playfair Display',Georgia,serif; font-weight:700;
    font-size:1.6rem; line-height:1.14; margin:0; text-wrap:balance;
  }
  .latest h2{font-size:clamp(1.9rem,4.4vw,2.6rem); font-weight:900}
  .deck{margin:.5em 0 0; color:var(--muted); max-width:64ch}
  .also{
    margin:.7em 0 0; padding:0; list-style:none; display:flex; flex-wrap:wrap; gap:6px 18px;
    font-size:.92rem; color:var(--muted);
  }
  .also li{position:relative; padding-left:14px}
  .also li::before{content:'▪'; position:absolute; left:0; color:var(--rule)}
  .meta{
    font-family:'Libre Franklin',system-ui,sans-serif; font-size:11px; letter-spacing:.08em;
    text-transform:uppercase; color:var(--muted); margin:.9em 0 0;
  }
  .empty{padding-block:60px; color:var(--muted)}
  footer{
    border-top:3px solid var(--ink); margin-top:8px; padding-block:18px 40px;
    font-family:'Libre Franklin',system-ui,sans-serif; font-size:11px;
    letter-spacing:.09em; text-transform:uppercase; color:var(--muted);
    display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;
  }
  footer a{color:inherit}
</style>
</head>
<body>
<div class="sheet">
  <header>
    <div class="ears"><span>MIT &middot; Cambridge, Mass.</span><span>Free to humans</span></div>
    <h1>CYBORG NEWS</h1>
    <p class="standfirst">Set every Sunday from the week&rsquo;s reporting on models, policy and
    cognition. Two pages, A3, printed double-sided. Every quotation is checked against its
    source and every photograph carries its licence before an issue is allowed to print.</p>
  </header>

  <main>
${editions.length ? editions.map(card).join('\n') :
  '      <p class="empty">No issue has printed yet. The first one is set on Sunday.</p>'}
  </main>

  <footer>
    <span>${editions.length} issue${editions.length === 1 ? '' : 's'} archived</span>
    <span><a href="https://github.com/nickbel7/cyborg-news">Built openly on GitHub</a></span>
  </footer>
</div>
</body>
</html>
`;

/* --- write the site ---------------------------------------------------- */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'issues'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), page);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');   // keep Pages off Jekyll

for (const e of editions) {
  const dst = path.join(OUT, 'issues', e.date);
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(path.join(ISSUES, e.date, 'paper.pdf'), path.join(dst, 'paper.pdf'));
}

console.log(`\nsite/ built — ${editions.length} issue${editions.length === 1 ? '' : 's'}`);
for (const e of editions) console.log(`  ${e.date}  ${e.kb.toString().padStart(4)} KB  ${(e.lead || '').slice(0, 56)}`);
if (!editions.length) console.log('  (nothing printed yet)');
