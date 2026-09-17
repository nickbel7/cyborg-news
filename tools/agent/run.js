#!/usr/bin/env node
/* =========================================================================
   run.js — the Sunday run, start to finish.

   This is the whole newspaper as a sequence of small programs. Each stage
   leaves its output on disk, so a failed run resumes from where it broke
   rather than starting over and paying for the model twice.

   The shape is deliberately a pipeline and not an agent: the model is asked
   specific questions at four points (choose, write, refit, proof) and code
   decides everything else. A model that goes wrong therefore ruins one
   stage, which the next check catches, instead of wandering through the
   repository.

     node tools/agent/run.js                 the whole thing
     node tools/agent/run.js --from write    resume after a failure
     node tools/agent/run.js --to gate       stop before rendering
     node tools/agent/run.js --dry           list the stages and exit
   ========================================================================= */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DATE = process.env.ISSUE_DATE || new Date().toISOString().slice(0, 10);
const MAX_REFIT = 3;

const STAGES = [
  ['collect', "find this week's candidate stories", ['tools/agent/collect.js', '--fresh']],
  ['enrich', 'read every link in the inbox',        ['tools/agent/enrich.js']],
  ['plan',   'choose the stories and the shape',    ['tools/agent/plan.js']],
  ['write',  'write the copy and the furniture',    ['tools/agent/write.js']],
  ['photo',  'source and licence the photographs',  ['tools/agent/photo.js']],
  ['build',  'inline the issue into the page',      ['tools/build.js']],
  ['fit',    'set the type and close the gaps',     null],   // the loop below
  /* The gate runs AFTER the fit loop, not before it. The loop rewrites copy,
     and copy that has not been checked must not reach the page — in the first
     run three of the six printed quotations were introduced after the gate
     had already passed, and went to print unverified. */
  ['gate',   'check quotes, licences and claims',   ['tools/agent/gate.js']],
  ['pdf',    'render the printable sheet',          ['tools/render.js', 'pdf']],
  ['proof',  'render the proof images',             ['tools/render.js', 'png']],
  ['web',    'render the archive thumbnail',        ['tools/render.js', 'web']],
  ['archive','file the issue',                      null]
];

const argv = process.argv.slice(2);
const flag = n => { const i = argv.indexOf(n); return i < 0 ? null : argv[i + 1]; };
const from = flag('--from'), to = flag('--to');

let active = STAGES.map(s => s[0]);
if (from) active = active.slice(active.indexOf(from));
if (to) active = active.slice(0, active.indexOf(to) + 1);

if (argv.includes('--dry')) {
  console.log('\nstages for ' + DATE + ':');
  STAGES.forEach(([n, d]) => console.log(`  ${active.includes(n) ? '▸' : ' '} ${n.padEnd(8)} ${d}`));
  process.exit(0);
}

function run(args, quiet) {
  const r = spawnSync('node', args.map(a => a.startsWith('tools/') ? path.join(ROOT, a) : a), {
    cwd: ROOT, stdio: quiet ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    env: { ...process.env, ISSUE_DATE: DATE }
  });
  if (r.status !== 0) {
    console.error(`\n✗ ${args[0]} exited ${r.status}. the run stops here.`);
    console.error(`  resume with: node tools/agent/run.js --from <stage>\n`);
    process.exit(r.status || 1);
  }
  return (r.stdout || '').toString();
}

function banner(name, desc, i, n) {
  console.log(`\n${'─'.repeat(72)}\n${String(i).padStart(2)}/${n}  ${name.toUpperCase()}  ·  ${desc}\n${'─'.repeat(72)}`);
}

/* The fit loop is the visual check. The engine reports what it had to cut
   and where the page is still empty; refit rewrites only those pieces to a
   corrected length; then the page is measured again. Three passes is the
   cap — beyond that the copy is being churned, not improved. */
function fitLoop() {
  for (let pass = 1; pass <= MAX_REFIT; pass++) {
    console.log(`\n  pass ${pass} — measuring the page`);
    run(['tools/render.js', 'report']);
    const r = spawnSync('node', [path.join(ROOT, 'tools/agent/refit.js')], {
      cwd: ROOT, stdio: 'inherit', env: { ...process.env, ISSUE_DATE: DATE }
    });
    if (r.status === 0) { console.log(`\n  the page is set after ${pass} pass${pass > 1 ? 'es' : ''}.`); return; }
    if (r.status !== 2) { console.error('\n✗ refit failed.'); process.exit(r.status || 1); }
    run(['tools/build.js']);          // rebuild with the revised copy
  }
  console.log(`\n  ${MAX_REFIT} passes reached; printing as it stands.`);
  run(['tools/render.js', 'report']);
}

function archive() {
  const out = path.join(ROOT, 'issues', DATE);
  fs.mkdirSync(out, { recursive: true });
  const pdfs = fs.readdirSync(ROOT).filter(f => f.endsWith('.pdf'))
    .map(f => ({ f, t: fs.statSync(path.join(ROOT, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!pdfs.length) { console.error('✗ no pdf was produced'); process.exit(1); }
  fs.copyFileSync(path.join(ROOT, pdfs[0].f), path.join(out, 'paper.pdf'));
  for (const extra of ['data/issue.json', 'data/plan.json']) {
    if (fs.existsSync(path.join(ROOT, extra)))
      fs.copyFileSync(path.join(ROOT, extra), path.join(out, path.basename(extra)));
  }
  const kb = Math.round(fs.statSync(path.join(out, 'paper.pdf')).size / 1024);
  console.log(`\n  issues/${DATE}/paper.pdf  (${kb} KB), with the issue and the plan beside it`);
}

(async () => {
  const t0 = Date.now();
  console.log(`\nCYBORG NEWS — building the issue of ${DATE}`);
  if (!process.env.MUSE_API_KEY && !process.env.MUSE_KEY_FILE)
    console.log('  (no MUSE_API_KEY set — the model stages will fail)');

  const list = STAGES.filter(s => active.includes(s[0]));
  list.forEach(([name, desc, args], i) => {
    banner(name, desc, i + 1, list.length);
    if (name === 'fit') return fitLoop();
    if (name === 'archive') return archive();
    run(args);
  });

  console.log(`\n${'═'.repeat(72)}`);
  console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s\n`);
})();
