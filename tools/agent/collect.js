#!/usr/bin/env node
/* =========================================================================
   collect.js — find the week's candidate stories without being handed them.

   Until there is an input device the paper sources itself, from published
   feeds — the machine-readable front doors outlets provide for exactly this
   purpose — rather than scraping article pages, which is both ruder and more
   brittle.

   The beats are the Cyborg Psychology group's own subject matter: human-AI
   systems, the psychological effects of using them, wellbeing and
   flourishing, and the embodied interfaces that carry them. A small industry
   beat carries frontier releases as background, the way a trade paper runs a
   market page.

   Five rules, each learned from watching this collect the wrong newspaper:

   THE WEEK IS THE UNIT, NOT THE DAY. arXiv's RSS is a daily announcement
   feed — every item in cs.HC carried the same timestamp — so a seven-day
   filter still produced a paper made from one afternoon's preprints. arXiv
   is therefore queried through its API over an explicit submittedDate range.

   READ THE TEXT A FEED ACTUALLY PUBLISHES. Matching <description> alone
   judged Ars Technica on 81 characters and arXiv on a 1,388-character
   abstract, so preprints won every beat by default and the news feeds looked
   empty. The writing is usually in <content:encoded>.

   FEEDS ARE READ ROUND-ROBIN, one story at a time, or the largest source
   fills every beat before the others are read.

   A STORY'S BEAT COMES FROM THE STORY, not the feed it arrived in.

   EVERY story must clear an AI nexus as well as its beat's terms, and the
   broad human-AI beat must show human subjects too. Without the nexus,
   "wellbeing" returns early puberty in girls and "embodied" returns
   holograms; and "policies" in a cache-placement paper is not policy.

   Nothing here judges a story. It gathers plausible candidates and tags each
   with its beat, in the shape a human submission takes, so enrich.js and
   plan.js cannot tell the difference. Selection stays in the editorial
   meeting, where it belongs.

   Uses plain HTTP, not the search tools of a Claude Code session: this has
   to run unattended on a GitHub runner.

     node tools/agent/collect.js               the last 7 days
     node tools/agent/collect.js --days 14
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
/* How many stories any single calendar day may contribute. Without it the
   newest batch fills the paper and the other six days go unread — this is
   what makes the issue weekly rather than daily. */
const DAY_CAP = Number(arg('--per-day') || Math.max(4, Math.ceil(30 / DAYS)));

/* [source, howManyMayComeFromHere]. A source is a feed URL, or "arxiv:<cat>"
   which is resolved to an API query covering the whole window.

   Every one probed before being trusted. Lawfare and Politico answer 403 to
   a plain client, VentureBeat rate-limits, Nautilus and Nature's news feed
   carry only a blurb per item, and both media.mit.edu/feed/ and the
   cyborg-psychology updates feed are 404 — the group publishes no RSS of its
   own, so MIT News is the only route to Media Lab work.

   Reporting is listed before the preprint servers: round-robin makes the
   order far less decisive, but a tie should fall to the outlet that writes
   in sentences and can be quoted. */
const SOURCES = [
  ['https://theconversation.com/us/technology/articles.atom', 4],  // CC-BY, researchers in prose
  ['https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', 3],
  ['https://techcrunch.com/category/artificial-intelligence/feed/', 3],
  ['https://techcrunch.com/category/artificial-intelligence/feed/?paged=2', 3],
  ['https://www.wired.com/feed/tag/ai/latest/rss', 4],
  ['https://feeds.arstechnica.com/arstechnica/tech-policy', 4],
  ['https://www.eff.org/rss/updates.xml', 3],
  ['https://news.mit.edu/rss/topic/artificial-intelligence2', 4],
  ['https://www.psypost.org/feed/', 4],
  ['https://www.psypost.org/feed/?paged=2', 3],
  ['https://www.sciencedaily.com/rss/mind_brain/psychology.xml', 3],
  ['arxiv:cs.HC', 10],       // the core category for this lab
  ['arxiv:cs.CY', 5],        // computers and society
  ['arxiv:cs.AI', 3]
];

/* arXiv publishes hundreds of papers a day, so a week of cs.AI cannot be
   fetched whole. The window is applied in the query and the newest are taken
   first; cs.HC and cs.CY fit comfortably, cs.AI is skimmed. */
const ARXIV_MAX = 400;

function resolve(spec) {
  const m = /^arxiv:(.+)$/.exec(spec);
  if (!m) {
    const u = new URL(spec);
    return { url: spec, label: u.hostname.replace(/^www\./, '') + (u.search ? ' p2' : ''), arxiv: false };
  }
  const p = n => String(n).padStart(2, '0');
  const stamp = d => `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
  const from = stamp(new Date(Date.now() - DAYS * 864e5));
  const to = stamp(new Date());
  const q = `cat:${m[1]}+AND+submittedDate:[${from}+TO+${to}]`;
  return {
    url: `http://export.arxiv.org/api/query?search_query=${q}` +
         `&start=0&max_results=${ARXIV_MAX}&sortBy=submittedDate&sortOrder=descending`,
    label: `arxiv ${m[1]}`, arxiv: true
  };
}

/* A machine has to be in the story. This is what separates a newspaper about
   people and AI from a general science digest. */
const NEXUS = /\b(ai|a\.i\.|artificial intelligence|machine learning|algorithm|automated|autonomous|chatbot|llms?|language model|generative|neural network|gpt|claude|gemini|llama|copilot|assistant|agent)\b/i;

/* And for the broad human-AI beat, a person has to be in it as well. */
const HUMAN = /\b(participant|user stud|users|people|practitioner|student|teacher|clinician|patient|worker|interview|survey|qualitative|think[- ]aloud|cognitive|behaviou?r)\b/i;

const TERMS = {
  wellbeing: /\b(mental health|well-?being|flourish|lonel|therap|depress|anxiet|emotion|companionship|social support|self-?esteem|distress|affective)\b/i,
  embodied:  /\b(wearable|smart ?glasses|augmented reality|virtual reality|\bxr\b|\bvr\b|brain[- ]computer|\bbci\b|neural interface|haptic|eye[- ]track|prosthe)\b/i,
  effects:   /\b(relian|overtrust|over-?rely|offload|deskill|dependence|addict|persuas|manipulat|false memor|parasocial|companion|anthropomorph|placebo|literacy|human agency|cognitive (cost|effect|load|demand|declin))\b/i,
  // "policies" in a cache-placement paper is not policy: bare policy/policies is out
  policy:    /\b(regulat|ai act|legislat|lawmaker|congress|senate|parliament|governance|oversight|liabilit|lawsuit|court|antitrust|compliance|copyright|public polic|policymak|surveillance|civil rights)\b/i,
  'human-ai': /\b(human[- ]ai|human[- ]machine|human[- ]computer|hci|augment|human[- ]in[- ]the[- ]loop|teaming|assistive|decision[- ]making|critical thinking|tutor|instructor|socratic|co-?creat|user study|mental model)\b/i
};

/* Industry is the one beat about events rather than subject matter: a named
   frontier lab doing a nameable thing. Matching the bare word "model" pulled
   in span-masking preprints; matching "available" pulled in a paper titled
   "Available but Unclaimed". */
const INDUSTRY_WHO = /\b(gpt-?\d|chatgpt|claude|gemini|llama|openai|anthropic|deepseek|mistral|meta ai|google deepmind|xai)\b/i;
const INDUSTRY_WHAT = /\b(launch|releas|ship|announc|unveil|pricing|raise[sd]? \$|funding|acquir|acquisition|benchmark|open[- ]weight|shut down|sunset|deprecat)\b/i;

/* Most specific first, so a paper on sustained emotion support is filed
   under wellbeing rather than swallowed by the broad human-AI heading. */
const BEAT_ORDER = ['wellbeing', 'embodied', 'effects', 'policy', 'industry', 'human-ai'];

const CAP = { 'human-ai': 9, effects: 8, wellbeing: 7, embodied: 6, policy: 6, industry: 4 };

const JUNK = /\b(sponsored|deal of|coupon|best (laptop|phone|deals)|discount|giveaway|shop|prime day|black friday)\b/i;

function qualifies(beat, text) {
  if (beat === 'industry') return INDUSTRY_WHO.test(text) && INDUSTRY_WHAT.test(text);
  if (!NEXUS.test(text) || !TERMS[beat].test(text)) return false;
  return beat === 'human-ai' ? HUMAN.test(text) : true;
}

const classify = text => BEAT_ORDER.find(b => qualifies(b, text)) || null;

/* Feed bodies arrive escaped to varying depths: The Conversation ships its
   article as &lt;figure&gt;… inside <content>, so entities are decoded first,
   then the markup that decoding reveals is stripped. */
const strip = s => {
  let t = (s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  t = t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#0?39;|&apos;|&rsquo;/g, "'")
       .replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return t.replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
};

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? strip(m[1]) : null;
};

/* Whichever element actually carries the writing. */
const body = b =>
  [tag(b, 'content:encoded'), tag(b, 'content'), tag(b, 'description'), tag(b, 'summary')]
    .filter(Boolean).sort((x, y) => y.length - x.length)[0] || '';

/* RSS 2.0, RDF, Atom and the arXiv API all in one, because the sources are a
   mix. arXiv's API returns Atom entries whose alternate link is the abs page,
   which is what enrich.js can fetch. */
function parse(xml) {
  const items = [];
  for (const b of [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map(m => m[0])) {
    let link = tag(b, 'link');
    if (!link || !/^https?:/i.test(link)) {
      const href = b.match(/<link[^>]*href=["']([^"']+)["']/i);                  // Atom
      const about = b.match(/<(?:item|entry)[^>]*rdf:about=["']([^"']+)["']/i);  // RDF
      const id = b.match(/<id>\s*(https?:[^<\s]+)\s*<\/id>/i);                   // arXiv API
      link = (href && href[1]) || (about && about[1]) || (id && id[1]) || link;
    }
    if (!link || !/^https?:/i.test(link)) continue;
    const when = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    items.push({
      title: tag(b, 'title') || '',
      link: link.replace(/^http:/, 'https:').trim(),
      summary: body(b).slice(0, 1500),
      date: when ? new Date(when) : null
    });
  }
  return items;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* arXiv answers 429 to a burst of large queries, but the limit is transient:
   the same request succeeds after a pause. A rate-limited source must not be
   dropped for the week, so it is retried rather than abandoned. */
async function fetchFeed(url) {
  let last = 'unknown';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await fetch(url, {
        signal: ctl.signal, redirect: 'follow',
        headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }
      });
      if (r.status === 429 || r.status >= 500) {
        last = `HTTP ${r.status}`;
        if (attempt < 3) { await sleep(attempt * 5000); continue; }
        return { ok: false, reason: `${last} after ${attempt} tries` };
      }
      if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` };
      return { ok: true, xml: await r.text() };
    } catch (e) {
      last = e.name === 'AbortError' ? 'timeout' : e.message.slice(0, 50);
      if (attempt === 3) return { ok: false, reason: last };
      await sleep(attempt * 2000);
    } finally { clearTimeout(timer); }
  }
  return { ok: false, reason: last };
}

(async () => {
  fs.mkdirSync(INBOX, { recursive: true });
  if (FRESH) {
    const old = fs.readdirSync(INBOX).filter(f => f.endsWith('.json'));
    old.forEach(f => fs.unlinkSync(path.join(INBOX, f)));
    console.log(`  cleared ${old.length} earlier candidates`);
  }

  const cutoff = Date.now() - DAYS * 864e5;
  const seen = new Set(fs.readdirSync(INBOX).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(INBOX, f), 'utf8')).url));

  console.log(`\nreading ${SOURCES.length} sources over the last ${DAYS} days`);

  /* --- read everything first, then share the slots out ------------------ */
  const feeds = [];
  let arxivCalls = 0;
  for (const [spec, max] of SOURCES) {
    const { url, label, arxiv } = resolve(spec);
    if (arxiv && arxivCalls++) await sleep(3000);   // arXiv asks for a pause between queries

    const got = await fetchFeed(url);
    if (!got.ok) { console.log(`    —  ${label.padEnd(26)} ${got.reason}`); continue; }

    /* An unparseable date must not silently delete a story: `new Date(junk)`
       is an Invalid Date, which is truthy, so a `!it.date` guard misses it
       and `NaN >= cutoff` then discards the item. Unknown dates are kept. */
    const items = parse(got.xml).filter(it => {
      const t = it.date && !isNaN(it.date) ? it.date.getTime() : null;
      return (t === null || t >= cutoff) && !JUNK.test(it.title);
    });
    const days = new Set(items.filter(i => i.date && !isNaN(i.date))
      .map(i => i.date.toISOString().slice(0, 10))).size;
    feeds.push({ label, items, cursor: 0, taken: 0, max: max || 3, mix: {}, span: days, seenCount: items.length });
  }

  /* Round-robin: one story per source per pass, so no source can empty a
     beat before the others are read.

     And no single day may fill the paper. Every source arrives newest-first,
     so without a daily ceiling each one spends its whole allowance inside
     the most recent batch: cs.HC hit its limit of ten while still in one
     afternoon's announcements and never reached the other 160 papers in the
     window. The ceiling forces the cursor to keep scanning backwards, which
     is what makes this a weekly paper rather than a daily one. */
  const picked = [];
  const byBeat = {};
  const byDay = {};
  const dayOf = it => (it.date && !isNaN(it.date) ? it.date : new Date()).toISOString().slice(0, 10);

  let moved = true;
  while (moved) {
    moved = false;
    for (const f of feeds) {
      if (f.taken >= f.max) continue;
      while (f.cursor < f.items.length) {
        const it = f.items[f.cursor++];
        if (seen.has(it.link)) continue;
        const beat = classify(`${it.title} ${it.summary}`);
        if (!beat) continue;
        if ((byBeat[beat] || 0) >= (CAP[beat] || 8)) continue;
        const day = dayOf(it);
        if ((byDay[day] || 0) >= DAY_CAP) continue;      // that day has had its share
        seen.add(it.link);
        byBeat[beat] = (byBeat[beat] || 0) + 1;
        byDay[day] = (byDay[day] || 0) + 1;
        f.mix[beat] = (f.mix[beat] || 0) + 1;
        f.taken++;
        picked.push({ ...it, beat, host: new URL(it.link).hostname.replace(/^www\./, '') });
        moved = true;
        break;
      }
    }
  }

  for (const f of feeds) {
    const spread = Object.entries(f.mix).map(([k, v]) => `${k} ${v}`).join(', ') || '—';
    console.log(`   ${String(f.taken).padStart(2)}  ${f.label.padEnd(26)} ` +
      `${String(f.seenCount).padStart(3)} in window / ${f.span}d   ${spread}`);
  }

  for (const it of picked) {
    const h = crypto.createHash('sha1').update(it.link).digest('hex').slice(0, 8);
    const when = (it.date && !isNaN(it.date) ? it.date : new Date()).toISOString();
    fs.writeFileSync(path.join(INBOX, `${when.slice(0, 10)}-${h}.json`), JSON.stringify({
      url: it.link,
      submitted_by: 'collector',
      submitted_at: when,
      note: it.title.slice(0, 140),
      source: `rss:${it.host}`,
      beat: it.beat
    }, null, 2));
  }

  const dates = picked.filter(p => p.date && !isNaN(p.date)).map(p => p.date.toISOString().slice(0, 10));
  const spread = {};
  dates.forEach(d => { spread[d] = (spread[d] || 0) + 1; });
  const press = picked.filter(p => !/arxiv/i.test(p.host)).length;

  console.log(`\n${picked.length} candidates — ` +
    BEAT_ORDER.filter(b => byBeat[b]).map(b => `${b} ${byBeat[b]}`).join(', '));
  console.log(`   ${press} from reporting, ${picked.length - press} from preprints`);
  console.log(`   spread over ${Object.keys(spread).length} days:`);
  Object.entries(spread).sort().reverse()
    .forEach(([d, n]) => console.log(`     ${d}  ${'#'.repeat(n)} ${n}`));
  if (picked.length < 12) console.log('   (thin week — the planner may not fill every slot)');
})();
