#!/usr/bin/env node
/* =========================================================================
   collect.js — find the week's candidate stories without being handed them.

   Until there is an input device, the paper sources itself. This reads
   published RSS and Atom feeds — the machine-readable front doors that
   outlets provide for exactly this purpose — rather than scraping article
   pages, which is both ruder and more brittle.

   Nothing here judges a story. It gathers plausible candidates, tags each
   with the beat it came from, and drops them in data/inbox in the same
   shape a human submission takes, so enrich.js and plan.js cannot tell the
   difference. Selection stays where it belongs, in the editorial meeting.

   Note it uses plain HTTP, not the search tools available in a Claude Code
   session: this has to run unattended on a GitHub runner.

     node tools/agent/collect.js               the last 7 days
     node tools/agent/collect.js --days 3
     node tools/agent/collect.js --fresh       empty the inbox first
   ========================================================================= */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const INBOX = path.join(ROOT, 'data/inbox');
const UA = 'cyborg-news/1.0 (lab newspaper; github.com/nickbel7/cyborg-news)';

const arg = n => { const i = process.argv.indexOf(n); return i < 0 ? null : process.argv[i + 1]; };
const DAYS = Number(arg('--days') || process.env.COLLECT_DAYS || 7);
const FRESH = process.argv.includes('--fresh');
/* Deliberately small. A feed that takes six slots exhausts its beat's quota
   before the next outlet is even read — on one run psypost and arXiv filled
   the whole cognition allowance and MIT News never got a look. Three apiece
   spreads the issue across mastheads, which is the point of a newspaper. */
const PER_FEED = Number(arg('--per-feed') || 3);

/* The beats the paper covers. Keeping them explicit means the mix stays
   deliberate even though no one is choosing the links. */
const FEEDS = [
  ['models',    'https://techcrunch.com/category/artificial-intelligence/feed/'],
  ['models',    'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml'],
  ['models',    'https://export.arxiv.org/rss/cs.AI'],
  ['models',    'https://export.arxiv.org/rss/cs.LG'],
  ['policy',    'https://feeds.arstechnica.com/arstechnica/tech-policy'],
  ['policy',    'https://www.eff.org/rss/updates.xml'],
  ['policy',    'https://www.wired.com/feed/tag/ai/latest/rss'],
  ['cognition', 'https://www.psypost.org/feed/'],
  ['cognition', 'https://export.arxiv.org/rss/q-bio.NC'],
  ['cognition', 'https://www.sciencedaily.com/rss/mind_brain/psychology.xml'],
  ['cognition', 'https://news.mit.edu/rss/research']
];

/* Probed before being trusted: Lawfare and Politico answer 403 to a plain
   client, VentureBeat rate-limits, and techpolicy.press serves no items a
   reader can parse. Ars Technica's tech-policy feed carries the regulation
   reporting its technology-lab feed does not.

   No beat may crowd out the others either. On the first run arXiv supplied
   18 of 35 candidates, and a paper built from preprint abstracts has very
   little anyone can quote. */
const CAP = { models: 12, policy: 10, cognition: 12 };

const TERMS = {
  models: /\b(model|release|launch|benchmark|gpt|claude|gemini|llama|mistral|deepseek|open[- ]weight|context window|inference|training run|frontier)\b/i,
  policy: /\b(regulat|ai act|safety|lawsuit|polic|congress|oversight|liabilit|governance|court|ban|compliance|antitrust|privacy)\b/i,
  cognition: /\b(cognit|memory|brain|neural|psycholog|learning|attention|reasoning|behaviour|behavior|participants|study|students)\b/i
};
/* Feeds carry a lot that is not news. */
const JUNK = /\b(sponsored|deal of|coupon|best (laptop|phone|deals)|discount|giveaway|shop|prime day|black friday)\b/i;

const strip = s => (s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? strip(m[1]) : null;
};

/* RSS 2.0, RDF and Atom all in one, because the feeds above are a mix. */
function parse(xml) {
  const items = [];
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map(m => m[0]);
  for (const b of blocks) {
    let link = tag(b, 'link');
    if (!link || !/^https?:/i.test(link)) {
      const href = b.match(/<link[^>]*href=["']([^"']+)["']/i);           // Atom
      const about = b.match(/<(?:item|entry)[^>]*rdf:about=["']([^"']+)["']/i); // RDF
      link = (href && href[1]) || (about && about[1]) || link;
    }
    if (!link || !/^https?:/i.test(link)) continue;
    const when = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    items.push({
      title: tag(b, 'title') || '',
      link: link.trim(),
      summary: (tag(b, 'description') || tag(b, 'summary') || tag(b, 'content') || '').slice(0, 600),
      date: when ? new Date(when) : null
    });
  }
  return items;
}

async function fetchFeed(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, {
      signal: ctl.signal, redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }
    });
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` };
    return { ok: true, xml: await r.text() };
  } catch (e) {
    return { ok: false, reason: e.name === 'AbortError' ? 'timeout' : e.message.slice(0, 50) };
  } finally { clearTimeout(timer); }
}

(async () => {
  fs.mkdirSync(INBOX, { recursive: true });
  if (FRESH) {
    const old = fs.readdirSync(INBOX).filter(f => f.endsWith('.json'));
    old.forEach(f => fs.unlinkSync(path.join(INBOX, f)));
    console.log(`  cleared ${old.length} earlier submissions`);
  }

  const cutoff = Date.now() - DAYS * 864e5;
  const seen = new Set(fs.readdirSync(INBOX).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(INBOX, f), 'utf8')).url));

  console.log(`\ncollecting from ${FEEDS.length} feeds, last ${DAYS} days`);
  const picked = [];
  const byBeat = {};

  for (const [beat, url] of FEEDS) {
    const got = await fetchFeed(url);
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (!got.ok) { console.log(`  ${'—'.padEnd(3)} ${host.padEnd(26)} ${got.reason}`); continue; }

    /* An unparseable date must not silently delete a story. `new Date(junk)`
       is an Invalid Date, which is truthy, so the old `!it.date` guard missed
       it and `NaN >= cutoff` then discarded the item — that quietly emptied
       two live feeds on the first run. An unknown date is kept, not dropped. */
    const room = Math.max(0, (CAP[beat] || 12) - (byBeat[beat] || 0));
    const fresh = parse(got.xml)
      .filter(it => {
        const t = it.date && !isNaN(it.date) ? it.date.getTime() : null;
        return t === null || t >= cutoff;
      })
      .filter(it => !JUNK.test(it.title))
      .filter(it => TERMS[beat].test(it.title + ' ' + it.summary))
      .filter(it => !seen.has(it.link))
      .slice(0, Math.min(PER_FEED, room));

    fresh.forEach(it => { seen.add(it.link); picked.push({ ...it, beat, host }); });
    byBeat[beat] = (byBeat[beat] || 0) + fresh.length;
    console.log(`  ${String(fresh.length).padStart(3)} ${host.padEnd(26)} ${beat}`);
  }

  for (const it of picked) {
    const h = crypto.createHash('sha1').update(it.link).digest('hex').slice(0, 8);
    const when = (it.date && !isNaN(it.date) ? it.date : new Date()).toISOString();
    fs.writeFileSync(path.join(INBOX, `${when.slice(0, 10)}-${h}.json`), JSON.stringify({
      url: it.link,
      submitted_by: 'collector',
      submitted_at: when,
      note: it.title.slice(0, 120),
      source: `rss:${it.host}`,
      beat: it.beat
    }, null, 2));
  }

  console.log(`\n${picked.length} candidates in the inbox` +
    ` — ${Object.entries(byBeat).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (picked.length < 8) console.log('  (thin week — the planner may not fill every slot)');
})();
