/* =========================================================================
   muse.js — the one place that talks to a model.

   Muse Spark 1.3 over Meta's OpenAI-compatible endpoint. Every stage of the
   pipeline calls through here so that retries, JSON repair and cost
   accounting are written once and the same everywhere.

   The key comes from MUSE_API_KEY (a GitHub secret when deployed). The
   scratchpad fallback exists only for local runs and is never in the repo.
   ========================================================================= */
const fs = require('fs');

const BASE = process.env.MUSE_BASE_URL || 'https://api.meta.ai/v1';
const MODEL = process.env.MUSE_MODEL || 'muse-spark-1.3-contributor';
const IN_PER_M = 1.25, OUT_PER_M = 4.25;      // USD per million tokens

function key() {
  if (process.env.MUSE_API_KEY) return process.env.MUSE_API_KEY.trim();
  const local = process.env.MUSE_KEY_FILE;
  if (local && fs.existsSync(local)) return fs.readFileSync(local, 'utf8').trim();
  throw new Error('no MUSE_API_KEY in the environment (and no MUSE_KEY_FILE)');
}

const ledger = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Muse Spark always reasons; reasoning_effort:"none" is rejected outright.
   Reasoning tokens are billed as output, so they show up in the cost line. */
async function call(opts) {
  const body = {
    model: MODEL,
    messages: [
      ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
      { role: 'user', content: opts.user }
    ],
    max_completion_tokens: opts.maxTokens || 16000,
    ...(opts.temperature != null ? { temperature: opts.temperature } : {})
  };

  let last;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const t0 = Date.now();
    try {
      const r = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key()}`, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (r.status === 429 || r.status >= 500) {
        last = `HTTP ${r.status}`;
        await sleep(attempt * 4000);
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);

      const j = await r.json();
      const u = j.usage || {};
      const reasoning = u.completion_tokens_details?.reasoning_tokens || 0;
      const entry = {
        label: opts.label || 'call',
        ms: Date.now() - t0,
        in: u.prompt_tokens || 0,
        out: u.completion_tokens || 0,
        reasoning,
        usd: ((u.prompt_tokens || 0) * IN_PER_M + (u.completion_tokens || 0) * OUT_PER_M) / 1e6
      };
      ledger.push(entry);
      const text = j.choices?.[0]?.message?.content || '';
      if (!text.trim()) throw new Error('empty completion');
      console.log(`    ${entry.label}: ${(entry.ms / 1000).toFixed(0)}s, ` +
        `${entry.in}+${entry.out} tok (${reasoning} reasoning), $${entry.usd.toFixed(4)}`);
      return { text, usage: entry };
    } catch (e) {
      last = e.message;
      if (attempt === 4) throw e;
      await sleep(attempt * 4000);
    }
  }
  throw new Error(`model call failed after 4 attempts: ${last}`);
}

/* Models wrap JSON in prose or fences often enough that parsing deserves a
   repair round rather than a crashed pipeline. */
function extract(text) {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a > 0 || b < s.length - 1) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

async function callJSON(opts) {
  const first = await call(opts);
  try { return extract(first.text); } catch (e) {
    console.log(`    (unparseable JSON: ${e.message.slice(0, 60)} — asking for a repair)`);
    const fixed = await call({
      ...opts,
      label: (opts.label || 'call') + ':repair',
      user: `${opts.user}\n\n---\nYour previous reply could not be parsed as JSON ` +
            `(${e.message}). Return the same content as one valid JSON object. ` +
            `No markdown fence, no commentary, no trailing commas.\n\n` +
            `Previous reply:\n${first.text.slice(0, 6000)}`
    });
    return extract(fixed.text);
  }
}

const totals = () => ledger.reduce((t, e) => ({
  calls: t.calls + 1, in: t.in + e.in, out: t.out + e.out,
  reasoning: t.reasoning + e.reasoning, usd: t.usd + e.usd, ms: t.ms + e.ms
}), { calls: 0, in: 0, out: 0, reasoning: 0, usd: 0, ms: 0 });

module.exports = { call, callJSON, totals, ledger, MODEL };
