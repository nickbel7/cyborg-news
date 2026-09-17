#!/usr/bin/env node
/* =========================================================================
   render.js — drives headless Chrome over the DevTools protocol and waits
   for the layout engine to say it is finished before capturing.

     node tools/render.js pdf     -> cyborg-news-<date>.pdf   (print-ready A4)
     node tools/render.js png     -> build/page-N.png         (proof sheets)
     node tools/render.js report  -> prints the fit report

   The one-shot Chrome flags (--print-to-pdf, --screenshot) fire before the
   fit passes finish, which is why this talks to the browser instead.
   ========================================================================= */
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const cmd = process.argv[2] || 'pdf';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cyborg-'));
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--hide-scrollbars', '--force-device-scale-factor=2',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--window-size=1123,1587', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });

  const port = await new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => rej(new Error('chrome did not start')), 20000);
    proc.stderr.on('data', d => {
      buf += d;
      const m = buf.match(/ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) { clearTimeout(t); res(+m[1]); }
    });
  });
  return { proc, port, profile };
}

let seq = 0;
function rpc(ws, method, params) {
  const id = ++seq;
  return new Promise((res, rej) => {
    const onMsg = ev => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener('message', onMsg);
      m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

async function connect(port) {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise(r => ws.addEventListener('open', r, { once: true }));
        return ws;
      }
    } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('no page target');
}

const evaluate = (ws, expr) =>
  rpc(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true })
    .then(r => r.result && r.result.value);

async function waitReady(ws, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await evaluate(ws, "document.body && document.body.dataset.ready || ''")) return true;
    const err = await evaluate(ws, "document.body && document.body.dataset.error || ''");
    if (err) throw new Error('layout error: ' + err);
    await sleep(200);
  }
  throw new Error('timed out waiting for the layout engine');
}

(async () => {
  require('child_process').execFileSync(process.execPath,
    [path.join(__dirname, 'build.js')], { stdio: 'ignore' });
  const built = fs.readdirSync(ROOT).filter(f => /^cyborg-news-.*\.html$/.test(f))
    .map(f => ({ f, t: fs.statSync(path.join(ROOT, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0].f;
  const url = 'file://' + path.join(ROOT, built);

  const { proc, port, profile } = await launch();
  const ws = await connect(port);
  try {
    await rpc(ws, 'Page.enable');
    await rpc(ws, 'Page.navigate', { url: url + (cmd === 'png' ? '?bare=1' : '') });
    await waitReady(ws, 60000);

    const report = await evaluate(ws, "document.body.dataset.report || ''");
    const pages = await evaluate(ws, "document.querySelectorAll('.sheet').length");

    // the same findings as structured data, which is what the refit loop reads
    fs.writeFileSync(path.join(ROOT, 'data/fit-report.json'),
      await evaluate(ws, "document.body.dataset.reportJson || '{}'"));

    if (cmd === 'report') {
      console.log(report.split('  ·  ').join('\n  · '));
    } else if (cmd === 'pdf') {
      const out = path.join(ROOT, built.replace(/\.html$/, '.pdf'));
      const r = await rpc(ws, 'Page.printToPDF', {
        printBackground: true, preferCSSPageSize: true,
        paperWidth: 11.6929, paperHeight: 16.5354,
        marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0
      });
      fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
      console.log(`${path.relative(ROOT, out)}  (${pages} pages, A3)`);
      console.log('  ' + report.split('  ·  ').join('\n  · '));
    } else if (cmd === 'png') {
      const dir = path.join(ROOT, 'build');
      fs.mkdirSync(dir, { recursive: true });
      for (let i = 1; i <= pages; i++) {
        await evaluate(ws, `[...document.querySelectorAll('.sheet')].forEach((s,j)=>{
          s.style.display = (j === ${i - 1}) ? '' : 'none';
          s.style.margin = '0'; s.style.boxShadow = 'none'; s.style.background = '#fff';
        }); document.documentElement.style.background='#fff'; 1`);
        await sleep(120);
        const shot = await rpc(ws, 'Page.captureScreenshot', {
          format: 'png', captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: 1123, height: 1587, scale: 2 }
        });
        fs.writeFileSync(path.join(dir, `page-${i}.png`), Buffer.from(shot.data, 'base64'));
        console.log('  build/page-' + i + '.png');
      }
      console.log('  ' + report.split('  ·  ').join('\n  · '));
    }
  } finally {
    try { ws.close(); } catch (e) {}
    proc.kill();
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch (e) { /* chrome is still letting go of its profile; it is a temp dir */ }
  }
})().catch(e => { console.error(String(e.message || e)); process.exit(1); });
