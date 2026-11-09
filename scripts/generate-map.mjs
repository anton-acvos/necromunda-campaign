/* One-off generator for the two-section sector map.
   Builds a Voronoi tessellation so territories read as countries sharing
   borders, not nodes on a graph. Emits data/campaign.json. */
import { writeFileSync } from 'node:fs';

/* Seeds sit on three rings, outside in: the held rim, the unclaimed marches,
   and the deep. Voronoi then lets the bands interpenetrate — a rim territory
   whose seed sits deep enough reaches the uncharted border, while its
   neighbour does not. That unevenness is the point: clean concentric bands
   read as a diagram, ragged ones read as ground. */
const CX = 820, CY = 720;
const BOUND_RX = 740, BOUND_RY = 560;   // sector outline
const HELD_RX = 600, HELD_RY = 450;     // rim seeds: held territories
const FREE_RX = 430, FREE_RY = 322;     // marches seeds: unclaimed territories
const INA_RX = 250, INA_RY = 188;       // deep seeds, ring A
const INB_RX = 100, INB_RY = 75;        // deep seeds, ring B

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

/* ---------- sector outline: an irregular but convex closed ring ---------- */

const boundary = [];
for (let i = 0; i < 64; i++) {
  const a = (i / 64) * Math.PI * 2;
  const f = 1
    + Math.sin(a * 2 + 1.3) * 0.055
    + Math.sin(a * 3 + 0.7) * 0.042
    + Math.sin(a * 5 + 2.1) * 0.026
    + Math.sin(a * 7 + 4.3) * 0.015;
  boundary.push([r2(CX + Math.cos(a) * BOUND_RX * f), r2(CY + Math.sin(a) * BOUND_RY * f)]);
}

/* ---------- polygon helpers ---------- */

function clipHalfPlane(poly, si, sj) {
  /* keep points at least as close to si as to sj */
  const mx = (si[0] + sj[0]) / 2, my = (si[1] + sj[1]) / 2;
  const nx = sj[0] - si[0], ny = sj[1] - si[1];
  const side = (p) => (p[0] - mx) * nx + (p[1] - my) * ny;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = side(a), db = side(b);
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function dedupe(poly) {
  const out = [];
  for (const p of poly) {
    const q = [r2(p[0]), r2(p[1])];
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - q[0]) > 0.01 || Math.abs(last[1] - q[1]) > 0.01) out.push(q);
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

const ptKey = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
const edgeKey = (a, b) => {
  const ka = ptKey(a), kb = ptKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

/* ---------- the outer section: 22 holdings in ring order ---------- */

const outer = [
  { id: 'sumptown',          name: 'Sumptown',            type: 'Settlement',       owner: 'sumptown',            settlement: true,  income: 'D6x10 credits', boon: 'Recruit one Juve free each Downtime',            notes: 'Barge wharves and a century of silt. Everything coming down from above lands here first.' },
  { id: 'the-chokestack',    name: 'The Chokestack',      type: 'Slag Furnace',     owner: 'sumptown',            settlement: false, income: 'D6x10 credits', boon: 'Free Brute hire this cycle',                     notes: 'The furnace still runs. Nobody admits to lighting it and nobody dares let it go out.' },
  { id: 'rustfall-row',      name: 'Rustfall Row',        type: 'Old Ruins',        owner: null,                  settlement: false, income: 'D3x10 credits', boon: 'Search the ruins: one free Common item',         notes: 'Collapsed habs stacked nine deep. The footing is a liability and the snipers know it.', contested: true },
  { id: 'glass-dome',        name: 'The Glass Dome',      type: 'Settlement',       owner: 'chymist-cult',        settlement: true,  income: 'D6x10 credits', boon: 'Clean water: ignore one Lasting Injury roll',    notes: 'A cracked crystalflex dome over a working still. The Chymists moved in and the water got stranger.' },
  { id: 'the-still-rows',    name: 'The Still Rows',      type: 'Chem Works',       owner: 'chymist-cult',        settlement: false, income: 'D6x10 credits', boon: 'One free chem or toxin weapon upgrade',          notes: 'Condensers in rows the length of a dome. Sola Dosis insists the fumes are therapeutic.' },
  { id: 'coil-gardens',      name: 'The Coil Gardens',    type: 'Promethium Cache', owner: null,                  settlement: false, income: 'D6x10 credits', boon: 'One free flamer-class weapon',                   notes: 'Pipework grown into a thicket. Van Saar say they understand it. They do not.' },
  { id: 'relay-theta',       name: 'Relay Station Theta', type: 'Settlement',       owner: 'archeo-3',            settlement: true,  income: 'D6x10 credits', boon: 'Reroll one Intelligence test per battle',        notes: 'The Tech-Acquisitor party staged out of Theta. Their last transmission was a set of coordinates and nothing else.' },
  { id: 'the-brass-gallery', name: 'The Brass Gallery',   type: 'Archeotech Vault', owner: 'archeo-3',            settlement: false, income: 'D6x10 credits', boon: 'Rare trade roll at +1 when buying archeotech',   notes: 'Three hundred metres of sealed brass doors. Team 3 has opened eleven and will not discuss the twelfth.' },
  { id: 'vent-nine',         name: 'Vent Nine',           type: 'Vents',            owner: null,                  settlement: false, income: 'D3x10 credits', boon: 'Infiltrate: one fighter deploys hidden',         notes: 'The up-hive draught comes through here. So does anything that wants in quietly.' },
  { id: 'cinder-yard',       name: 'Cinder Yard',         type: 'Mine Workings',    owner: 'bjorn-prospectors',   settlement: false, income: 'D6x10 credits', boon: 'Extra D6x10 credits if held two cycles running', notes: 'Ash heaps that shift without warning. Three gangs are still down there somewhere.' },
  { id: 'grudgehold',        name: 'Grudgehold',          type: 'Settlement',       owner: 'bjorn-prospectors',   settlement: true,  income: 'D6x10 credits', boon: 'Defender deploys one free fortification',        notes: 'Cut into the rock and ledgered to the last slate. Bjorn filed the claim first and has the paperwork to prove it.' },
  { id: 'holestead',         name: 'Holestead',           type: 'Settlement',       owner: 'resource-extraction', settlement: true,  income: 'D6x10 credits', boon: 'Hangers-on cost 20 credits less',                notes: 'Company housing, company store, company arbitration. Resource Extraction filed second and disputes that it matters.' },
  { id: 'scrap-shoals',      name: 'The Scrap Shoals',    type: 'Mine Workings',    owner: 'resource-extraction', settlement: false, income: 'D6x10 credits', boon: 'Sell scrap: +D3x10 credits each Downtime',       notes: 'Quarterly extraction targets are posted at the gate. Somebody has been correcting them in blood.' },
  { id: 'the-drowned-stair', name: 'The Drowned Stair',   type: 'Sump Sea Edge',    owner: null,                  settlement: false, income: 'D3x10 credits', boon: 'Scavenge: D3 free Common items',                 notes: 'The stairs go down into the sump and keep going. Low tide reveals about forty more steps.' },
  { id: 'the-weeping-wall',  name: 'The Weeping Wall',    type: 'Collapsed Dome',   owner: null,                  settlement: false, income: 'D3x10 credits', boon: 'Defender gains one extra barricade',             notes: 'Groundwater bleeds through the rockcrete in sheets. The sound carries for a kilometre.' },
  { id: 'precinct-house-22', name: 'Precinct House 22',   type: 'Settlement',       owner: 'precinct-22',         settlement: true,  income: 'D6x10 credits', boon: 'One free Palanite patrol escort each Downtime',  notes: 'Built to hold two hundred. Currently holds nineteen, a vox relay and a great deal of institutional stubbornness.' },
  { id: 'the-pit-market',    name: 'The Pit Market',      type: 'Trading Post',     owner: 'precinct-22',         settlement: false, income: 'D6x10 credits', boon: 'Rare trade roll at +2',                          notes: 'Neutral ground by long tradition. Precinct 22 enforces that tradition at gunpoint, which everyone agrees is novel.' },
  { id: 'black-ledger',      name: 'The Black Ledger',    type: 'Gambling Den',     owner: null,                  settlement: false, income: 'D6x10 credits', boon: 'Wager credits before a battle',                  notes: 'Debts here are recorded in a real book. People have died trying to edit it.' },
  { id: 'sunken-nave',       name: 'The Sunken Nave',     type: 'Settlement',       owner: 'mycelium',            settlement: true,  income: 'D6x10 credits', boon: 'Reroll one Leadership test per battle',          notes: 'Cawdor built it, something else kept it. Mycelium Section took the crypts and left the nave to the candles.' },
  { id: 'ratgut-tunnels',    name: 'Ratgut Tunnels',      type: 'Tunnels',          owner: 'mycelium',            settlement: false, income: 'D3x10 credits', boon: 'Move freely between territories you hold',        notes: 'Not mapped, not mappable. Mycelium Section claims otherwise and charges for guides.' },
  { id: 'the-bonepipe',      name: 'The Bonepipe',        type: 'Rogue Doc',        owner: null,                  settlement: false, income: 'D3x10 credits', boon: 'One free medical escort each Downtime',          notes: 'The doc is good. The doc is also why several gangers answer to new names.' },
  { id: 'the-wire-yard',     name: 'The Wire Yard',       type: 'Workshop',         owner: null,                  settlement: false, income: 'D6x10 credits', boon: 'One free weapon upgrade each Downtime',          notes: 'Spools of cable taller than a Goliath. Whoever untangles it first gets rich or gets cut in half.' }
];

const held = outer.filter((t) => t.owner);
const free = outer.filter((t) => !t.owner);

if (outer.length !== 22) throw new Error(`charted section is ${outer.length}, expected 22`);
if (held.length !== 14) throw new Error(`rim is ${held.length} held, expected 14`);
if (free.length !== 8) throw new Error(`marches are ${free.length} unclaimed, expected 8`);

const RAD = Math.PI / 180;
const heldAngle = (i) => (-90 + i * (360 / held.length)) * RAD;
const freeAngle = (i) => (-90 + 11 + i * (360 / free.length)) * RAD;

/* ---------- seeds ---------- */

const seeds = [];   // { kind: 'outer'|'inner', idx }

/* Angles and radii both wander, so the ring reads as geography rather than
   as a pie chart: territories come out different sizes and the band
   thickness varies the whole way round. */
/* Rim angles barely wander, so a settlement keeps its second holding
   alongside it; radii wander a lot, which is what makes some territories
   bulge inward to the deep and others fall short. */
held.forEach((t, i) => {
  const a = heldAngle(i) + jit(4.5 * RAD);
  seeds.push({
    kind: 'outer', ring: 'rim', idx: i, meta: t,
    p: [CX + Math.cos(a) * (HELD_RX + jit(46)), CY + Math.sin(a) * (HELD_RY + jit(38))]
  });
});

free.forEach((t, i) => {
  const a = freeAngle(i) + jit(7 * RAD);
  seeds.push({
    kind: 'outer', ring: 'marches', idx: i, meta: t,
    p: [CX + Math.cos(a) * (FREE_RX + jit(34)), CY + Math.sin(a) * (FREE_RY + jit(26))]
  });
});

const INNER_COUNT = 16;
const RING_A = 11;
const MALSTRAIN = new Set(['I-13', 'I-16']);

/* The deep sits off-centre and its border is lumpy — nobody surveyed it,
   so there is no reason for it to be a tidy circle. */
const DEEP_DX = -34, DEEP_DY = 26;

for (let k = 0; k < INNER_COUNT; k++) {
  let a, rx, ry;
  if (k < RING_A) {
    a = (-90 + 14 + k * (360 / RING_A)) * RAD + jit(8 * RAD);
    rx = INA_RX + jit(42); ry = INA_RY + jit(32);
  } else {
    const j = k - RING_A;
    a = (-90 + 40 + j * (360 / (INNER_COUNT - RING_A))) * RAD + jit(10 * RAD);
    rx = INB_RX + jit(24); ry = INB_RY + jit(18);
  }
  seeds.push({
    kind: 'inner', idx: k,
    designation: 'I-' + String(k + 1).padStart(2, '0'),
    p: [CX + DEEP_DX + Math.cos(a) * rx, CY + DEEP_DY + Math.sin(a) * ry]
  });
}

/* ---------- Voronoi over every seed, clipped to the sector outline ---------- */

for (const s of seeds) {
  let cell = boundary.map((p) => [p[0], p[1]]);
  for (const o of seeds) {
    if (o === s) continue;
    cell = clipHalfPlane(cell, s.p, o.p);
    if (cell.length < 3) break;
  }
  s.cell = dedupe(cell);
  if (s.cell.length < 3) throw new Error(`degenerate cell for ${s.designation ?? s.meta.id}`);
}

/* ---------- union outline of the inner cells: edges used only once ---------- */

const innerSeeds = seeds.filter((s) => s.kind === 'inner');
const useCount = new Map();
const segments = new Map();
for (const s of innerSeeds) {
  for (let i = 0; i < s.cell.length; i++) {
    const a = s.cell[i], b = s.cell[(i + 1) % s.cell.length];
    const k = edgeKey(a, b);
    useCount.set(k, (useCount.get(k) ?? 0) + 1);
    if (!segments.has(k)) segments.set(k, [a, b]);
  }
}
const border = [...useCount.entries()].filter(([, n]) => n === 1).map(([k]) => segments.get(k));

/* chain the border segments into one closed loop */
const fromPoint = new Map();
for (const [a, b] of border) {
  if (!fromPoint.has(ptKey(a))) fromPoint.set(ptKey(a), []);
  if (!fromPoint.has(ptKey(b))) fromPoint.set(ptKey(b), []);
  fromPoint.get(ptKey(a)).push(b);
  fromPoint.get(ptKey(b)).push(a);
}
const innerPolygon = [];
{
  const start = border[0][0];
  let cur = start, prev = null;
  const guard = border.length + 4;
  for (let n = 0; n < guard; n++) {
    innerPolygon.push(cur);
    const opts = (fromPoint.get(ptKey(cur)) ?? []).filter((q) => !prev || ptKey(q) !== ptKey(prev));
    if (!opts.length) break;
    prev = cur;
    cur = opts[0];
    if (ptKey(cur) === ptKey(start)) break;
  }
}
if (innerPolygon.length !== border.length) {
  throw new Error(`inner outline did not close: walked ${innerPolygon.length} of ${border.length} edges`);
}

/* ---------- outer territories ---------- */

const innerEdgeKeys = new Set(border.map(([a, b]) => edgeKey(a, b)));
const outerSeeds = seeds.filter((s) => s.kind === 'outer');

/* Every cell is charted ground now, deep ones included, so adjacency runs
   across the whole sector rather than just the outer section. */
const cellId = (s) => (s.kind === 'outer' ? s.meta.id : s.designation.toLowerCase());

const edgeSets = new Map();
for (const s of seeds) {
  const keys = new Set();
  for (let i = 0; i < s.cell.length; i++) {
    keys.add(edgeKey(s.cell[i], s.cell[(i + 1) % s.cell.length]));
  }
  edgeSets.set(s, keys);
}

const adjacency = new Map(seeds.map((s) => [cellId(s), new Set()]));
for (const s of seeds) {
  const mine = edgeSets.get(s);
  for (const o of seeds) {
    if (o === s) continue;
    for (const k of edgeSets.get(o)) {
      if (mine.has(k)) { adjacency.get(cellId(s)).add(cellId(o)); break; }
    }
  }
}

const territories = outerSeeds.map((s) => {
  const t = s.meta;
  const bordersInner = s.cell.some((_, i) =>
    innerEdgeKeys.has(edgeKey(s.cell[i], s.cell[(i + 1) % s.cell.length])));
  const [lx, ly] = centroid(s.cell);
  return {
    id: t.id,
    name: t.name,
    section: 'outer',
    ring: s.ring,
    type: t.type,
    settlement: t.settlement,
    owner: t.owner,
    income: t.income,
    boon: t.boon,
    contested: !!t.contested,
    bordersInner,
    labelX: lx,
    labelY: ly,
    polygon: s.cell,
    links: [...adjacency.get(t.id)].sort(),
    notes: t.notes
  };
});

/* The deep is now divided into its sixteen holdings: the ground is drawn,
   but nothing is known about any of it. `surveyed` flips to true once a
   holding has a name and a type, not when it gains a shape. */
for (const s of innerSeeds) {
  const id = s.designation.toLowerCase();
  const [lx, ly] = centroid(s.cell);
  territories.push({
    id,
    name: null,
    designation: s.designation,
    section: 'inner',
    surveyed: false,
    type: null,
    owner: MALSTRAIN.has(s.designation) ? 'malstrain' : null,
    hidden: MALSTRAIN.has(s.designation),
    income: null,
    boon: null,
    contested: false,
    labelX: lx,
    labelY: ly,
    polygon: s.cell,
    links: [...adjacency.get(id)].sort(),
    notes: null
  });
}

/* ---------- the two known ways in, placed on the inner border ---------- */

const deepCentre = centroid(innerPolygon);

function pointOnInnerBorderAt(angle) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let best = null, bestDot = -Infinity;
  for (const p of innerPolygon) {
    const vx = p[0] - deepCentre[0], vy = p[1] - deepCentre[1];
    const len = Math.hypot(vx, vy) || 1;
    const dot = (vx / len) * dx + (vy / len) * dy;
    if (dot > bestDot) { bestDot = dot; best = p; }
  }
  return best;
}

function bearingFrom(ids) {
  let sx = 0, sy = 0;
  for (const id of ids) {
    const q = seeds.find((z) => z.kind === "outer" && z.meta.id === id);
    if (!q) throw new Error(`gateway references unknown territory "${id}"`);
    sx += q.p[0] - deepCentre[0];
    sy += q.p[1] - deepCentre[1];
  }
  return Math.atan2(sy, sx);
}

const gw1 = pointOnInnerBorderAt(bearingFrom(["relay-theta"]));
const gw2 = pointOnInnerBorderAt(bearingFrom(["grudgehold", "holestead"]));

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
    viewBox: (() => {
      const xs = boundary.map((p) => p[0]), ys = boundary.map((p) => p[1]);
      const pad = 18;
      const minX = Math.floor(Math.min(...xs) - pad), minY = Math.floor(Math.min(...ys) - pad);
      const maxX = Math.ceil(Math.max(...xs) + pad), maxY = Math.ceil(Math.max(...ys) + pad);
      return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
    })(),
    boundary,
    inner: {
      label: 'Uncharted Deep',
      blurb: 'Sealed until a Tech-Acquisitor party cut their way in and stopped transmitting. Only the border is mapped; what lies inside gets surveyed as gangs push into it.',
      polygon: innerPolygon,
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

const o = territories.filter((t) => t.section === 'outer');
console.log(`outer ${o.length}: ${o.filter(t => t.owner).length} held, ${o.filter(t => !t.owner).length} unclaimed, ${o.filter(t => t.settlement).length} settlements`);
console.log(`inner ${territories.filter(t => t.section === 'inner').length}: ${territories.filter(t => t.section === 'inner' && t.owner).length} malstrain (hidden), rest unclaimed`);
console.log(`inner border: ${innerPolygon.length} vertices; outer cells touching it: ${o.filter(t => t.bordersInner).length}`);
const reach = territories.filter((t) => t.bordersInner && t.owner);
console.log(`reach    ${reach.length} held territories touch the deep: ${reach.map((t) => t.name).join(", ") || "none"}`);
console.log(`borders  ${territories.reduce((n, t) => n + t.links.length, 0) / 2} shared across the whole sector`);
