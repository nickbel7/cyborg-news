#!/usr/bin/env node
/* =========================================================================
   photo.js — find a real photograph for each story that was planned to carry
   one, and prove it may be printed.

   Wikimedia Commons only, and only licences that permit reuse. The licence
   is recorded next to the file and printed under the plate. A story whose
   photograph cannot be licensed loses its photograph — it never ships with
   an unattributed one, and it never quietly falls back to a diagram.

   Two things this stage learned the hard way:

   Commons search is literal. "US Capitol exterior daylight" returns nothing
   while "United States Capitol" returns thousands, so the query is walked
   from the specific down to the plain until something answers.

   The plate is a 170x60mm letterbox, so the widest file is not the best
   file — a tall image of a dome loses its subject to the crop. Candidates
   are ranked on shape first and resolution second.

   The stage is re-runnable: specs come from the plan, and a caption written
   for a photograph that could not be found is kept aside rather than lost.

     node tools/agent/photo.js       data/issue.json -> assets/img/ + credits
   ========================================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const IMG = path.join(ROOT, 'assets/img');
const ISSUE = path.join(ROOT, 'data/issue.json');
const UA = 'cyborg-news/1.0 (lab newspaper; github.com/nickbel7/cyborg-news)';

/* What a lab newspaper may reprint with a credit line. */
const OK_LICENCE = /^(cc[- ]?by(-sa)?([- ]?[0-9.]+)?|cc0|public domain|pd-|no restrictions)/i;
const MIN_W = 1200;

const clean = s => (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function api(params) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  Object.entries({ format: 'json', ...params }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error(`commons HTTP ${r.status}`);
  return r.json();
}

/* Specific first, then plainer, because a query that is too descriptive
   simply returns nothing at all. */
function ladder(spec) {
  const words = (spec.search || '').trim().split(/\s+/).filter(Boolean);
  const caps = (spec.subject || '').match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*/g) || [];
  const plain = (spec.subject || '').split(/\s+/)
    .filter(w => w.length > 4 && !/^(the|with|their|about|which|being)$/i.test(w)).slice(0, 2);
  return [...new Set([
    words.join(' '),
    words.slice(0, 3).join(' '),
    words.slice(0, 2).join(' '),
    caps.sort((a, b) => b.length - a.length)[0],
    plain.join(' ')
  ].filter(s => s && s.split(/\s+/).length >= 1))];
}

/* The plate is far wider than it is tall, so a portrait file is nearly
   useless however large it is. */
const shapeScore = c => {
  const ar = c.width / c.height;
  if (ar < 1.05) return -5;
  return -Math.abs(Math.log(ar / 1.7)) * 2 + Math.min(c.width, 6000) / 6000;
};

async function search(query) {
  const j = await api({
    action: 'query', generator: 'search', gsrsearch: `filetype:bitmap ${query}`,
    gsrnamespace: 6, gsrlimit: 24,
    prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: 2400
  });
  return Object.values(j.query?.pages || {}).map(p => {
    const ii = (p.imageinfo || [])[0];
    if (!ii) return null;
    const m = ii.extmetadata || {};
    return {
      title: p.title, width: ii.width, height: ii.height,
      url: ii.thumburl || ii.url, page: ii.descriptionurl,
      licence: clean(m.LicenseShortName?.value),
      artist: clean(m.Artist?.value) || 'Unknown',
      query
    };
  }).filter(Boolean)
    .filter(c => c.width >= MIN_W && OK_LICENCE.test(c.licence))
    .sort((a, b) => shapeScore(b) - shapeScore(a));
}

/* ---- the story's own picture --------------------------------------------------
   The photograph a story's source article ran is a picture of that story's subject, which no
   search phrase reliably finds. It is used first, and Commons is the fallback.

   This is a deliberate departure from the licensed-only rule, chosen by the owner for a paper
   they read themselves. What it still insists on: the picture comes from a page this story was
   written from, it is credited to that page's site, and its source is recorded. What it gives up
   is a reuse licence, and credits.json says so in plain words (web:true) so nothing about it
   looks licensed when it is not. */
const BAD_IMAGE = /logo|icon|favicon|avatar|sprite|placeholder|default|banner_library|wordmark|badge|\/static\//i;

function dimsOf(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };           // png
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'GIF') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };          // gif
  if (buf.length > 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {                      // webp
    const k = buf.toString('latin1', 12, 16);
    if (k === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (k === 'VP8L') { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }; }
    if (k === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {                                                                                           // jpeg
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

/* ---- a photograph found by searching the web for the story ------------------------
   Searched by what the story is about (its own headline, then the planner's description of the
   picture), not by a phrase picked for an archive. The results are a mix of press photographs,
   charts, stock art and video thumbnails, and nothing here can see, so it is ranked on what can be
   checked: a JPEG, landscape, large, from an outlet that publishes news photography, and not from
   a stock library, not a chart, logo or screenshot. */
const NEWS_HOST = /(reuters|apnews|ap\.org|cnn|nytimes|washingtonpost|wsj|bloomberg|theguardian|bbc|npr|politico|axios|cnbc|forbes|techcrunch|theverge|wired|arstechnica|engadget|fortune|time\.com|newsweek|usatoday|latimes|thehill|c-span|getty|apimages|reuters|mit\.edu|nature\.com|science\.org|scientificamerican|statnews|vox|theatlantic|newyorker|technologyreview|ft\.com|economist)/i;
const STOCK_HOST = /(dreamstime|shutterstock|istockphoto|depositphotos|alamy|123rf|adobestock|stock\.adobe|vecteezy|freepik|pngtree|pinterest|ytimg|youtube|facebook|instagram|twimg|tiktok|slideshare|researchgate|medium\.com)/i;
const NOT_A_PHOTO = /chart|graph|infographic|diagram|logo|screenshot|icon|illustration|vector|cartoon|poster|banner|thumbnail|generated|stock|ai-generated|mockup/i;

/* A caption for a picture the pipeline cannot see. The one written with the story describes the scene the
   planner asked for, which a search will not reliably have found, and a caption that describes the wrong
   picture is worse than none. So it says only what is known: the page the picture came from. */
const trim = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '\u2026' : t; };
/* No quotation marks: the gate reads anything in them as a quotation from the story and goes looking for it
   in the sources, and a page title is not one. */
const provenance = (title, site) => {
  const t = trim(String(title || '').replace(/\s*\|\s*[^|]{1,24}$/, ''), 92).replace(/[\s.\u2026]+$/, '');
  return t ? `Photograph from ${site}, from a page titled: ${t}.` : `Photograph from ${site}.`;
};

async function bingImages(query) {
  const u = 'https://www.bing.com/images/search?q=' + encodeURIComponent(query) +
            '&qft=+filterui:photo-photo+filterui:imagesize-large&form=IRFLTR&first=1';
  const r = await fetch(u, { headers: {
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'accept-language': 'en-US,en;q=0.9' } });
  if (!r.ok) throw new Error('image search HTTP ' + r.status);
  const html = await r.text();
  const out = [];
  for (const m of html.matchAll(/class="iusc"[^>]*\sm="([^"]+)"/g)) {
    try {
      const j = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
      if (j.murl) out.push({ image: j.murl, page: j.purl || j.murl, title: (j.t || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() });
    } catch {}
  }
  if (!out.length) throw new Error('image search returned no results (blocked, or the page changed)');
  return out;
}

function webScore(c) {
  let host = ''; try { host = new URL(c.image).hostname + ' ' + new URL(c.page).hostname; } catch { return -99; }
  if (!/^https:/.test(c.image)) return -99;
  if (STOCK_HOST.test(host)) return -99;
  if (NOT_A_PHOTO.test(c.title) || BAD_IMAGE.test(c.image)) return -99;
  const path = c.image.split('?')[0].toLowerCase();
  if (/\.(png|svg|gif|webp)$/.test(path)) return -99;       // press photographs are JPEGs; these are charts and graphics
  let sc = 0;
  if (/\.jpe?g$/.test(path)) sc += 2;
  if (NEWS_HOST.test(host)) sc += 3;
  return sc;
}

async function fromWeb(article, spec) {
  const queries = [article.headline, spec && spec.subject].filter(Boolean)
    .map(q => String(q).replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim());
  const pool = [];
  for (const q of queries) {
    try { const hits = await bingImages(q); hits.forEach((h, i) => pool.push({ ...h, q, rank: i })); }
    catch (e) { console.log(`    web search "${q.slice(0, 50)}": ${e.message}`); }
  }
  const ranked = pool.map(c => ({ ...c, score: webScore(c) - c.rank * 0.05 }))
    .filter(c => c.score > -50).sort((a, b) => b.score - a.score);
  const seen = new Set();
  for (const c of ranked.slice(0, 12)) {
    if (seen.has(c.image)) continue; seen.add(c.image);
    try {
      const r = await fetch(c.image, { headers: { 'user-agent': UA, referer: c.page } });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const d = dimsOf(buf);
      if (!d || d.w < 1100 || d.w / d.h < 1.3 || d.w / d.h > 3.4) continue;
      let host = ''; try { host = new URL(c.page).hostname.replace(/^www\./, ''); } catch {}
      return { buf, ext: 'jpg', url: c.image, width: d.w, height: d.h, site: host, page: c.page, q: c.q, title: c.title };
    } catch {}
  }
  return null;
}

async function fromSource(article, asn, ROOT) {
  const dir = path.join(ROOT, 'data/extracts');
  const srcs = (asn.source_ids || []).map(id => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8')); } catch { return null; }
  }).filter(e => e && e.image_url);
  for (const e of srcs) {
    let url;
    try { url = new URL(e.image_url, e.final_url || e.url).toString(); } catch { continue; }
    if (!/^https:/.test(url) || BAD_IMAGE.test(url)) { console.log(`    ${e.site}: ${url.slice(0, 70)} - looks like a logo, skipped`); continue; }
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA } });
      if (!r.ok) { console.log(`    ${e.site}: image HTTP ${r.status}`); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      const d = dimsOf(buf);
      if (!d) { console.log(`    ${e.site}: not a readable picture`); continue; }
      const ar = d.w / d.h;
      if (d.w < 800 || ar < 1.2 || ar > 3.6) { console.log(`    ${e.site}: ${d.w}x${d.h} is the wrong size or shape for the plate`); continue; }
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      const ext = /png/.test(ct) || /\.png(\?|$)/i.test(url) ? 'png' : /webp/.test(ct) || /\.webp(\?|$)/i.test(url) ? 'webp' : /gif/.test(ct) ? 'gif' : 'jpg';
      return { buf, ext, url, width: d.w, height: d.h, site: e.site || new URL(e.url).hostname, page: e.final_url || e.url };
    } catch (err) { console.log(`    ${e.site}: ${err.message}`); }
  }
  return null;
}

async function download(cand, slug) {
  const ext = (cand.url.match(/\.(jpe?g|png)(?:$|\?)/i) || [, 'jpg'])[1].toLowerCase();
  const file = `${slug}.${ext === 'jpeg' ? 'jpg' : ext}`;
  const r = await fetch(cand.url, { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error(`download HTTP ${r.status}`);
  fs.writeFileSync(path.join(IMG, file), Buffer.from(await r.arrayBuffer()));
  return file;
}

(async () => {
  const issue = JSON.parse(fs.readFileSync(ISSUE, 'utf8'));
  const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/plan.json'), 'utf8'));
  const credits = fs.existsSync(path.join(IMG, 'credits.json'))
    ? JSON.parse(fs.readFileSync(path.join(IMG, 'credits.json'), 'utf8')) : {};
  const idOf = a => a.slot.replace(/[^a-z0-9]+/gi, '-') + '-' + a.page;

  /* Rebuild the intent from the plan, so a rerun retries what failed
     instead of quietly shipping a thinner paper. */
  const jobs = [];
  for (const asn of plan.assignments.filter(a => a.photo)) {
    const article = issue.articles.find(a => a.id === idOf(asn));
    if (!article) continue;
    if (article.art?.src) { jobs.push({ article, spec: asn.photo, done: true, asn }); continue; }
    jobs.push({ article, spec: asn.photo, done: false, asn });
  }

  console.log(`\n${jobs.length} stories were planned to carry a photograph`);

  for (const job of jobs) {
    const { article, spec } = job;
    if (job.done) { console.log(`  ${article.id}: already sourced, left alone`); continue; }

    // 1. a photograph of the story, found by searching for what it is about
    const found = await fromWeb(article, spec);
    if (found) {
      const file = `${article.id}.${found.ext}`;
      fs.writeFileSync(path.join(IMG, file), found.buf);
      article.art = {
        type: 'photo', src: `assets/img/${file}`,
        capLabel: 'From the web', caption: provenance(found.title, found.site),
        credit: `${found.site} \u00b7 found on the web`,
        wmm: 170, hmm: 60, focusY: 0.22, contrast: 1.04, gain: 0.66, feather: 0.35, floor: 0.08
      };
      delete article.artCaption;
      credits[file] = {
        source: found.page, image: found.url, licence: 'Web: found by image search, no separate licence',
        web: true, artist: found.site, title: found.title || article.headline, width: found.width, height: found.height,
        query: found.q, used_for: article.id, fetched: new Date().toISOString().slice(0, 10)
      };
      console.log(`  ${article.id}: ${found.site}  ${found.width}x${found.height}  (searched "${found.q.slice(0, 48)}")`);
      continue;
    }

    // 2. the picture the story's own source ran
    const own = await fromSource(article, job.asn, ROOT);
    if (own) {
      const file = `${article.id}.${own.ext}`;
      fs.writeFileSync(path.join(IMG, file), own.buf);
      article.art = {
        type: 'photo', src: `assets/img/${file}`,
        capLabel: 'From the source', caption: provenance(article.headline, own.site),
        credit: `${own.site} \u00b7 image from the source article`,
        wmm: 170, hmm: 60, focusY: 0.4, contrast: 1.04, gain: 0.66, feather: 0.35, floor: 0.08
      };
      delete article.artCaption;
      credits[file] = {
        source: own.page, image: own.url, licence: 'Web: the source article\'s own picture, no separate licence',
        web: true, artist: own.site, title: article.headline, width: own.width, height: own.height,
        query: 'source article', used_for: article.id, fetched: new Date().toISOString().slice(0, 10)
      };
      console.log(`  ${article.id}: the source article\'s own picture (${own.site}, ${own.width}x${own.height})`);
      continue;
    }

    // 3. otherwise a licensed photograph from Commons
    let picked = null;
    for (const q of ladder(spec)) {
      try {
        const hits = await search(q);
        if (hits.length) { picked = hits[0]; break; }
        console.log(`    "${q}" — nothing reusable`);
      } catch (e) { console.log(`    "${q}" — ${e.message}`); }
    }

    // a caption written for a picture we cannot find is kept, not thrown away
    const stash = article.artCaption ||
      (article.art ? { caption: article.art.caption, capLabel: article.art.capLabel } : null);

    if (!picked) {
      console.log(`  ${article.id}: no licensable photograph, running without one`);
      if (stash) article.artCaption = stash;
      delete article.art;
      continue;
    }

    const file = await download(picked, article.id);
    article.art = {
      type: 'photo', src: `assets/img/${file}`,
      capLabel: article.art?.capLabel || stash?.capLabel || '',
      caption: article.art?.caption || stash?.caption || '',
      credit: `${picked.artist} · ${picked.licence}`,
      wmm: 170, hmm: 60, focusY: 0.4,
      contrast: 1.04, gain: 0.66, feather: 0.35, floor: 0.08
    };
    delete article.artCaption;

    credits[file] = {
      source: picked.page, licence: picked.licence, artist: picked.artist,
      title: picked.title, width: picked.width, height: picked.height,
      query: picked.query, used_for: article.id,
      fetched: new Date().toISOString().slice(0, 10)
    };
    console.log(`  ${article.id}: ${picked.title.replace(/^File:/, '').slice(0, 52)}`);
    console.log(`     ${picked.width}x${picked.height}  ${picked.licence}  ` +
                `${picked.artist.slice(0, 34)}  (matched "${picked.query}")`);
    if (!article.art.caption) console.log(`     no caption yet — rewrite this piece to get one`);
  }

  fs.writeFileSync(path.join(IMG, 'credits.json'), JSON.stringify(credits, null, 2));
  fs.writeFileSync(ISSUE, JSON.stringify(issue, null, 2));
  const got = issue.articles.filter(a => a.art?.src).length;
  console.log(`\n${got} of ${jobs.length} stories carry a photograph; licences recorded`);
})();
