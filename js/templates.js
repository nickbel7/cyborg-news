/* =========================================================================
   templates.js — page furniture as data.
   A slot is a rectangle on the 12-unit x 1mm paste-up grid:
     c = start unit (0-11), s = unit span, r = start row (mm), h = height (mm)
   The engine picks a template per page, then pours stories into the slots.
   Add a template here and the engine will start choosing it.
   ========================================================================= */
(function (g) {
  'use strict';

  const NAMEPLATE_H = 38;
  const FOLIO_H = 10;

  const COVER_TEMPLATES = [
    {
      id: 'cover/lead-plate',
      kind: 'cover',
      // one dominant story across three columns, a second beneath it, two
      // front-page briefs down the right
      wants: { art: true, articles: 4 },
      slots: [
        { n: 'nameplate', accepts: 'nameplate', c: 0, s: 12, r: 0, h: NAMEPLATE_H },
        { n: 'rail', accepts: 'rail', c: 0, s: 3, r: NAMEPLATE_H + 2, h: 237 },
        { n: 'lead', accepts: 'article', c: 3, s: 9, r: NAMEPLATE_H + 2, h: 136, artPos: 'top', drop: true, plateShare: 0.52 },
        { n: 'rule-a', accepts: 'rule', c: 3, s: 9, r: NAMEPLATE_H + 140, h: 1, weight: 'med' },
        { n: 'second', accepts: 'article', c: 3, s: 6, r: NAMEPLATE_H + 143, h: 96 },
        { n: 'brief-a', accepts: 'article', c: 9, s: 3, r: NAMEPLATE_H + 143, h: 46 },
        { n: 'rule-r', accepts: 'rule', c: 9, s: 3, r: NAMEPLATE_H + 191, h: 1 },
        { n: 'brief-b', accepts: 'article', c: 9, s: 3, r: NAMEPLATE_H + 194, h: 45 }
      ]
    },
    {
      id: 'cover/twin',
      kind: 'cover',
      // no dominant plate: two stories share the well, two briefs at the foot
      wants: { art: false, articles: 4 },
      slots: [
        { n: 'nameplate', accepts: 'nameplate', c: 0, s: 12, r: 0, h: NAMEPLATE_H },
        { n: 'rail', accepts: 'rail', c: 0, s: 3, r: NAMEPLATE_H + 2, h: 237 },
        { n: 'lead', accepts: 'article', c: 3, s: 6, r: NAMEPLATE_H + 2, h: 168, drop: true },
        { n: 'lead-b', accepts: 'article', c: 9, s: 3, r: NAMEPLATE_H + 2, h: 168 },
        { n: 'rule-a', accepts: 'rule', c: 3, s: 9, r: NAMEPLATE_H + 172, h: 1, weight: 'med' },
        { n: 'foot-a', accepts: 'article', c: 3, s: 6, r: NAMEPLATE_H + 175, h: 64 },
        { n: 'foot-b', accepts: 'article', c: 9, s: 3, r: NAMEPLATE_H + 175, h: 64 }
      ]
    }
  ];

  const INSIDE_TEMPLATES = [
    {
      id: 'inside/broadsheet',
      kind: 'inside',
      // page lead with a plate, a standing rail of boxes, two stories beneath
      wants: { articles: 4, boxes: 3 },
      slots: [
        { n: 'folio', accepts: 'folio', c: 0, s: 12, r: 0, h: FOLIO_H },
        { n: 'lead', accepts: 'article', c: 0, s: 9, r: FOLIO_H + 2, h: 150, artPos: 'top', drop: true, plateShare: 0.5 },
        { n: 'rail-a', accepts: 'box', c: 9, s: 3, r: FOLIO_H + 2, h: 70 },
        { n: 'rail-b', accepts: 'box', c: 9, s: 3, r: FOLIO_H + 76, h: 74 },
        { n: 'rail-c', accepts: 'box', c: 9, s: 3, r: FOLIO_H + 154, h: 38 },
        { n: 'rail-d', accepts: 'article', c: 9, s: 3, r: FOLIO_H + 196, h: 71 },
        { n: 'rule-a', accepts: 'rule', c: 0, s: 9, r: FOLIO_H + 156, h: 1, weight: 'med' },
        { n: 'mid-a', accepts: 'article', c: 0, s: 6, r: FOLIO_H + 159, h: 108 },
        { n: 'mid-b', accepts: 'article', c: 6, s: 3, r: FOLIO_H + 159, h: 108 }
      ]
    },
    {
      id: 'inside/feature',
      kind: 'inside',
      // a long read with a banner plate, a standing box, a tier of two beneath
      wants: { articles: 4, boxes: 1 },
      slots: [
        { n: 'folio', accepts: 'folio', c: 0, s: 12, r: 0, h: FOLIO_H },
        { n: 'feature', accepts: 'article', c: 0, s: 9, r: FOLIO_H + 2, h: 146, artPos: 'top', drop: true },
        { n: 'side-a', accepts: 'box', c: 9, s: 3, r: FOLIO_H + 2, h: 80 },
        { n: 'side-b', accepts: 'article', c: 9, s: 3, r: FOLIO_H + 86, h: 62 },
        { n: 'rule-a', accepts: 'rule', c: 0, s: 12, r: FOLIO_H + 152, h: 1, weight: 'med' },
        { n: 'mid-a', accepts: 'article', c: 0, s: 6, r: FOLIO_H + 155, h: 112 },
        { n: 'mid-b', accepts: 'article', c: 6, s: 6, r: FOLIO_H + 155, h: 112 }
      ]
    }
  ];

  g.Templates = { COVER_TEMPLATES, INSIDE_TEMPLATES, NAMEPLATE_H, FOLIO_H };
})(window);
