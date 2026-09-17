#!/usr/bin/env node
/* =========================================================================
   gate.js — the checks that can fail an issue.

   Three things are verified mechanically, because all three are ways a
   language model quietly embarrasses a newspaper:

     1. every quotation appears byte for byte in a source that article was
        actually written from;
     2. every photograph has a recorded licence that permits reprinting;
     3. nothing claims anything about this laboratory, which the pipeline
        has no information about and therefore cannot report.

   Exits non-zero on any failure. Nothing downstream runs on a failed gate.

     node tools/agent/gate.js
   ========================================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const issue = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/issue.json'), 'utf8'));
const EXTRACTS = path.join(ROOT, 'data/extracts');
const IMG = path.join(ROOT, 'assets/img');

const source = id => {
  const f = path.join(EXTRACTS, id + '.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};

/* Compare the way a reader would, not the way a byte stream would: entities
   decoded, curly and straight quotes equal, whitespace collapsed. Anything
   looser than this would let a reworded quotation through. */
const norm = s => (s || '')
  .replace(/&ldquo;|&rdquo;|&quot;/g, '"').replace(/&rsquo;|&lsquo;/g, "'")
  .replace(/&mdash;|&ndash;/g, '-').replace(/&hellip;/g, '...')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/<[^>]+>/g, ' ')
  .replace(/[“”″"]/g, '').replace(/[‘’′']/g, "'")
  .replace(/[—–−]/g, '-').replace(/…/g, '...')
  .toLowerCase().replace(/\s+/g, ' ').trim();

function quotesIn(article) {
  const found = [];
  /* The quoted span must not contain another delimiter. Without that, a
     quotation shorter than the minimum length — &ldquo;hoax&rdquo; — is
     skipped, the match runs on to the NEXT closing mark, and the checker
     invents a quote spanning two real ones that no source can contain.
     Short quotations are quotations, so the floor is two characters. */
  const push = (text, where) => {
    for (const m of (text || '').matchAll(/&ldquo;((?:(?!&[lr]dquo;)[\s\S]){2,400}?)&rdquo;/g))
      found.push({ q: m[1], where });
    for (const m of (text || '').matchAll(/“((?:(?![“”])[\s\S]){2,400}?)”/g))
      found.push({ q: m[1], where });
  };
  (article.body || []).forEach((p, i) => push(p, `body[${i}]`));
  push(article.deck, 'deck');
  push(article.headline, 'headline');
  if (article.pullquote?.text) found.push({ q: article.pullquote.text, where: 'pullquote' });
  if (article.art?.caption) push(article.art.caption, 'caption');
  return found;
}

const failures = [], warnings = [];

/* --- 1. quotations ----------------------------------------------------- */
let checked = 0;
for (const a of issue.articles) {
  const ids = a.sources || [];
  const hay = norm(ids.map(id => (source(id) || {}).text || '').join('\n'));
  if (!hay) { failures.push(`${a.id}: no source text to check quotes against (sources: ${ids.join(', ') || 'none recorded'})`); continue; }

  for (const { q, where } of quotesIn(a)) {
    checked++;
    /* An elided quote is verified fragment by fragment, and the short
       connecting scraps between ellipses are not worth matching on their
       own. A whole quotation, though, is checked whatever its length —
       filtering by length made &ldquo;hoax&rdquo; fail against a source
       that plainly contains it, because the filter emptied the list and an
       empty list counted as "not found". */
    const frags = norm(q).split(/\s*\.\.\.\s*/).map(s => s.trim()).filter(Boolean);
    const parts = frags.length > 1 ? frags.filter(p => p.length > 6) : frags;
    const ok = parts.length && parts.every(p => hay.includes(p));
    if (!ok) failures.push(`${a.id} ${where}: quote not found in source — "${q.slice(0, 96)}"`);
  }
}

/* --- 2. picture licences ----------------------------------------------- */
const credits = fs.existsSync(path.join(IMG, 'credits.json'))
  ? JSON.parse(fs.readFileSync(path.join(IMG, 'credits.json'), 'utf8')) : {};
const OK_LICENCE = /^(cc[- ]?by(-sa)?([- ]?[0-9.]+)?|cc0|public domain|pd-|no restrictions)/i;

for (const a of issue.articles) {
  const art = a.art;
  if (!art || art.type !== 'photo') continue;
  if (art.spec) { failures.push(`${a.id}: photograph was never sourced (spec left unresolved)`); continue; }
  if (!art.src) { failures.push(`${a.id}: photograph has no file`); continue; }
  const file = path.basename(art.src);
  if (!fs.existsSync(path.join(IMG, file))) failures.push(`${a.id}: ${art.src} is missing from the repository`);
  const c = credits[file];
  if (!c) failures.push(`${a.id}: ${file} has no recorded licence`);
  else if (!OK_LICENCE.test(c.licence || '')) failures.push(`${a.id}: ${file} licence "${c.licence}" does not permit reprinting`);
  if (!art.credit) failures.push(`${a.id}: photograph would print without a credit line`);
  if (!art.caption) warnings.push(`${a.id}: photograph has no caption`);
}

/* --- 3. claims about the laboratory ------------------------------------ */
/* An MIT room reads as "34-401", but so does Colorado Senate Bill 24-205 and
   every other bill number in a regulation story. The number alone is not
   evidence; a room word in front of it is. */
const LAB = /\b(our lab|the lab's|our laboratory|reading group|lab meeting|group meeting|seminar (?:on|at)|office hours|(?:room|building|bldg\.?|suite)\s+\d{1,2}-\d{3}|the cluster|our cluster|gpu partition)\b/i;
const everything = [
  ...issue.articles.flatMap(a => [a.headline, a.deck, a.art?.caption, ...(a.body || [])].map(t => [a.id, t])),
  ...(issue.boxes || []).flatMap(b => [...(b.paras || []), ...(b.rows || []).map(r => typeof r === 'string' ? r : Object.values(r).join(' '))].map(t => [b.id, t])),
  ...(issue.fillers || []).map(f => ['filler', f.text])
];
for (const [where, text] of everything) {
  const m = (text || '').match(LAB);
  if (m) failures.push(`${where}: claims something about this laboratory — "${m[0]}"`);
}

/* --- 4. length against plan (advisory) --------------------------------- */
const planFile = path.join(ROOT, 'data/plan.json');
if (fs.existsSync(planFile)) {
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  for (const a of issue.articles) {
    const asn = plan.assignments.find(x =>
      x.slot.replace(/[^a-z0-9]+/gi, '-') + '-' + x.page === a.id);
    if (!asn) continue;
    const n = (a.body || []).join(' ').split(/\s+/).filter(Boolean).length;
    const drift = Math.round(((n - asn.words) / asn.words) * 100);
    if (Math.abs(drift) >= 15) warnings.push(`${a.id}: ${n}w against a ${asn.words}w slot (${drift > 0 ? '+' : ''}${drift}%)`);
  }
}

/* --- verdict ----------------------------------------------------------- */
console.log(`\ngate: ${checked} quotations checked against source text, ` +
  `${issue.articles.filter(a => a.art?.type === 'photo').length} photographs checked for licence`);

if (warnings.length) {
  console.log(`\n${warnings.length} warnings`);
  warnings.forEach(w => console.log('  · ' + w));
}
if (failures.length) {
  console.log(`\n${failures.length} FAILURES`);
  failures.forEach(f => console.log('  ✗ ' + f));
  console.log('\nthe issue does not pass. nothing is published.\n');
  process.exit(1);
}
console.log('\nall checks pass.\n');
