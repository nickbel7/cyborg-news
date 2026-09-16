/* =========================================================================
   templates.js — page furniture as data.
   A slot is a rectangle on the 18-unit x 1mm paste-up grid:
     c = start unit (0-17), s = unit span, r = start row (mm), h = height (mm)
   Three units make one text column, so the 269mm A3 well carries six columns.
   The well is 396mm tall: a 420mm sheet less 12mm top and bottom margin.

   The paper is always two A3 pages — one sheet, printed both sides.
   ========================================================================= */
(function (g) {
  'use strict';

  const NAMEPLATE_H = 48;
  const FOLIO_H = 12;

  const COVER_TEMPLATES = [
    {
      id: 'cover/a3-lead',
      kind: 'cover',
      // one dominant story across four columns with a plate, a narrative
      // single-column piece beside it, two more across the foot
      wants: { art: true, articles: 4 },
      slots: [
        { n: 'nameplate', accepts: 'nameplate', c: 0, s: 18, r: 0, h: NAMEPLATE_H },
        { n: 'rail', accepts: 'rail', c: 0, s: 3, r: NAMEPLATE_H + 2, h: 346 },
        { n: 'lead', accepts: 'article', c: 3, s: 12, r: NAMEPLATE_H + 2, h: 200, artPos: 'top', drop: true, plateShare: 0.54 },
        { n: 'second', accepts: 'article', c: 15, s: 3, r: NAMEPLATE_H + 2, h: 200 },
        { n: 'rule-a', accepts: 'rule', c: 3, s: 15, r: NAMEPLATE_H + 206, h: 1, weight: 'med' },
        { n: 'third', accepts: 'article', c: 3, s: 9, r: NAMEPLATE_H + 209, h: 139 },
        { n: 'fourth', accepts: 'article', c: 12, s: 6, r: NAMEPLATE_H + 209, h: 139 }
      ]
    },
    {
      id: 'cover/a3-twin',
      kind: 'cover',
      // no dominant plate: two leads share the well, three across the foot
      wants: { art: false, articles: 5 },
      slots: [
        { n: 'nameplate', accepts: 'nameplate', c: 0, s: 18, r: 0, h: NAMEPLATE_H },
        { n: 'rail', accepts: 'rail', c: 0, s: 3, r: NAMEPLATE_H + 2, h: 346 },
        { n: 'lead', accepts: 'article', c: 3, s: 9, r: NAMEPLATE_H + 2, h: 196, drop: true },
        { n: 'lead-b', accepts: 'article', c: 12, s: 6, r: NAMEPLATE_H + 2, h: 196 },
        { n: 'rule-a', accepts: 'rule', c: 3, s: 15, r: NAMEPLATE_H + 202, h: 1, weight: 'med' },
        { n: 'foot-a', accepts: 'article', c: 3, s: 6, r: NAMEPLATE_H + 205, h: 143 },
        { n: 'foot-b', accepts: 'article', c: 9, s: 6, r: NAMEPLATE_H + 205, h: 143 },
        { n: 'foot-c', accepts: 'article', c: 15, s: 3, r: NAMEPLATE_H + 205, h: 143 }
      ]
    }
  ];

  const INSIDE_TEMPLATES = [
    {
      id: 'inside/a3-lead',
      kind: 'inside',
      // a lead with a plate, a second beside it, then a tier of three shorts
      // and a tier of three standing boxes across the foot
      wants: { articles: 5, boxes: 3 },
      slots: [
        { n: 'folio', accepts: 'folio', c: 0, s: 18, r: 0, h: FOLIO_H },
        { n: 'lead', accepts: 'article', c: 0, s: 12, r: FOLIO_H + 2, h: 190, artPos: 'top', drop: true, plateShare: 0.40 },
        { n: 'second', accepts: 'article', c: 12, s: 6, r: FOLIO_H + 2, h: 190 },
        { n: 'rule-a', accepts: 'rule', c: 0, s: 18, r: FOLIO_H + 196, h: 1, weight: 'med' },
        { n: 'mid-a', accepts: 'article', c: 0, s: 6, r: FOLIO_H + 199, h: 124 },
        { n: 'mid-b', accepts: 'article', c: 6, s: 6, r: FOLIO_H + 199, h: 124 },
        { n: 'mid-c', accepts: 'article', c: 12, s: 6, r: FOLIO_H + 199, h: 124 },
        { n: 'rule-b', accepts: 'rule', c: 0, s: 18, r: FOLIO_H + 325, h: 1 },
        { n: 'box-a', accepts: 'box', c: 0, s: 6, r: FOLIO_H + 328, h: 56 },
        { n: 'box-b', accepts: 'box', c: 6, s: 6, r: FOLIO_H + 328, h: 56 },
        { n: 'box-c', accepts: 'box', c: 12, s: 6, r: FOLIO_H + 328, h: 56 }
      ]
    },
    {
      id: 'inside/a3-grid',
      kind: 'inside',
      // no single dominant story: four of comparable weight, boxes down one side
      wants: { articles: 4, boxes: 2 },
      slots: [
        { n: 'folio', accepts: 'folio', c: 0, s: 18, r: 0, h: FOLIO_H },
        { n: 'top-a', accepts: 'article', c: 0, s: 9, r: FOLIO_H + 2, h: 188, artPos: 'top', drop: true, plateShare: 0.42 },
        { n: 'top-b', accepts: 'article', c: 9, s: 6, r: FOLIO_H + 2, h: 188 },
        { n: 'side-a', accepts: 'box', c: 15, s: 3, r: FOLIO_H + 2, h: 188 },
        { n: 'rule-a', accepts: 'rule', c: 0, s: 18, r: FOLIO_H + 194, h: 1, weight: 'med' },
        { n: 'foot-a', accepts: 'article', c: 0, s: 6, r: FOLIO_H + 197, h: 187 },
        { n: 'foot-b', accepts: 'article', c: 6, s: 6, r: FOLIO_H + 197, h: 187 },
        { n: 'side-b', accepts: 'box', c: 12, s: 6, r: FOLIO_H + 197, h: 187 }
      ]
    }
  ];

  g.Templates = { COVER_TEMPLATES, INSIDE_TEMPLATES, NAMEPLATE_H, FOLIO_H };
})(window);
