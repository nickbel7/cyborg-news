# CYBORG NEWS

*A physical newspaper built from agents for humans.*

A printable A4 newspaper for the lab. You write the news into `data/issue.json`;
a layout engine pours it onto the page at render time. No page is pasted up by
hand, so a new issue is a new JSON file, not a new design job.

```bash
npm run proof      # build/page-1..3.png — proof sheets to look at
npm run pdf        # cyborg-news-<date>.pdf — print-ready A4
npm run report     # what the engine had to trim, jump or fill
npm start          # live preview at localhost:8123 (edit JSON, hit Reflow)
```

Nothing to install. Rendering needs Google Chrome; the fonts are already in
`assets/fonts/`, so it works offline and prints identically anywhere.

---

## Putting out an issue

Everything on the paper comes from `data/issue.json`.

```jsonc
{
  "issue":  { "dateline_long": "THURSDAY, SEPTEMBER 10, 2026", "pages": 3, … },
  "ticker": [ { "k": "EXPLOITBENCH", "v": "11.5", "d": "+6.0", "dir": "up" } ],
  "rail":   { "groups": [ { "label": "Research & Models", "items": [ … ] } ] },
  "articles": [ … ],
  "boxes":    [ … ],   // standing furniture: tables, agendas, house rules
  "fillers":  [ … ]    // one-liners the engine drops into short columns
}
```

Set `"jumps": true` inside `issue` to turn continuations back on — stories too
long for their hole then print a *Please turn to page A2* line and carry on in a
jump column, the way a broadsheet does. It is off by default: every story is
complete where it sits, and pages carry no A1/A2 numbers.

An article:

```jsonc
{
  "id": "flt",
  "page": 1,                    // optional; otherwise the engine decides
  "priority": 10,               // heavier stories get the bigger holes
  "kicker": "Formal Methods",
  "headline": "The Proof That No Human Wrote",
  "deck": "One sentence under the headline.",   // omit on briefs
  "byline": "By Someone Real",                  // optional; omitted in this issue
  "dateline": "Cambridge, Mass.",
  "body": ["paragraph", "paragraph", …],   // inline HTML is fine
  "art": { "type": "halftone", … },        // optional, see Plates
  "pullquote": { "text": "…", "attr": "…" }
}
```

Write long. The engine cuts to fit and tells you what it cut; it is easier to
trim copy than to fill a hole.

## What the engine does

`js/engine.js`, in order:

1. **Weighs** each story — the priority you set, how much copy there is, whether
   it brought a plate.
2. **Picks a page template** from `js/templates.js` by scoring each one against
   the stories left: does the lead have art, how many stories and boxes are
   waiting, does this page need to catch continuations from page one.
3. **Pours** stories into slots, heaviest into the largest hole.
4. **Fits.** Headlines are set to fill, then shrunk until the story has room.
   Plates are scaled to the space left over — and dropped if they would end up
   too small to read. Copy is cut to the leg by whole paragraphs, then by whole
   sentences, so a story never leaves a dead column behind it.
5. **Fills.** A leg that still ends short gets a one-liner from `fillers`.
6. **Audits.** After the browser settles it re-measures every leg. If a font
   finished loading late and reflowed fitted copy, it pours the whole paper
   again. Nothing is ever silently clipped off the bottom of a column.

`npm run report` prints the result:

```
3 pages
  · trimmed: muse-security −3¶, atlas −1¶, …
  · white space: data-efficiency ~20mm
  · fillers: 5
```

That is the editing to-do list: trims mean the copy is long for its hole, white
space means it is short.

## Plates

No photographs — everything is drawn, monochrome, and prints on any lab printer.
Set `art.type` to one of:

| type | for | notes |
|---|---|---|
| `schematic` | architectures, decision paths | boxes, zones, arrows; see the Muse and CW-Net entries |
| `bars` | one measure across categories | diverging around zero, direct-labelled |
| `line` | a quantity over time | single series, hatched fill |
| `stats` | a finding that is really one number | scales to any width; often the right answer instead of a chart |
| `halftone` | an illustration | procedural field through an ordered dither, so it reproduces as true 1-bit newsprint (`field`: `tree`, `lattice`, `field`) |

Charts are monochrome by necessity, so series are told apart by shape, texture
and direct labels rather than colour, and any plate that cannot be drawn at a
legible size is dropped and reported instead of being shrunk into noise.

## Changing the paper

- **Bullets** — the What's News rail is bulleted with the Media Lab mark,
  `assets/bullet.svg`. Replace that file to change it; it is drawn from rects on
  a pixel grid, so it stays crisp at any size.
- **Masthead** — edit `NAME` in `tools/make-logo.js` and run `npm run logo`. The
  wordmark is generated from a 5×7 bitmap font, so a rename redraws it. Two
  lockups come out: `logo-inline.svg` for the nameplate, `logo-stacked.svg` for
  the running folios.
- **Page shapes** — `js/templates.js`. A slot is a rectangle on a 12-unit ×
  1 mm grid: `{ c: 3, s: 6, r: 40, h: 160 }` is six units wide (two text
  columns) starting 40 mm down. Add a template and the engine starts choosing
  it when the mix of stories suits it.
- **Type and rules** — the tokens at the top of `css/newspaper.css`. The grid is
  four text columns on A4: 186 mm of well, 4 mm gutters, 8.5/10.6 pt body.
- **Length** — `issue.pages`. Templates repeat as needed.

## Files

```
index.html            entry point; loads the data and draws
data/issue.json       the whole issue
js/engine.js          weighing, pagination, fitting, jumps
js/templates.js       page shapes
js/art.js             charts, schematics, halftones
css/newspaper.css     the design system
tools/make-logo.js    regenerates the pixel wordmark
tools/build.js        inlines the data into a standalone HTML file
tools/render.js       drives headless Chrome for PDFs and proof sheets
tools/serve.js        local preview server
```

Sources for this issue: Anthropic, *Formalizing Fermat's Last Theorem*, Sept. 4,
2026; Meta Superintelligence Labs, *Security and safety for AI agents: our
approach with Muse*, Sept. 8, 2026; Emily Forlini, *Fortune*, Sept. 4, 2026.
Quotations are as published in those sources.
