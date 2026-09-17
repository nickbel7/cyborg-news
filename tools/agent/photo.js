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
    if (article.art?.src) { jobs.push({ article, spec: asn.photo, done: true }); continue; }
    jobs.push({ article, spec: asn.photo, done: false });
  }

  console.log(`\n${jobs.length} stories were planned to carry a photograph`);

  for (const job of jobs) {
    const { article, spec } = job;
    if (job.done) { console.log(`  ${article.id}: already sourced, left alone`); continue; }

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
