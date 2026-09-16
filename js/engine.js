/* =========================================================================
   engine.js — pours an issue of news into printed pages.

   Pipeline:   weigh -> pick templates -> assign to slots -> render
               -> fit (shrink heds, trim bodies, open jumps) -> report
   Nothing about the layout is hard-coded to today's stories: change
   data/issue.json and the page redraws around whatever is there.
   ========================================================================= */
(function (g) {
  'use strict';

  const { el, esc, buildFigure } = g.Art;
  const { COVER_TEMPLATES, INSIDE_TEMPLATES } = g.Templates;

  const MM = 96 / 25.4;                       // css px per mm at 1x
  const PAGE_LABEL = i => (i === 0 ? 'A1' : 'A' + (i + 1));

  /* ---------------------------------------------------------------- weigh */
  // A story's pull on the page: what the editor asked for, how much copy
  // there is, and whether it brought a plate with it.
  function weigh(a) {
    const words = (a.body || []).join(' ').split(/\s+/).length;
    return (a.priority || 5) * 100 + Math.min(words, 900) / 6 + (a.art ? 45 : 0) +
      (a.pullquote ? 12 : 0);
  }

  /* ------------------------------------------------------- pick templates */
  function score(tpl, pool, boxes, needJumps) {
    const artSlots = tpl.slots.filter(s => s.accepts === 'article');
    const boxSlots = tpl.slots.filter(s => s.accepts === 'box');
    const jumpSlots = tpl.slots.filter(s => s.accepts === 'jump');
    let sc = 0;
    sc -= Math.abs(artSlots.length - Math.min(pool.length, tpl.wants.articles || 4)) * 30;
    sc -= Math.abs(boxSlots.length - Math.min(boxes.length, tpl.wants.boxes || 0)) * 12;
    sc += (needJumps && jumpSlots.length) ? 60 : 0;
    sc -= (!needJumps && jumpSlots.length) ? 45 : 0;
    // a template with a plate slot only earns its keep if the top story has art
    const top = pool[0];
    if (tpl.wants.art != null) sc += (!!(top && top.art) === !!tpl.wants.art) ? 40 : -40;
    return sc;
  }

  function pickTemplate(list, pool, boxes, needJumps, used) {
    const ranked = list.map(t => ({ t, s: score(t, pool, boxes, needJumps) - (used.has(t.id) ? 25 : 0) }))
      .sort((a, b) => b.s - a.s);
    return ranked[0].t;
  }

  /* ------------------------------------------------------------- assemble */
  function planIssue(data) {
    const articles = data.articles.map(a => ({ ...a, _w: weigh(a) }))
      .sort((a, b) => (b.pin === true) - (a.pin === true) || b._w - a._w);
    const boxes = (data.boxes || []).slice();
    const pages = [];
    const used = new Set();
    let pool = articles.slice();
    let boxPool = boxes.slice();
    const pageCount = data.issue.pages || 3;

    for (let p = 0; p < pageCount; p++) {
      const isCover = p === 0;
      const list = isCover ? COVER_TEMPLATES : INSIDE_TEMPLATES;
      // page 2 is where front-page stories are expected to land
      const needJumps = !isCover && p === 1;
      // An issue may pin its page plan — "plan": ["cover/pair", "inside/pair"].
      // Pinning makes the word budget knowable before a word is written, which
      // is the whole reason the planner picks the plan rather than inferring it.
      const pinned = (data.issue.plan || [])[p];
      const tpl = (pinned && [...COVER_TEMPLATES, ...INSIDE_TEMPLATES]
        .find(t => t.id === pinned)) || pickTemplate(list, pool, boxPool, needJumps, used);
      used.add(tpl.id);

      const artSlots = tpl.slots.filter(s => s.accepts === 'article')
        .sort((x, y) => area(y) - area(x));
      const placed = [];
      artSlots.forEach(slot => {
        // honour an explicit slot request, otherwise take the heaviest left
        let idx = pool.findIndex(a => a.slot === slot.n || (a.page === p + 1 && a.slot === slot.n));
        if (idx < 0) idx = pool.findIndex(a => a.page == null || a.page === p + 1);
        if (idx < 0) return;
        const a = pool.splice(idx, 1)[0];
        placed.push({ slot, article: a });
      });

      const boxSlots = tpl.slots.filter(s => s.accepts === 'box');
      const boxPlaced = [];
      boxSlots.forEach(slot => {
        let idx = boxPool.findIndex(b => b.slot === slot.n);
        if (idx < 0) idx = 0;
        if (!boxPool.length) return;
        boxPlaced.push({ slot, box: boxPool.splice(idx, 1)[0] });
      });

      pages.push({ index: p, tpl, placed, boxPlaced, jumps: [] });
    }
    return { pages, leftovers: pool, data };
  }

  const area = s => s.s * s.h;

  /* -------------------------------------------------------------- render  */
  function hedClassFor(slot) {
    const A = area(slot);
    // thresholds are in slot-area units (span x mm) and were retuned for A3
    if (A >= 2000) return { cls: 'hed-1', scale: slot.s >= 9 ? 1.2 : 1 };
    if (A >= 1000) return { cls: 'hed-2', scale: slot.s >= 9 ? 1.18 : 1 };
    if (A >= 550) return { cls: 'hed-3', scale: 1 };
    return { cls: 'hed-4', scale: 1 };
  }

  function renderNameplate(issue) {
    const n = el('div', { class: 'nameplate' });
    n.innerHTML = `
      <div class="ears">
        <span>${esc(issue.left_ear || '')}</span>
        <span>${esc(issue.right_ear || '')}</span>
      </div>
      <div class="logo"><img src="assets/logo-inline.svg" alt="${esc(issue.name)}"></div>
      <div class="folio-line">
        <b>${esc(issue.site || '')}</b>
        <span class="center">${[issue.dateline_long, issue.volume, issue.number]
          .filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ')}</span>
        <b>${esc(issue.price || '')}</b>
      </div>`;
    return n;
  }

  function renderTicker(items) {
    const t = el('div', { class: 'ticker' });
    items.forEach(it => {
      t.appendChild(el('div', { class: 'tick' },
        `<span class="k">${esc(it.k)}</span>
         <span class="v ${it.dir || 'flat'}"><b>${esc(it.v)}</b><span>${esc(it.d || '')}</span></span>`));
    });
    return t;
  }

  function renderFolio(issue, pageIndex, section) {
    const f = el('div', { class: 'folio' });
    f.innerHTML = `
      <span class="mark"><img src="assets/logo-stacked.svg" alt="" style="height:5.6mm">
        <span>${esc(issue.dateline_short)}</span></span>
      <span class="section">${esc(section || 'Research &amp; Industry')}</span>`;
    return f;
  }

  function renderRail(rail) {
    const r = el('div', { class: 'rail' });
    let html = `<div class="rail-head">${esc(rail.title || "What's")}<br><i>${esc(rail.title2 || 'News')}</i></div>`;
    (rail.groups || []).forEach(gr => {
      html += `<div class="rail-sect">${esc(gr.label)}</div><ul class="briefs">`;
      gr.items.forEach(it => {
        html += `<li><img class="ml" src="assets/bullet.svg" alt="">` +
          `<b>${esc(it.lead)}</b> ${esc(it.text)}` +
          `${it.ref ? ` <span class="ref">${esc(it.ref)}</span>` : ''}</li>`;
      });
      html += '</ul>';
    });
    r.innerHTML = html;
    return r;
  }

  function renderBox(box) {
    const b = el('div', { class: 'boxed' + (box.tint ? ' tint' : '') + (box.plain ? ' plain' : '') });
    if (box.title) b.appendChild(el('div', { class: 'box-head' }, esc(box.title)));
    const wrap = el('div', {});
    wrap.style.cssText = 'flex:1 1 auto;min-height:0;overflow:hidden';
    if (box.kind === 'table') wrap.appendChild(g.Art.PLATES.table(box));
    else if (box.kind === 'stats') wrap.appendChild(g.Art.PLATES.stats(box));
    else if (box.kind === 'listing') {
      const l = el('div', { class: 'listing' });
      l.innerHTML = box.rows.map(r =>
        `<div class="row"><div class="when">${esc(r.when)}</div>
         <div class="what"><b>${esc(r.what)}</b><span>${esc(r.who || '')}</span></div></div>`).join('');
      wrap.appendChild(l);
    } else if (box.kind === 'text') {
      const t = el('div', { class: 'body' });
      t.style.cssText = 'column-count:1;text-align:left;margin-top:0';
      t.innerHTML = box.paras.map(p => `<p>${p}</p>`).join('');
      wrap.appendChild(t);
    } else if (box.kind === 'colophon') {
      wrap.appendChild(el('div', { class: 'colophon' + (box.cols ? ' cols' : '') }, box.text));
    } else if (box.kind === 'plate') {
      const fig = buildFigure(box.art);
      if (fig) wrap.appendChild(fig);
    }
    if (box.note) {
      const nn = el('div', { class: 'colophon' }, esc(box.note));
      nn.style.marginTop = '1.6mm';
      wrap.appendChild(nn);
    }
    b.appendChild(wrap);
    return b;
  }

  function renderArticle(a, slot, ctx) {
    const wrap = el('div', { class: 'art-block' });
    wrap.dataset.article = a.id;
    const head = el('div', { class: 'head' });
    const { cls, scale } = hedClassFor(slot);
    let h = '';
    if (a.kicker) h += `<div class="kicker">${esc(a.kicker)}</div>`;
    h += `<h2 class="hed ${cls}">${esc(a.headline)}</h2>`;
    if (a.deck) h += `<div class="deck${slot.s <= 3 ? ' sans' : ''}">${esc(a.deck)}</div>`;
    if (a.byline) h += `<div class="byline">${esc(a.byline)}${a.role ? `<span class="role">${esc(a.role)}</span>` : ''}</div>`;
    head.innerHTML = h;
    const hed = head.querySelector('.hed');
    if (scale !== 1) {
      const base = parseFloat(getComputedStyle(document.documentElement).fontSize); // unused, kept explicit
      hed.dataset.scale = scale;
    }
    wrap.appendChild(head);

    // where a plate goes: above the columns, inside the flow, or nowhere at
    // all when the leg is a single column too narrow to carry it
    const artPos = a.artPos || slot.artPos || (slot.s >= 6 ? 'top' : slot.s >= 3 ? 'column' : null);
    if (a.art && artPos === 'top') {
      const fig = buildFigure(a.art);
      if (fig) { fig.classList.add('top'); wrap.appendChild(fig); }   // sibling of .head
    }

    const cols = Math.max(1, Math.floor(slot.s / 3));
    const body = el('div', { class: `body cols-${cols}${a.dropcap !== false && slot.drop ? ' dropcap' : ''}` });
    const paras = (a.body || []).slice();
    paras.forEach((p, i) => {
      const node = el('p', {});
      node.innerHTML = (i === 0 && a.dateline)
        ? `<span class="dateline">${esc(a.dateline)}</span>${p}` : p;
      body.appendChild(node);
      if (a.art && artPos === 'column' && i === (a.artAfter == null ? 1 : a.artAfter)) {
        const fig = buildFigure(a.art);       // one column wide, inside the flow
        if (fig) { fig.classList.add('in-column'); body.appendChild(fig); }
      }
      if (a.pullquote && i === (a.quoteAfter == null ? 2 : a.quoteAfter)) {
        const q = el('div', { class: 'pullquote' + (cols > 1 ? '' : '') });
        q.innerHTML = `<q>${esc(a.pullquote.text)}</q><span class="attr">${esc(a.pullquote.attr)}</span>`;
        body.appendChild(q);
      }
    });
    wrap.appendChild(body);
    return wrap;
  }

  function renderJump(j, issue) {
    const wrap = el('div', { class: 'art-block' });
    const head = el('div', { class: 'head' });
    head.innerHTML =
      `<div class="jump-from">Continued from Page ${PAGE_LABEL(j.fromPage)}</div>
       <h3 class="hed hed-4">${esc(j.headline)}</h3>`;
    wrap.appendChild(head);
    const body = el('div', { class: 'body cols-1' });
    j.paras.forEach(p => { const n = el('p', {}); n.innerHTML = p; body.appendChild(n); });
    wrap.appendChild(body);
    return wrap;
  }

  /* ------------------------------------------------------------- the page */
  function buildPage(page, data, root) {
    const sheet = el('section', { class: 'sheet' });
    sheet.dataset.page = PAGE_LABEL(page.index);
    sheet.dataset.template = page.tpl.id;
    const well = el('div', { class: 'well' });

    const put = (slot, node, extraClass) => {
      const s = el('div', { class: 'slot' + (extraClass ? ' ' + extraClass : '') });
      s.style.gridColumn = `${slot.c + 1} / span ${slot.s}`;
      s.style.gridRow = `${slot.r + 1} / span ${slot.h}`;
      s.dataset.slot = slot.n;
      s.dataset.h = slot.h;
      if (node) s.appendChild(node);
      well.appendChild(s);
      return s;
    };

    page.tpl.slots.forEach(slot => {
      if (slot.accepts === 'nameplate') {
        const holder = el('div', {});
        holder.appendChild(renderNameplate(data.issue));
        if (data.ticker) holder.appendChild(renderTicker(data.ticker));
        put(slot, holder);
      } else if (slot.accepts === 'folio') {
        put(slot, renderFolio(data.issue, page.index, page.tpl.section || data.issue.sections?.[page.index]));
      } else if (slot.accepts === 'rail') {
        put(slot, renderRail(data.rail));
      } else if (slot.accepts === 'rule') {
        const s = put(slot, null, 'rule-slot');
        s.appendChild(el('hr', { class: 'hr' + (slot.weight === 'med' ? '' : ' thin') }));
      }
    });

    page.placed.forEach(({ slot, article }) => {
      const s = put(slot, renderArticle(article, slot, { page }));
      s.dataset.role = 'article';
      article._slotEl = s;
      article._slot = slot;
      article._page = page.index;
    });
    page.boxPlaced.forEach(({ slot, box }) => put(slot, renderBox(box)).dataset.role = 'box');
    page._jumpSlots = page.tpl.slots.filter(s => s.accepts === 'jump').map(slot => {
      const s = put(slot, null, 'jump-slot');
      s.dataset.capacity = slot.capacity || 1;
      return s;
    });

    sheet.appendChild(well);
    root.appendChild(sheet);
    page.sheet = sheet;
    return sheet;
  }

  /* ---------------------------------------------------------------- fit   */
  // A hair of slack: the sheet is measured in millimetres and rasterised in
  // device pixels, and a leg fitted to the last pixel loses its bottom line to
  // rounding. SLACK costs a fraction of a line and guarantees nothing clips.
  const overflowing = body => body.scrollWidth > body.clientWidth + 1 ||
    body.scrollHeight > body.clientHeight + 1;

  /* --- how much of the leg is still blank, counting untouched columns ---- */
  function legMetrics(body) {
    const cs = getComputedStyle(body);
    const cols = Math.max(1, parseInt(cs.columnCount, 10) || 1);
    const H = body.clientHeight;
    const kids = [...body.children].filter(n => n.offsetHeight || n.offsetWidth);
    if (!kids.length) return { emptyPx: H * cols, cols };
    const box = body.getBoundingClientRect();
    const gap = parseFloat(cs.columnGap || 0) || 0;
    const pitch = (box.width - (cols - 1) * gap) / cols + gap;
    let best = { col: 0, bottom: 0 };
    kids.forEach(k => {
      // a paragraph broken across columns has one client rect per fragment;
      // the last one is the only one that says where the copy actually ends
      const rects = k.getClientRects();
      const r = rects.length ? rects[rects.length - 1] : k.getBoundingClientRect();
      const col = Math.min(cols - 1, Math.max(0, Math.round((r.left - box.left) / (pitch || 1))));
      const bottom = r.bottom - box.top;
      if (col > best.col || (col === best.col && bottom > best.bottom)) best = { col, bottom };
    });
    return { emptyPx: (cols - 1 - best.col) * H + Math.max(0, H - best.bottom), cols };
  }
  const whiteMM = body => legMetrics(body).emptyPx / MM;

  /* --- plates are sized to the hole they have to fit through ------------- */
  function fitFigure(fig, budgetPx) {
    const plate = fig.querySelector('.plate');
    const node = plate && (plate.querySelector('svg') || plate.querySelector('canvas'));
    if (!node) {                                   // a stat strip: it scales by dropping furniture
      if (fig.offsetHeight <= budgetPx) return true;
      fig.querySelector('figcaption')?.remove();
      if (fig.offsetHeight <= budgetPx) return true;
      fig.remove();
      return false;
    }
    const capH = fig.offsetHeight - (plate.offsetHeight || 0);   // caption etc.
    const avail = Math.max(40, budgetPx - capH);
    let ratio;
    if (node.tagName.toLowerCase() === 'svg') {
      const vb = (node.getAttribute('viewBox') || '0 0 1 1').split(/\s+/).map(Number);
      ratio = vb[3] / vb[2];
    } else {
      ratio = node.height / node.width;
    }
    const full = plate.clientWidth || fig.clientWidth;
    if (full * ratio <= avail) return 1;                          // fills the measure
    const w = avail / ratio;
    if (w < MIN_PLATE_MM * MM) { fig.remove(); return 0; }        // too small to read
    node.style.width = w + 'px';
    node.style.margin = '0 auto';
    return w / full;                                              // shrunk: leaves padding
  }
  const MIN_PLATE_MM = 58;

  /* --- headlines are set to fill, then shrunk until the well breathes ---- */
  function fitHeadline(slotEl, maxFrac) {
    const head = slotEl.querySelector('.head');
    const hed = slotEl.querySelector('.hed');
    if (!head || !hed) return;
    const budget = slotEl.clientHeight * maxFrac;
    let size = parseFloat(getComputedStyle(hed).fontSize) * parseFloat(hed.dataset.scale || 1);
    hed.style.fontSize = size + 'px';
    let guard = 0;
    while (head.offsetHeight > budget && guard++ < 30 && size > 8.5) {
      size *= 0.955;
      hed.style.fontSize = size + 'px';
    }
  }

  /* --- trim copy to the leg: whole paragraphs, then whole sentences ------ */
  const SENT = /(?<=[.!?][”’"')\]]?)\s+(?=[A-Z“"'(\[])/;
  const splitSentences = html => html.split(SENT).filter(Boolean);

  function fitBody(slotEl, opts) {
    const body = slotEl.classList.contains('body') ? slotEl : slotEl.querySelector('.body');
    if (!body) return [];
    const keep = opts && opts.keep;                  // stays last, always measured
    const nodes = [...body.children].filter(n => n !== keep);
    if (!overflowing(body)) return [];

    let lo = 0, hi = nodes.length;                         // paragraph-level cut
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      nodes.forEach((n, i) => n.style.display = i < mid ? '' : 'none');
      if (overflowing(body)) hi = mid - 1; else lo = mid;
    }
    nodes.forEach((n, i) => n.style.display = i < lo ? '' : 'none');

    const rest = nodes.slice(lo);
    const cut = [];

    // fill the rest of the leg with as much of the next paragraph as fits,
    // so a story never leaves a dead column behind it
    if ((!opts || opts.split !== false) && rest[0] && rest[0].tagName === 'P') {
      const p = rest[0];
      const sent = splitSentences(p.innerHTML);
      if (sent.length > 1) {
        const whole = p.innerHTML;
        p.style.display = '';
        let slo = 0, shi = sent.length - 1;
        while (slo < shi) {
          const mid = (slo + shi + 1) >> 1;
          p.innerHTML = sent.slice(0, mid).join(' ');
          if (overflowing(body)) shi = mid - 1; else slo = mid;
        }
        if (slo > 0) {
          p.innerHTML = sent.slice(0, slo).join(' ');
          cut.push(sent.slice(slo).join(' '));
          rest.shift();
        } else {
          p.innerHTML = whole;
          p.style.display = 'none';
        }
      }
    }

    rest.forEach(n => { if (n.tagName === 'P') cut.push(n.innerHTML); n.remove(); });
    [...body.children].forEach(n => n.style.display = '');

    // whatever the measurement missed, take off the bottom until it sits
    let guard = 0;
    while (overflowing(body) && guard++ < 60) {
      let last = body.lastElementChild;
      if (last === keep) last = last.previousElementSibling;
      if (!last) break;
      if (last.tagName === 'P') cut.unshift(last.innerHTML);
      last.remove();
    }
    return cut;
  }

  // boxes trim by dropping rows off the bottom, not by clipping
  function fitBox(slotEl) {
    const box = slotEl.querySelector('.boxed');
    if (!box) return 0;
    const hold = box.lastElementChild;
    if (!hold) return 0;
    let cut = 0, guard = 0;
    const droppable = () => hold.querySelector(
      'tbody tr:last-child, .listing .row:last-child, .stats .stat:last-child, .body p:last-child')
      || hold.querySelector(':scope > .colophon');   // the source note goes last
    while (hold.scrollHeight > hold.clientHeight + 1 && guard++ < 40) {
      const d = droppable();
      if (!d) break;
      d.remove(); cut++;
    }
    return cut;
  }

  /* --- column fillers: the short items that stop a leg running out ------- */
  function fillLeg(slotEl, fillers, report) {
    const body = slotEl.querySelector('.body');
    if (!body || !fillers.length) return;
    let guard = 0;
    while (whiteMM(body) > 11 && guard++ < 6) {
      let placed = false;
      for (let i = 0; i < fillers.length; i++) {          // shortest that will fit
        const f = fillers[i];
        const node = el('div', { class: 'filler' }, `<b>${esc(f.hed)}</b> ${f.text}`);
        body.appendChild(node);
        if (overflowing(body)) { node.remove(); continue; }
        fillers.splice(i, 1);
        if (report) report.fillers.push(f.hed);
        placed = true;
        break;
      }
      if (!placed) break;
    }
  }

  function addJumpLine(body, toPage) {
    const line = el('div', { class: 'jump' }, `Please turn to page ${PAGE_LABEL(toPage)}`);
    body.appendChild(line);
    return line;
  }

  // the rail is a list, so it trims by dropping whole items off the bottom
  function fitRail(slotEl, report) {
    const rail = slotEl.querySelector('.rail');
    if (!rail) return;
    let guard = 0;
    while (rail.scrollHeight > slotEl.clientHeight + 1 && guard++ < 40) {
      const groups = [...rail.querySelectorAll('.briefs')];
      const lastList = groups[groups.length - 1];
      if (!lastList) break;
      const items = lastList.querySelectorAll('li');
      if (items.length > 1) items[items.length - 1].remove();
      else { lastList.previousElementSibling?.remove(); lastList.remove(); }
      if (report) report.railCut = (report.railCut || 0) + 1;
    }
  }

  // Nothing on the paper may be silently clipped. Run this again after the
  // browser has settled: a face that swaps in late reflows fitted copy.
  function audit(root) {
    const bad = [];
    root.querySelectorAll('.sheet .body, .sheet .rail, .sheet .boxed > div:last-child').forEach(b => {
      if (b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1) {
        const sl = b.closest('.slot');
        bad.push(`${sl?.closest('.sheet')?.dataset.page || '?'}/${sl?.dataset.slot || '?'}`);
      }
    });
    return bad;
  }

  function run(data, root, opts) {
    const plan = planIssue(data);
    root.innerHTML = '';
    plan.pages.forEach(p => buildPage(p, data, root));

    const report = { pages: plan.pages.length, jumps: [], trimmed: [], white: [], dropped: [], fillers: [], plates: [], plateFit: [], clipped: [] };
    const report0 = report;
    const fillers = (data.fillers || []).slice();

    // every continuation column on the paper, in reading order
    const jumpSlots = [];
    plan.pages.forEach((page, i) => (page._jumpSlots || []).forEach(sl => {
      const cap = Number(sl.dataset.capacity || 1);
      for (let k = 0; k < cap; k++) jumpSlots.push({ el: sl, page: i });
    }));

    root.querySelectorAll('.slot').forEach(sl => {
      if (sl.querySelector('.rail')) fitRail(sl, report);
      if (sl.dataset.role === 'box') {
        const n = fitBox(sl);
        const name = sl.querySelector('.box-head')?.textContent || sl.dataset.slot;
        if (n) report.trimmed.push(`"${name}" −${n} rows`);
      }
    });

    // pass 1 — plates, then headlines, so the copy knows what room it has
    plan.pages.forEach(page => page.placed.forEach(({ slot, article }) => {
      const slotEl = article._slotEl;
      fitHeadline(slotEl, slot.h > 120 ? 0.30 : slot.h > 80 ? 0.42 : 0.58);
      const fig = slotEl.querySelector('figure');
      if (fig) {
        const head = slotEl.querySelector('.head');
        const left = slotEl.clientHeight - head.offsetHeight;
        const kept = fitFigure(fig, left * (slot.plateShare || 0.45));
        if (kept === 0) report0.plates.push(article.id);
        else if (kept < 0.99) report0.plateFit.push(`${article.id} ${Math.round(kept * 100)}% of measure`);
      }
    }));

    // pass 2 — copy. Continuations are off unless the issue asks for them:
    // set "jumps": true in data/issue.json to turn "turn to page" lines back on.
    const allowJumps = data.issue.jumps === true;
    const queued = [];
    plan.pages.forEach(page => page.placed.forEach(({ slot, article }) => {
      const slotEl = article._slotEl;
      const body = slotEl.querySelector('.body');
      const bigEnough = allowJumps && area(slot) >= (article.jumpTo ? 300 : 520);
      const free = jumpSlots.findIndex(j => j.page > page.index);
      if (overflowing(body) && bigEnough && free >= 0) {
        const target = jumpSlots.splice(free, 1)[0];
        const line = addJumpLine(body, target.page);
        const cut = fitBody(slotEl, { keep: line });
        body.appendChild(line);                       // it belongs at the foot
        if (cut.length) {
          queued.push({ target, fromPage: page.index, headline: article.jumpHed || article.headline, paras: cut, id: article.id });
          report.jumps.push(`${article.id}→${PAGE_LABEL(target.page)}`);
        } else { line.remove(); jumpSlots.splice(free, 0, target); }
      } else {
        const cut = fitBody(slotEl);
        if (cut.length) report.trimmed.push(`${article.id} −${cut.length}¶`);
      }
      fillLeg(slotEl, fillers, report);
    }));

    // pass 3 — set the continuations, sharing a rail between several stories
    const byRail = new Map();
    queued.forEach(j => {
      if (!byRail.has(j.target.el)) byRail.set(j.target.el, []);
      byRail.get(j.target.el).push(j);
    });
    byRail.forEach((list, railEl) => {
      railEl.style.display = 'flex';
      railEl.style.flexDirection = 'column';
      railEl.style.gap = '4mm';
      const GAP = 4 * MM;
      const each = (railEl.clientHeight - GAP * (list.length - 1)) / list.length;
      list.forEach(j => {
        const block = renderJump(j, data.issue);
        block.style.flex = 'none';
        block.style.height = each + 'px';                  // .art-block is height:100%
        block.style.minHeight = '0';
        railEl.appendChild(block);
      });
      list.forEach((j, i) => {
        const block = railEl.children[i];
        const cut = fitBody(block, { split: true });
        if (cut.length) report.trimmed.push(`${j.id} jump −${cut.length}¶`);
        fillLeg(block, fillers, report);
      });
    });

    report.clipped = audit(root);

    // pass 4 — what white space is left
    root.querySelectorAll('.slot[data-role="article"]').forEach(s => {
      const body = s.querySelector('.body');
      if (!body) return;
      const mm = whiteMM(body);
      if (mm > 14) report.white.push(`${s.querySelector('[data-article]')?.dataset.article} ~${Math.round(mm)}mm`);
    });

    if (opts && opts.onReport) opts.onReport(report);
    return report;
  }

  g.Engine = { run, audit, planIssue, weigh, PAGE_LABEL };
})(window);
