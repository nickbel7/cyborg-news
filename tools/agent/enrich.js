#!/usr/bin/env node
/* =========================================================================
   enrich.js — turn a pile of links into something a planner can read.

   No model runs here. Fetch, extract, canonicalise, dedupe, cache. A link
   that cannot be read is recorded as a failure rather than guessed at, so
   the planner never sees a story invented from a URL slug.

     node tools/agent/enrich.js            # everything new in data/inbox
     node tools/agent/enrich.js --force    # refetch even if cached
   ========================================================================= */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const INBOX = path.join(ROOT, 'data/inbox');
const OUT = path.join(ROOT, 'data/extracts');
const UA = 'cyborg-news/1.0 (lab newspaper; github.com/nickbel7/cyborg-news)';
const FORCE = process.argv.includes('--force');

/* Tracking parameters make the same article look like two submissions. */
const JUNK = /^(utm_|fbclid|gclid|mc_|ref|ref_src|igshid|si|s|spm)/i;
function canonical(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.hostname = u.hostname.replace(/^www\./, '');
    [...u.searchParams.keys()].forEach(k => { if (JUNK.test(k)) u.searchParams.delete(k); });
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString();
  } catch { return raw.trim(); }
}

const strip = h => h
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<(nav|header|footer|aside|form|noscript)[\s\S]*?<\/\1>/gi, ' ');

const text = h => h.replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'")
  .replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&mdash;/g, '—').replace(/&[a-z]+;/gi, ' ')
  .replace(/\s+/g, ' ').trim();

function meta(html, names) {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]+content=["']([^"']+)["']`, 'i');
    const m = html.match(re) || html.match(
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${n}["']`, 'i'));
    if (m) return text(m[1]);
  }
  return null;
}

/* A repository page keeps its one piece of prose in an abstract, which is
   not a <p>, so the paragraph sweep below walks straight past it and comes
   back with the submission history and the citation-tool furniture instead.
   That is not hypothetical: every arXiv source in the issue of 21 September
   was stored as "Submission history ... [v1] Mon, 14 Sep 2026 (529 KB) ...
   Bibliographic Tools" — 356 words of page chrome, over the 120-word bar,
   so it reached the planner as a readable source. Two thirds of that week's
   pool was preprints, and the paper printed a box of file sizes and filing
   dates because that was genuinely all its sources contained. */
function abstractOf(html) {
  const m = meta(html, ['citation_abstract']);
  if (m) return m;
  const block = html.match(
    /<blockquote[^>]*class=["'][^"']*abstract[^"']*["'][^>]*>([\s\S]*?)<\/blockquote>/i);
  return block ? text(block[1]).replace(/^abstract:?\s*/i, '') : null;
}

// prefer a real article container; otherwise the biggest block of paragraphs
function body(html) {
  const clean = strip(html);
  const art = clean.match(/<article[\s\S]*?<\/article>/i) || clean.match(/<main[\s\S]*?<\/main>/i);
  const scope = art ? art[0] : clean;
  const paras = [...scope.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => text(m[1])).filter(p => p.split(' ').length > 12);
  const joined = paras.join('\n\n');
  const scraped = (joined.length > 400 ? joined : text(scope)).slice(0, 7000);

  /* Keep what was scraped only when it is plainly a longer piece of writing
     than the abstract. On a page that is an abstract and nothing else, the
     rest is furniture; on a real article that happens to carry an abstract,
     the body outruns it and wins. A news page has neither marker and is
     untouched by this. */
  const abs = abstractOf(html);
  if (abs && abs.length > 200 && scraped.length < abs.length * 2) return abs.slice(0, 7000);
  return scraped;
}

async function grab(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' }
    });
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` };
    const ct = r.headers.get('content-type') || '';
    if (!/html|text/.test(ct)) return { ok: false, reason: `content-type ${ct.split(';')[0]}` };
    return { ok: true, html: await r.text(), final: r.url };
  } catch (e) {
    return { ok: false, reason: e.name === 'AbortError' ? 'timeout' : e.message.slice(0, 60) };
  } finally { clearTimeout(timer); }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const subs = fs.readdirSync(INBOX).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(INBOX, f), 'utf8')));

  const seen = new Map();
  const results = [];
  for (const s of subs) {
    const url = canonical(s.url);
    if (seen.has(url)) { results.push({ url, status: 'duplicate', of: seen.get(url) }); continue; }
    seen.set(url, s.submitted_by);

    const id = crypto.createHash('sha1').update(url).digest('hex').slice(0, 10);
    const file = path.join(OUT, id + '.json');
    if (!FORCE && fs.existsSync(file)) { results.push({ url, status: 'cached' }); continue; }

    const got = await grab(url);
    if (!got.ok) {
      const rec = { id, url, status: 'needs-human', reason: got.reason, submitted_by: s.submitted_by };
      fs.writeFileSync(file, JSON.stringify(rec, null, 2));
      results.push({ url, status: 'failed', reason: got.reason });
      continue;
    }
    const t = body(got.html);
    const rec = {
      id, url, final_url: got.final,
      title: meta(got.html, ['og:title', 'twitter:title']) ||
             text((got.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1]),
      site: meta(got.html, ['og:site_name']) || new URL(url).hostname,
      author: meta(got.html, ['article:author', 'author']),
      published: meta(got.html, ['article:published_time', 'og:updated_time', 'date']),
      description: meta(got.html, ['og:description', 'description']),
      image_url: meta(got.html, ['og:image']),
      image_licence: 'unknown',       // the gate rejects unknown; never assume
      words: t.split(' ').length,
      text: t,
      submitted_by: s.submitted_by, note: s.note,
      beat: s.beat || null,           // carried through so the planner can spread the issue
      fetched_at: new Date().toISOString(),
      status: t.split(' ').length < 120 ? 'thin' : 'ok'
    };
    fs.writeFileSync(file, JSON.stringify(rec, null, 2));
    results.push({ url, status: rec.status, words: rec.words, title: (rec.title || '').slice(0, 58) });
  }

  const by = k => results.filter(r => r.status === k).length;
  console.log(`\n${results.length} submissions -> ok ${by('ok')}, thin ${by('thin')}, ` +
              `failed ${by('failed')}, duplicate ${by('duplicate')}, cached ${by('cached')}\n`);
  for (const r of results) {
    const tag = r.status.padEnd(11);
    const extra = r.words ? String(r.words).padStart(5) + 'w  ' + (r.title || '')
                          : (r.reason || r.of || '');
    console.log(`  ${tag} ${extra}`);
    if (!r.words) console.log(`              ${r.url.slice(0, 92)}`);
  }
})();
