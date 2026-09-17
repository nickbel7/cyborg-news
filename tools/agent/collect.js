#!/usr/bin/env node
/* =========================================================================
   collect.js — find the week's candidate stories without being handed them.

   Until there is an input device the paper sources itself, from published
   RSS and Atom feeds — the machine-readable front doors outlets provide for
   exactly this purpose — rather than scraping article pages, which is both
   ruder and more brittle.

   The beats are the Cyborg Psychology group's own subject matter: human-AI
   systems, the psychological effects of using them, wellbeing and
   flourishing, and the embodied interfaces that carry them. A small industry
   beat carries frontier releases as background, the way a trade paper runs a
   market page.

   Four rules, each learned from watching this collect the wrong newspaper:

   FEEDS ARE READ ROUND-ROBIN, one story at a time. Read in order, the three
   arXiv feeds filled every beat to its cap before a single news outlet was
   reached, and the paper became ninety per cent preprint abstracts — which
   have almost nothing anyone can quote.

   A STORY'S BEAT COMES FROM THE STORY, not from the feed it arrived in.
   Tagging whole feeds put every cs.HC paper under one heading and left four
   beats empty, when that one feed carries emotion support, VR interfaces and
   cognitive load alike.

   EVERY story must clear an AI nexus as well as its beat's terms, and the
   human-AI beat must show human subjects too. Without the nexus, "wellbeing"
   returns early puberty in girls and "embodied" returns holograms; without
   the human test, "workflow" and "interface" return turbomachinery
   simulation.

   And terms are matched in the sense a reader means them. "Policies" in a
   cache-placement paper is not policy; that one word put KV-cache routing on
   the politics beat.

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

/* [url, howManyMayComeFromHere] — every feed probed before being trusted.
   Lawfare and Politico answer 403 to a plain client, VentureBeat
   rate-limits, Nature Machine Intelligence and Frontiers Psychology carry
   nothing that clears the nexus, and both media.mit.edu/feed/ and the
   cyborg-psychology updates feed are 404: the group publishes no RSS of its
   own, so MIT News is the only route to Media Lab work.

   Reporting is listed before the preprint servers. Round-robin makes the
   order far less decisive than it was, but a tie should fall to the outlet
   that writes in sentences. */
const FEEDS = [
  // researchers writing prose about their own work, CC-BY licensed
  ['https://theconversation.com/us/technology/articles.atom', 4],
  ['https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', 4],
  ['https://techcrunch.com/category/artificial-intelligence/feed/', 4],
  ['https://www.wired.com/feed/tag/ai/latest/rss', 4],
  ['https://feeds.arstechnica.com/arstechnica/tech-policy', 4],
  ['https://www.eff.org/rss/updates.xml', 3],
  ['https://news.mit.edu/rss/topic/artificial-intelligence2', 4],
  ['https://www.psypost.org/feed/', 4],
  ['https://www.sciencedaily.com/rss/mind_brain/psychology.xml', 3],
  ['https://www.sciencedaily.com/rss/computers_math/virtual_reality.xml', 3],
  ['https://export.arxiv.org/rss/cs.HC', 10],   // the core feed for this lab
  ['https://export.arxiv.org/rss/cs.CY', 5],    // computers and society
  ['https://export.arxiv.org/rss/cs.AI', 5]
];

/* A machine has to be in the story. This is what separates a newspaper about
   people and AI from a general science digest. */
const NEXUS = /\b(ai|a\.i\.|artificial intelligence|machine learning|algorithm|automated|autonomous|chatbot|llms?|language model|generative|neural network|gpt|claude|gemini|llama|copilot|assistant|agent)\b/i;

/* And for the broad human-AI beat, a person has to be in it as well. */
const HUMAN = /\b(participant|user stud|users|people|practitioner|student|teacher|clinician|patient|worker|interview|survey|qualitative|think[- ]aloud|cognitive|behaviou?r)\b/i;

const TERMS = {
  wellbeing: /\b(mental health|well-?being|flourish|lonel|therap|depress|anxiet|emotion|companionship|social support|self-?esteem|distress|affective)\b/i,
  embodied:  /\b(wearable|smart ?glasses|augmented reality|virtual reality|\bxr\b|\bvr\b|brain[- ]computer|\bbci\b|neural interface|haptic|embodied|eye[- ]track|prosthe)\b/i,
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

/* A beat may not be filled entirely by one outlet, and the lab's own
   subjects get the room; industry is background. */
const CAP = { 'human-ai': 9, effects: 8, wellbeing: 7, embodied: 6, policy: 6, industry: 4 };

/* Feeds carry a lot that is not news. */
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

/* Whichever element actually carries the writing. Reading only <description>
   judged Ars Technica on 81 characters and arXiv on a 1,388-character
   abstract, so preprints won every beat by default while the news feeds
   looked empty. The real article text is usually in <content:encoded>. */
function body(b) {
  return [tag(b, 'content:encoded'), tag(b, 'content'), tag(b, 'description'), tag(b, 'summary')]
    .filter(Boolean)
    .sort((x, y) => y.length - x.length)[0] || '';
}

/* RSS 2.0, RDF and Atom all in one, because the feeds above are a mix. */
function parse(xml) {
  const items = [];
  for (const b of [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map(m => m[0])) {
    let link = tag(b, 'link');
    if (!link || !/^https?:/i.test(link)) {
      const href = b.match(/<link[^>]*href=["']([^"']+)["']/i);                  // Atom
      const about = b.match(/<(?:item|entry)[^>]*rdf:about=["']([^"']+)["']/i);  // RDF
      link = (href && href[1]) || (about && about[1]) || link;
    }
    if (!link || !/^https?:/i.test(link)) continue;
    const when = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    items.push({
      title: tag(b, 'title') || '',
      link: link.trim(),
      summary: body(b).slice(0, 1500),
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
    console.log(`  cleared ${old.length} earlier candidates`);
  }

  const cutoff = Date.now() - DAYS * 864e5;
  const seen = new Set(fs.readdirSync(INBOX).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(INBOX, f), 'utf8')).url));

  console.log(`\nreading ${FEEDS.length} feeds, last ${DAYS} days`);

  /* --- read every feed first, then share the slots out ------------------ */
  const sources = [];
  for (const [url, max] of FEEDS) {
    const got = await fetchFeed(url);
    const host = new URL(url).hostname.replace(/^www\./, '');
    const label = `${host}${/arxiv/.test(host) ? ' ' + url.split('/').pop() : ''}`;
    if (!got.ok) { console.log(`    —  ${label.padEnd(30)} ${got.reason}`); continue; }

    /* An unparseable date must not silently delete a story: `new Date(junk)`
       is an Invalid Date, which is truthy, so a `!it.date` guard misses it
       and `NaN >= cutoff` then discards the item. Unknown dates are kept. */
    const items = parse(got.xml).filter(it => {
      const t = it.date && !isNaN(it.date) ? it.date.getTime() : null;
      return (t === null || t >= cutoff) && !JUNK.test(it.title);
    });
    sources.push({ host, label, max: max || 3, items, cursor: 0, taken: 0, mix: {} });
  }

  /* Round-robin: one story per source per pass, so no feed can empty a beat
     before the others are read. */
  const picked = [];
  const byBeat = {};
  let moved = true;
  while (moved) {
    moved = false;
    for (const s of sources) {
      if (s.taken >= s.max) continue;
      while (s.cursor < s.items.length) {
        const it = s.items[s.cursor++];
        if (seen.has(it.link)) continue;
        const beat = classify(`${it.title} ${it.summary}`);
        if (!beat) continue;
        if ((byBeat[beat] || 0) >= (CAP[beat] || 8)) continue;   // that beat is full
        seen.add(it.link);
        byBeat[beat] = (byBeat[beat] || 0) + 1;
        s.mix[beat] = (s.mix[beat] || 0) + 1;
        s.taken++;
        picked.push({ ...it, beat, host: s.host });
        moved = true;
        break;
      }
    }
  }

  for (const s of sources) {
    const spread = Object.entries(s.mix).map(([k, v]) => `${k} ${v}`).join(', ') || '—';
    console.log(`   ${String(s.taken).padStart(2)}  ${s.label.padEnd(30)} ${spread}`);
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

  const press = picked.filter(p => !/arxiv/.test(p.host)).length;
  console.log(`\n${picked.length} candidates — ` +
    BEAT_ORDER.filter(b => byBeat[b]).map(b => `${b} ${byBeat[b]}`).join(', '));
  console.log(`   ${press} from reporting, ${picked.length - press} from preprints`);
  if (picked.length < 12) console.log('   (thin week — the planner may not fill every slot)');
})();
