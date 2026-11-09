#!/usr/bin/env node
/* Regenerates the whole sector map in data/campaign.json.

   The sector is three concentric bands, outside in:
     the rim      — 14 held territories, a settlement and a second holding per gang
     the marches  — 8 unclaimed territories, a buffer nobody owns
     the deep     — 16 unsurveyed holdings, drawn as one fogged region

   Bands are built geometrically rather than by Voronoi, because 8 marches
   cells cannot reliably shield 14 rim cells from the deep when the cells are
   grown from seed points — rim cells reach through the angular gaps. Here each
   band is bounded by two shared noise curves, so the buffer is exact by
   construction. All waviness is baked into the emitted polygons: neighbouring
   territories read the same sampled points, so borders coincide exactly and no
   seam can appear.

   WARNING: this overwrites data/campaign.json, losing ownership changes and
   battles. It is for reshaping the sector before a campaign, not during one. */

import { writeFileSync } from 'node:fs';

const CX = 860, CY = 700;
const RAD = Math.PI / 180;

/* base radii of the three shared curves */
const OUT = { rx: 740, ry: 560 };   // sector outline
const MID = { rx: 520, ry: 394 };   // rim / marches border
const DEEP = { rx: 330, ry: 250 };  // marches / deep border

const ARC_STEP = 2.5 * RAD;   // sampling along a curve
const DIVIDER_STEPS = 7;      // sampling across a band

/* ---------- deterministic noise ---------- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261108);
const jit = (amp) => (rnd() - 0.5) * 2 * amp;
const r2 = (n) => Math.round(n * 100) / 100;

/* A curve is an ellipse breathed in and out by a stack of sine waves, so it
   stays a simple closed loop while never looking drawn with a compass. */
function makeCurve(base, harmonics) {
  return (theta) => {
    const c = Math.cos(theta), s = Math.sin(theta);
    const r = (base.rx * base.ry) / Math.sqrt((base.ry * c) ** 2 + (base.rx * s) ** 2);
    let f = 1;
    for (const [k, amp, phase] of harmonics) f += Math.sin(k * theta + phase) * amp;
    return r * f;
  };
}

const curveOut = makeCurve(OUT, [
  [2, 0.055, 1.3], [3, 0.040, 0.7], [5, 0.024, 2.1],
  [8, 0.014, 4.3], [13, 0.008, 5.6], [21, 0.005, 2.8]
]);
const curveMid = makeCurve(MID, [
  [2, 0.050, 3.9], [3, 0.034, 5.2], [5, 0.022, 1.1],
  [9, 0.013, 2.6], [14, 0.008, 0.4], [22, 0.005, 4.9]
]);
const curveDeep = makeCurve(DEEP, [
  [2, 0.085, 2.4], [3, 0.055, 4.8], [5, 0.034, 0.3],
  [7, 0.022, 3.3], [11, 0.013, 1.7], [19, 0.008, 5.1]
]);

const at = (curve, theta) => [
  r2(CX + Math.cos(theta) * curve(theta)),
  r2(CY + Math.sin(theta) * curve(theta))
];

/* Sample a curve from a to b (a < b), landing exactly on both ends so that
   adjacent cells share their corner points. */
function arc(curve, a, b) {
  const span = b - a;
  const steps = Math.max(2, Math.ceil(Math.abs(span) / ARC_STEP));
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push(at(curve, a + (span * i) / steps));
  return pts;
}

/* A divider runs across a band at a fixed angle, bowing slightly so the
   border is not a dead straight spoke. Both neighbours build it from the same
   seed, so they agree point for point. */
function divider(inner, outer, theta, seed) {
  const r = mulberry32(seed);
  const a1 = (r() - 0.5) * 0.9, a2 = (r() - 0.5) * 0.5;
  const amp = 2.6 * RAD;
  const pts = [];
  for (let i = 0; i <= DIVIDER_STEPS; i++) {
    const t = i / DIVIDER_STEPS;
    const bow = Math.sin(Math.PI * t) * (a1 + a2 * Math.sin(3 * Math.PI * t)) * amp;
    const th = theta + bow;
    const ri = inner(th), ro = outer(th);
    const rr = ri + (ro - ri) * t;
    pts.push([r2(CX + Math.cos(th) * rr), r2(CY + Math.sin(th) * rr)]);
  }
  return pts;
}

function dedupe(poly) {
  const out = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 0.01 || Math.abs(last[1] - p[1]) > 0.01) out.push(p);
  }
  while (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) <= 0.01 && Math.abs(a[1] - b[1]) <= 0.01) out.pop();
    else break;
  }
  return out;
}

function centroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const f = p[0] * q[1] - q[0] * p[1];
    a += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-6) return [poly[0][0], poly[0][1]];
  return [r2(cx / (6 * a)), r2(cy / (6 * a))];
}

/* ---------- the charted territories, in ring order ---------- */

const outer = [
  { id: 'sumptown',          name: 'Sumptown',            type: 'Settlement',       owner: 'sumptown',            settlement: true,  income: 'D6x10 credits', boon: 'Recruit one Juve free each Downtime',            notes: 'Barge wharves and a century of silt. Everything coming down from above lands here first.' },
  { id: 'the-chokestack',    name: 'The Chokestack',      type: 'Slag Furnace',     owner: 'sumptown',            settlement: false, income: 'D6x10 credits', boon: 'Free Brute hire this cycle',                     notes: 'The furnace still runs. Nobody admits to lighting it and nobody dares let it go out.' },
  { id: 'glass-dome',        name: 'The Glass Dome',      type: 'Settlement',       owner: 'chymist-cult',        settlement: true,  income: 'D6x10 credits', boon: 'Clean water: ignore one Lasting Injury roll',    notes: 'A cracked crystalflex dome over a working still. The Chymists moved in and the water got stranger.' },
  { id: 'the-still-rows',    name: 'The Still Rows',      type: 'Chem Works',       owner: 'chymist-cult',        settlement: false, income: 'D6x10 credits', boon: 'One free chem or toxin weapon upgrade',          notes: 'Condensers in rows the length of a dome. Sola Dosis insists the fumes are therapeutic.' },
  { id: 'relay-theta',       name: 'Relay Station Theta', type: 'Settlement',       owner: 'archeo-3',            settlement: true,  income: 'D6x10 credits', boon: 'Reroll one Intelligence test per battle',        notes: 'The Tech-Acquisitor party staged out of Theta. Their last transmission was a set of coordinates and nothing else.' },
  { id: 'the-brass-gallery', name: 'The Brass Gallery',   type: 'Archeotech Vault', owner: 'archeo-3',            settlement: false, income: 'D6x10 credits', boon: 'Rare trade roll at +1 when buying archeotech',   notes: 'Three hundred metres of sealed brass doors. Team 3 has opened eleven and will not discuss the twelfth.' },
  { id: 'cinder-yard',       name: 'Cinder Yard',         type: 'Mine Workings',    owner: 'bjorn-prospectors',   settlement: false, income: 'D6x10 credits', boon: 'Extra D6x10 credits if held two cycles running', notes: 'Ash heaps that shift without warning. Three gangs are still down there somewhere.' },
  { id: 'grudgehold',        name: 'Grudgehold',          type: 'Settlement',       owner: 'bjorn-prospectors',   settlement: true,  income: 'D6x10 credits', boon: 'Defender deploys one free fortification',        notes: 'Cut into the rock and ledgered to the last slate. Bjorn filed the claim first and has the paperwork to prove it.' },
  { id: 'holestead',         name: 'Holestead',           type: 'Settlement',       owner: 'resource-extraction', settlement: true,  income: 'D6x10 credits', boon: 'Hangers-on cost 20 credits less',                notes: 'Company housing, company store, company arbitration. Resource Extraction filed second and disputes that it matters.' },
  { id: 'scrap-shoals',      name: 'The Scrap Shoals',    type: 'Mine Workings',    owner: 'resource-extraction', settlement: false, income: 'D6x10 credits', boon: 'Sell scrap: +D3x10 credits each Downtime',       notes: 'Quarterly extraction targets are posted at the gate. Somebody has been correcting them in blood.' },
  { id: 'precinct-house-22', name: 'Precinct House 22',   type: 'Settlement',       owner: 'precinct-22',         settlement: true,  income: 'D6x10 credits', boon: 'One free Palanite patrol escort each Downtime',  notes: 'Built to hold two hundred. Currently holds nineteen, a vox relay and a great deal of institutional stubbornness.' },
  { id: 'the-pit-market',    name: 'The Pit Market',      type: 'Trading Post',     owner: 'precinct-22',         settlement: false, income: 'D6x10 credits', boon: 'Rare trade roll at +2',                          notes: 'Neutral ground by long tradition. Precinct 22 enforces that tradition at gunpoint, which everyone agrees is novel.' },
  { id: 'sunken-nave',       name: 'The Sunken Nave',     type: 'Settlement',       owner: 'mycelium',            settlement: true,  income: 'D6x10 credits', boon: 'Reroll one Leadership test per battle',          notes: 'Cawdor built it, something else kept it. Mycelium Section took the crypts and left the nave to the candles.' },
  { id: 'ratgut-tunnels',    name: 'Ratgut Tunnels',      type: 'Tunnels',          owner: 'mycelium',            settlement: false, income: 'D3x10 credits', boon: 'Move freely between territories you hold',        notes: 'Not mapped, not mappable. Mycelium Section claims otherwise and charges for guides.' },

  { id: 'rustfall-row',      name: 'Rustfall Row',        type: 'Old Ruins',        owner: null,                  settlement: false, income: 'D3x10 credits', boon: 'Search the ruins: one free Common item',         notes: 'Collapsed habs stacked nine deep. The footing is a liability and the snipers know it.', contested: true },
  { id: 'coil-gardens',      name: 'The Coil Gardens',    type: 'Promethium Cache', owner: null,                  settlement: false, income: 'D6x10 credits', boon: 'One free flamer-class weapon',                   notes: 'Pipework grown into a thicket. Van Saar say they understand it. They do not.' },
  { id: 'vent-nine',         name: 'Vent Nine',           type: 'Vents',            owner: null,                  settlement: false, income: 'D3x10 credits', boon: 'Infiltrate: one fighter deploys hidden',         notes: 'The up-hive draught comes through here. So does anything that wants in quietly.' },
  { id: 'the-drowned-stair', name: 'The Drowned Stair',   type: 'Sump Sea Edge',    owner: null,                  settlement: false, income: 'D3x10 credits', boon: 'Scavenge: D3 free Common items',                 notes: 'The stairs go down into the sump and keep going. Low tide reveals about forty more steps.' },
  { id: 'the-weeping-wall',  name: 'The Weeping Wall',    type: 'Collapsed Dome',   owner: null,                  settlement: false, income: 'D3x10 credits', boon: 'Defender gains one extra barricade',             notes: 'Groundwater bleeds through the rockcrete in sheets. The sound carries for a kilometre.' },
  { id: 'black-ledger',      name: 'The Black Ledger',    type: 'Gambling Den',     owner: null,                  settlement: false, income: 'D6x10 credits', boon: 'Wager credits before a battle',                  notes: 'Debts here are recorded in a real book. People have died trying to edit it.' },
  { id: 'the-bonepipe',      name: 'The Bonepipe',        type: 'Rogue Doc',        owner: null,                  settlement: false, income: 'D3x10 credits', boon: 'One free medical escort each Downtime',          notes: 'The doc is good. The doc is also why several gangers answer to new names.' },
  { id: 'the-wire-yard',     name: 'The Wire Yard',       type: 'Workshop',         owner: null,                  settlement: false, income: 'D6x10 credits', boon: 'One free weapon upgrade each Downtime',          notes: 'Spools of cable taller than a Goliath. Whoever untangles it first gets rich or gets cut in half.' }
];

const held = outer.filter((t) => t.owner);
const free = outer.filter((t) => !t.owner);

if (outer.length !== 22) throw new Error(`charted section is ${outer.length}, expected 22`);
if (held.length !== 14) throw new Error(`rim is ${held.length} held territories, expected 14`);
if (free.length !== 8) throw new Error(`marches are ${free.length} unclaimed, expected 8`);

/* ---------- build a band ---------- */

function buildBand(items, innerCurve, outerCurve, startDeg, seedBase) {
  const n = items.length;
  const step = (Math.PI * 2) / n;

  /* divider angles wander a little, so territories come out different sizes */
  const angles = items.map((_, i) => startDeg * RAD + i * step + jit(step * 0.16));
  const dividers = angles.map((th, i) => divider(innerCurve, outerCurve, th, seedBase + i * 97));

  return items.map((meta, i) => {
    const a = angles[i];
    const b = angles[(i + 1) % n] + (i === n - 1 ? Math.PI * 2 : 0);

    const dIn = dividers[i];                 // inner -> outer, at angle a
    const dOut = dividers[(i + 1) % n];      // inner -> outer, at angle b

    const poly = dedupe([
      ...arc(innerCurve, a, b),              // along the inner curve, a -> b
      ...dOut.slice(1),                      // out across the band at b
      ...arc(outerCurve, b, a).slice(1),     // back along the outer curve, b -> a
      ...dIn.slice(1).reverse().slice(1)     // back in across the band at a
    ]);

    return { meta, poly, from: a, to: b, prev: (i - 1 + n) % n, next: (i + 1) % n };
  });
}

const rim = buildBand(held, curveMid, curveOut, -90, 1009);
const marches = buildBand(free, curveDeep, curveMid, -90 + 11, 5021);

/* ---------- adjacency ---------- */

const TAU = Math.PI * 2;
const norm = (x) => ((x % TAU) + TAU) % TAU;

/* two bands touch where their angular spans overlap */
const inSpan = (x, a, b) => norm(x - a) < (b - a) - 1e-9;
function spansOverlap(a1, b1, a2, b2) {
  return inSpan(a2, a1, b1) || inSpan(a1, a2, b2);
}

const links = new Map(outer.map((t) => [t.id, new Set()]));
const join = (a, b) => { links.get(a).add(b); links.get(b).add(a); };

for (const band of [rim, marches]) {
  band.forEach((cell, i) => {
    join(cell.meta.id, band[cell.next].meta.id);
    join(cell.meta.id, band[cell.prev].meta.id);
  });
}
for (const r of rim) {
  for (const m of marches) {
    if (spansOverlap(r.from, r.to, m.from, m.to)) join(r.meta.id, m.meta.id);
  }
}

/* ---------- territories ---------- */

const territories = [];

for (const band of [rim, marches]) {
  for (const cell of band) {
    const t = cell.meta;
    const [lx, ly] = centroid(cell.poly);
    territories.push({
      id: t.id,
      name: t.name,
      section: 'outer',
      ring: band === rim ? 'rim' : 'marches',
      type: t.type,
      settlement: t.settlement,
      owner: t.owner,
      income: t.income,
      boon: t.boon,
      contested: !!t.contested,
      bordersInner: band === marches,
      labelX: lx,
      labelY: ly,
      polygon: cell.poly,
      links: [...links.get(t.id)].sort(),
      notes: t.notes
    });
  }
}

const INNER_COUNT = 16;
const MALSTRAIN = new Set(['I-13', 'I-16']);

for (let k = 0; k < INNER_COUNT; k++) {
  const designation = 'I-' + String(k + 1).padStart(2, '0');
  territories.push({
    id: designation.toLowerCase(),
    name: null,
    designation,
    section: 'inner',
    surveyed: false,
    type: null,
    owner: MALSTRAIN.has(designation) ? 'malstrain' : null,
    hidden: MALSTRAIN.has(designation),
    income: null,
    boon: null,
    contested: false,
    polygon: null,
    links: [],
    notes: null
  });
}

/* ---------- curves the page draws directly ---------- */

const fullCurve = (curve) => {
  const pts = [];
  for (let th = 0; th < TAU - 1e-9; th += ARC_STEP) pts.push(at(curve, th));
  return pts;
};

const boundary = fullCurve(curveOut);
const deepPolygon = fullCurve(curveDeep);
const deepCentre = centroid(deepPolygon);

/* ---------- the two known ways in ---------- */

function bearingFrom(ids) {
  let sx = 0, sy = 0;
  for (const id of ids) {
    const t = territories.find((q) => q.id === id);
    if (!t) throw new Error(`gateway references unknown territory "${id}"`);
    sx += t.labelX - deepCentre[0];
    sy += t.labelY - deepCentre[1];
  }
  return Math.atan2(sy, sx);
}

const onDeepBorder = (theta) => at(curveDeep, theta);

const gw1 = onDeepBorder(bearingFrom(['relay-theta']));
const gw2 = onDeepBorder(bearingFrom(['grudgehold', 'holestead']));

const gateways = [
  {
    id: 'theta-breach',
    name: 'The Theta Breach',
    from: ['relay-theta'],
    discoveredBy: 'archeo-3',
    contested: false,
    x: gw1[0], y: gw1[1],
    notes: 'A Tech-Acquisitor party cut through here and went in. Contact was lost on the second day. The coordinates were the last thing anyone sent up.'
  },
  {
    id: 'prospectors-cut',
    name: "The Prospectors' Cut",
    from: ['grudgehold', 'holestead'],
    discoveredBy: 'bjorn-prospectors',
    contested: true,
    x: gw2[0], y: gw2[1],
    notes: 'Found by Ironhead prospectors. Two companies have filed property rights over the shaft, neither claim struck out. Nobody has gone past the first chamber.'
  }
];

/* ---------- gangs ---------- */

const gangs = [
  { id: 'sumptown',            name: 'Sumptown Brawlers',                 short: 'Sumptown',      house: 'House Goliath',      color: '#d2652a' },
  { id: 'chymist-cult',        name: "'Sola Dosis' Chymist Cult",         short: 'Sola Dosis',    house: 'House Escher',       color: '#4fbd72' },
  { id: 'archeo-3',            name: 'Archeo-Acquisitions Team 3',        short: 'Archeo-3',      house: 'House Van Saar',     color: '#35a9c0' },
  { id: 'mycelium',            name: 'Mycelium Section',                  short: 'Mycelium',      house: 'House Delaque',      color: '#a79ddb' },
  { id: 'precinct-22',         name: 'Precinct 22',                       short: 'Precinct 22',   house: 'Palanite Enforcers', color: '#4878d2' },
  { id: 'bjorn-prospectors',   name: 'Bjorn "H.C.L.F" Prospectors Group', short: 'Bjorn H.C.L.F', house: 'Ironhead Squats',    color: '#dfae33' },
  { id: 'resource-extraction', name: 'Resource Extraction LLC',           short: 'Resource Ext.', house: 'Ironhead Squats',    color: '#9bab3c' },
  { id: 'malstrain',           name: 'Malstrain Genestealers',            short: 'Malstrain',     house: 'Malstrain',          color: '#c6529f', hidden: true }
].map((g) => ({ ...g, rating: 1100, credits: 0, reputation: 1, motto: '' }));

/* ---------- emit ---------- */

const xs = boundary.map((p) => p[0]), ys = boundary.map((p) => p[1]);
const pad = 18;
const minX = Math.floor(Math.min(...xs) - pad), minY = Math.floor(Math.min(...ys) - pad);
const maxX = Math.ceil(Math.max(...xs) + pad), maxY = Math.ceil(Math.max(...ys) + pad);

const data = {
  campaign: {
    name: 'The Hollow Reach',
    sector: 'Sector 7-Gamma, Hive Primus',
    edition: 'N26',
    arbitrator: 'Anton',
    cycle: 1,
    phase: 'Occupation',
    lastUpdated: '2026-11-08',
    notice: 'Two ways into the deep section are known. Neither has been walked all the way in.'
  },
  map: {
    viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}`,
    boundary,
    inner: {
      label: 'Uncharted Deep',
      blurb: 'Sealed until a Tech-Acquisitor party cut their way in and stopped transmitting. Only the border is mapped; what lies inside gets surveyed as gangs push into it.',
      polygon: deepPolygon,
      labelX: deepCentre[0],
      labelY: deepCentre[1]
    }
  },
  gangs,
  gateways,
  territories,
  battles: []
};

writeFileSync('data/campaign.json', JSON.stringify(data, null, 2) + '\n');

const marchesIds = new Set(marches.map((m) => m.meta.id));
const breaches = territories.filter((t) => t.bordersInner && t.owner);
const crossBand = rim.reduce((n, r) =>
  n + [...links.get(r.meta.id)].filter((id) => marchesIds.has(id)).length, 0);

console.log(`rim      ${rim.length} held (${held.filter((t) => t.settlement).length} settlements)`);
console.log(`marches  ${marches.length} unclaimed, all bordering the deep`);
console.log(`deep     ${INNER_COUNT} holdings unsurveyed (${[...MALSTRAIN].length} hidden)`);
console.log(`buffer   ${breaches.length ? 'BREACHED by ' + breaches.map((t) => t.name).join(', ') : 'intact — no held territory touches the deep'}`);
console.log(`borders  ${[...links.values()].reduce((n, s) => n + s.size, 0) / 2} shared (${crossBand} rim-to-marches)`);
