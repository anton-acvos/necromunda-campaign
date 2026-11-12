/* One-off generator for the two-section sector map.
   Builds a weighted Voronoi (power) tessellation so territories read as
   countries sharing borders, not nodes on a graph, and so every tile comes
   out about the same size. Emits data/campaign.json. */
import { writeFileSync } from 'node:fs';

/* The charted section is one band: all twenty-two holdings, held and
   unclaimed alike, sit on a single ring around the deep. Tile sizes are
   levelled by the relaxation further down, so no territory reads as more
   important than another just because of where its seed landed. */
const CX = 820, CY = 720;
const BOUND_RX = 740, BOUND_RY = 560;   // sector outline

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

/* ---------- sector outline: a district, not an oval ----------

   The outline is the intersection of sixteen half-planes whose normals sit on
   sixteenths of a turn. Every wall therefore runs on one of sixteen bearings
   and the perimeter comes out as long straight runs meeting at blunt corners,
   which reads as a district boundary rather than a circle. Some half-planes
   are pushed out of reach, so their neighbours merge into one long wall and
   the sector loses its even, rounded sides. */

const WALLS = Number(process.env.WALLS ?? 10);
const WALL_PHASE = 0.21;      // rotate the whole set off the axes
const WALL_SLACK = Number(process.env.WALL_SLACK ?? 0.24);     // how much a wall may sit in or out
const WALL_DROP = Number(process.env.WALL_DROP ?? 0.14);       // chance a wall is pushed out of reach entirely

function clipLine(poly, nx, ny, h) {
  /* keep the side where p . n <= h */
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = a[0] * nx + a[1] * ny - h, db = b[0] * nx + b[1] * ny - h;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

let hull = [[CX - 3000, CY - 3000], [CX + 3000, CY - 3000], [CX + 3000, CY + 3000], [CX - 3000, CY + 3000]];
for (let i = 0; i < WALLS; i++) {
  const a = (i / WALLS) * Math.PI * 2 + WALL_PHASE;
  const nx = Math.cos(a), ny = Math.sin(a);
  const support = Math.hypot(BOUND_RX * nx, BOUND_RY * ny);
  const gain = 1 / Math.cos(Math.PI / WALLS);   // keep the area the corners would cost
  const f = rnd() < WALL_DROP ? 1.9 : gain * (1 - WALL_SLACK + rnd() * WALL_SLACK * 1.6);
  hull = clipLine(hull, nx, ny, CX * nx + CY * ny + support * f);
}
const boundary = dedupe(hull);

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
  { id: 'sumptown',           name: 'Sumptown',               type: 'Settlement',            owner: 'sumptown',             settlement: true,   income: 15, boon: 'Or recruit a ganger at a 25 credit discount', notes: 'Barge wharves and a century of silt. Everything coming down from above lands here first.' },
  { id: 'the-brood-vats',     name: 'The Brood Vats',         type: 'Amneo-vats',            owner: 'sumptown',             settlement: false,  income: 25, standing: 'Goliath hold it, so it pays 25 a cycle instead of the 15 it would pay anyone else', notes: 'Amneotic tanks in rows under the sump, lidded and bubbling. Sumptown grows its own, and the ones that come out wrong go back in.' },
  { id: 'rustfall-row',       name: 'Rustfall Row',           type: 'Mess Shack',            owner: null,                   settlement: false,  income: 15, boon: 'Or recruit a Slopper at a 30 credit discount, if you have none', notes: 'Collapsed habs stacked nine deep with one kitchen still lit at the bottom. The queue forms before the shift horn and nobody skips it.' },
  { id: 'precinct-house-22',  name: 'Precinct House 22',      type: 'Settlement',            owner: 'precinct-22',          settlement: true,   income: 15, boon: 'Or recruit a ganger at a 25 credit discount', notes: 'Built to hold two hundred. Currently holds nineteen, a vox relay and a great deal of institutional stubbornness.' },
  { id: 'the-pit-market',     name: 'The Pit Market',         type: 'Mine Workings',         owner: 'precinct-22',          settlement: false,  income: 20, boon: 'Or take two respirators', notes: 'A worked-out pit the Enforcers reopened and now run themselves. The market that gave it its name trades on the spoil heap at the top.' },
  { id: 'coil-gardens',       name: 'The Coil Gardens',       type: 'Fence Hangout',         owner: null,                   settlement: false,  income: 15, boon: 'Or recruit a Dome Runner at a 30 credit discount, if you have none', notes: 'Pipework grown into a thicket, and a dozen quiet doors inside it. Whatever leaves the sector by the back way goes through here first.' },
  { id: 'reclaimers-breach',  name: "Reclaimers' Breach",     type: 'Settlement',            owner: 'archeo-3',             settlement: true,   income: 15, boon: 'Or recruit a ganger at a 25 credit discount', notes: 'Team 3 cut their way in here and named it for the work. The Tech-Acquisitor party staged out of this hold; their last transmission was a set of coordinates and nothing else.' },
  { id: 'generatorium',       name: 'The Generatorium',       type: 'Generatorium',          owner: 'archeo-3',             settlement: false,  income: 15, standing: '+1 Reputation', notes: 'Plasma conduits that have not gone cold in ten thousand years. Team 3 metered the output before they posted a single guard.' },
  { id: 'cog-market',         name: 'The Cog Market',         type: 'Tech Bazaar',           owner: null,                   settlement: false,  income: 15, notes: 'The up-hive draught comes down the old vent and keeps the stalls cool. Half the tech on the tables was still working when somebody pulled it out.' },
  { id: 'cinder-yard',        name: 'Cinder Yard',            type: 'Mine Workings',         owner: 'bjorn-prospectors',    settlement: false,  income: 20, boon: 'Or take two respirators', notes: 'Ash heaps that shift without warning. Three gangs are still down there somewhere.' },
  { id: 'grudgehold',         name: 'Grudgehold',             type: 'Settlement',            owner: 'bjorn-prospectors',    settlement: true,   income: 15, boon: 'Or recruit a ganger at a 25 credit discount', notes: 'Cut into the rock and ledgered to the last slate. Bjorn filed the claim first and has the paperwork to prove it.' },
  { id: 'holestead',          name: 'Holestead',              type: 'Settlement',            owner: 'resource-extraction',  settlement: true,   income: 15, boon: 'Or recruit a ganger at a 25 credit discount', notes: 'Company housing, company store, company arbitration. Resource Extraction filed second and disputes that it matters.' },
  { id: 'scrap-shoals',       name: 'The Scrap Shoals',       type: 'Mine Workings',         owner: 'resource-extraction',  settlement: false,  income: 20, boon: 'Or take two respirators', notes: 'Quarterly extraction targets are posted at the gate. Somebody has been correcting them in blood.' },
  { id: 'brass-stair',        name: 'The Brass Stair',        type: 'Bullet Den',            owner: null,                   settlement: false,  income: 15, boon: 'Or recruit an Ammo-Jack at a 30 credit discount, if you have none', notes: 'The steps go down into the sump and keep going. Somebody has been stacking crates on the dry landings for a very long time.' },
  { id: 'weeping-still',      name: 'The Weeping Still',      type: 'Synth Still',           owner: null,                   settlement: false,  income: 20, notes: 'Groundwater bleeds through the rockcrete in sheets and the condensers underneath catch every drop. What comes out the other end is sold as medicine.' },
  { id: 'quarantines-end',    name: "Quarantine's End",       type: 'Settlement',            owner: 'chymist-cult',         settlement: true,   income: 15, boon: 'Or recruit a ganger at a 25 credit discount', notes: 'A cracked crystalflex dome, sealed off for something nobody will name and unsealed by the Chymists, who insist the air is clean now.' },
  { id: 'the-still-rows',     name: 'The Still Rows',         type: 'Rogue Las Factoria',    owner: 'chymist-cult',         settlement: false,  income: 20, boon: 'Escher only: instead of the income, add two lasguns to the stash for free', effect: 'Faulty Machinery: at the start of each end phase, randomly select a fighter from each gang. If that fighter is active, they become suppressed.', notes: 'Condensers in rows the length of a dome, half of them re-tooled to stamp power cells. Sola Dosis insists the fumes are therapeutic and the lasguns are legal.' },
  { id: 'black-ledger',       name: 'The Black Ledger',       type: 'Gambling Den',          owner: null,                   settlement: false,  income: 15, standing: '+1 Reputation', notes: 'Debts here are recorded in a real book. People have died trying to edit it.' },
  { id: 'sunken-nave',        name: 'The Sunken Nave',        type: 'Settlement',            owner: 'mycelium',             settlement: true,   income: 15, boon: 'Or recruit a ganger at a 25 credit discount', notes: 'Cawdor built it, something else kept it. Mycelium Section took the crypts and left the nave to the candles.' },
  { id: 'ratgut-tunnels',    name: 'Ratgut Tunnels',         type: 'Bounty Den',            owner: 'mycelium',             settlement: false,  income: 25, notes: 'Not mapped, not mappable. Mycelium Section charges for guides and keeps a second ledger of who is worth money to somebody up-hive.' },
  { id: 'the-bonepipe',       name: 'The Bonepipe',           type: 'Rogue Doc Shop',        owner: null,                   settlement: false,  income: 15, boon: 'Or recruit a Rogue Doc at a 30 credit discount, if you have none', notes: 'The doc is good. The doc is also why several gangers answer to new names.' },
  { id: 'harvest-yard',       name: 'The Harvest Yard',       type: 'Corpse Farm',           owner: null,                   settlement: false,  income: 25, notes: 'Spools of cable taller than a Goliath, and the vats behind them. The yard takes what the Underhive has finished with and sends it up-hive as protein.' },
];

const held = outer.filter((t) => t.owner);
const free = outer.filter((t) => !t.owner);

if (outer.length !== 22) throw new Error(`charted section is ${outer.length}, expected 22`);
if (held.length !== 14) throw new Error(`charted section is ${held.length} held, expected 14`);
if (free.length !== 8) throw new Error(`charted section is ${free.length} unclaimed, expected 8`);

const RAD = Math.PI / 180;

/* ---------- seeds ---------- */

const seeds = [];   // { kind: 'outer'|'inner', idx }

/* One layer. All twenty-two charted holdings sit on a single ring in the
   order they are listed, so a settlement keeps its second holding alongside
   it and the unclaimed ground falls between gangs rather than behind them.
   Angles are near-even and radii barely wander: the relaxation below is what
   decides the final shapes, and it is working towards equal area. */
/* Seeds sit on scaled copies of the sector wall, spaced by distance along
   that wall rather than by angle. A district with a long flat side is wider
   there than a circle would be, and spacing by angle would bunch tiles up
   against it; spacing by arc length keeps every tile the same width. */
function scaledWall(f, dx = 0, dy = 0) {
  return boundary.map((p) => [CX + dx + (p[0] - CX) * f, CY + dy + (p[1] - CY) * f]);
}

function spaceAlong(poly, n, startFrac) {
  const segs = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    return { a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]) };
  });
  const total = segs.reduce((t, s) => t + s.len, 0);
  const pts = [];
  for (let k = 0; k < n; k++) {
    let d = ((startFrac + k / n) % 1) * total;
    for (const s of segs) {
      if (d <= s.len) {
        const t = s.len ? d / s.len : 0;
        pts.push([s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t]);
        break;
      }
      d -= s.len;
    }
  }
  return pts;
}

const OUT_F = 0.795;                 // charted ring, as a fraction of the way to the wall
const INA_F = 0.50, INB_F = 0.21;    // the deep, outer and inner
const DEEP_DX = -12, DEEP_DY = 8;    // the deep sits a little off-centre
const INNER_COUNT = 18;   /* two unclaimed per player, plus the two Malstrain holdings */
const RING_A = 12;
const MALSTRAIN = new Set(['I-14', 'I-17']);

const jitPt = (p, amp) => [p[0] + jit(amp), p[1] + jit(amp)];

spaceAlong(scaledWall(OUT_F), outer.length, 0.30).forEach((p, i) => {
  seeds.push({ kind: 'outer', ring: 'ring', idx: i, meta: outer[i], f: OUT_F, p: jitPt(p, 16) });
});

const ringA = spaceAlong(scaledWall(INA_F, DEEP_DX, DEEP_DY), RING_A, 0.33);
const ringB = spaceAlong(scaledWall(INB_F, DEEP_DX, DEEP_DY), INNER_COUNT - RING_A, 0.12);
[...ringA, ...ringB].forEach((p, k) => {
  seeds.push({
    kind: 'inner', idx: k, f: k < RING_A ? INA_F : INB_F,
    designation: 'I-' + String(k + 1).padStart(2, '0'),
    p: jitPt(p, k < RING_A ? 15 : 12)
  });
});

/* ---------- power diagram, relaxed towards equal area ----------

   A plain Voronoi makes tiles whose size depends on how the seeds happened to
   land. Here each seed carries a weight, which slides its borders without
   moving the seed, and the weights are nudged every pass until every tile is
   close to its share of the sector. Shapes stay irregular; only the areas are
   levelled, and each tile gets its own target within a few per cent so the
   result is even rather than uniform. */

const RELAX_STEPS = Number(process.env.RELAX_STEPS ?? 90);
const AREA_SPREAD = Number(process.env.AREA_SPREAD ?? 0.09);   // per-tile target wobble
const LLOYD = Number(process.env.LLOYD ?? 0.3);                // how far a seed chases its centroid
const BAND_GIVE = Number(process.env.BAND_GIVE ?? 0.1);        // how far it may leave its band

function wallAt(angle, ox, oy) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let best = Infinity;
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i], b = boundary[(i + 1) % boundary.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - ox) * ey - (a[1] - oy) * ex) / den;
    const u = ((a[0] - ox) * dy - (a[1] - oy) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  return best === Infinity ? 1 : best;
}                // how far a seed chases its centroid

function clipPower(poly, si, wi, sj, wj) {
  const nx = sj[0] - si[0], ny = sj[1] - si[1];
  const c = ((sj[0] * sj[0] + sj[1] * sj[1] - wj) - (si[0] * si[0] + si[1] * si[1] - wi)) / 2;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = a[0] * nx + a[1] * ny - c, db = b[0] * nx + b[1] * ny - c;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

const polyArea = (poly) => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
};

function buildCells() {
  for (const s of seeds) {
    let cell = boundary.map((p) => [p[0], p[1]]);
    for (const o of seeds) {
      if (o === s) continue;
      cell = clipPower(cell, s.p, s.w, o.p, o.w);
      if (cell.length < 3) break;
    }
    s.raw = cell.length < 3 ? [] : cell;
  }
}

const sectorArea = polyArea(boundary);
for (const s of seeds) {
  s.w = 0;
  s.share = 1 + jit(AREA_SPREAD);
}
const shareSum = seeds.reduce((t, s) => t + s.share, 0);
for (const s of seeds) s.target = (sectorArea * s.share) / shareSum;

for (let step = 0; step < RELAX_STEPS; step++) {
  buildCells();
  const gain = 1.1 * (1 - step / (RELAX_STEPS * 1.6));
  for (const s of seeds) {
    const area = s.raw.length ? polyArea(s.raw) : 0;
    s.w += gain * (s.target - area);
    if (s.raw.length && LLOYD > 0) {
      const c = centroid(s.raw);
      let x = s.p[0] + (c[0] - s.p[0]) * LLOYD, y = s.p[1] + (c[1] - s.p[1]) * LLOYD;
      /* a seed may slide round its band but not wander out of it, or the
         charted ring stops being a ring */
      const ox = s.kind === 'inner' ? CX + DEEP_DX : CX;
      const oy = s.kind === 'inner' ? CY + DEEP_DY : CY;
      const a = Math.atan2(y - oy, x - ox);
      const wall = wallAt(a, ox, oy);
      const fr = Math.hypot(x - ox, y - oy) / wall;
      const lo = s.f * (1 - BAND_GIVE), hi = s.f * (1 + BAND_GIVE);
      const cl = Math.min(hi, Math.max(lo, fr));
      if (cl !== fr) { x = ox + Math.cos(a) * wall * cl; y = oy + Math.sin(a) * wall * cl; }
      s.p = [x, y];
    }
  }
  /* weights only matter relative to one another; keep them centred */
  const mean = seeds.reduce((t, s) => t + s.w, 0) / seeds.length;
  for (const s of seeds) s.w -= mean;
}

buildCells();
for (const s of seeds) {
  s.cell = dedupe(s.raw);
  if (s.cell.length < 3) throw new Error(`degenerate cell for ${s.designation ?? s.meta.id}`);
}

{
  const areas = seeds.map((s) => polyArea(s.cell));
  const mean = areas.reduce((a, b) => a + b, 0) / areas.length;
  const dev = Math.sqrt(areas.reduce((t, a) => t + (a - mean) ** 2, 0) / areas.length) / mean;
  const lo = Math.min(...areas) / mean, hi = Math.max(...areas) / mean;
  console.log(`tiles    ${areas.length} cells, spread ${(dev * 100).toFixed(1)}% (smallest ${(lo * 100).toFixed(0)}%, largest ${(hi * 100).toFixed(0)}% of mean)`);
}

/* ---------- streets and tunnels ----------

   Blocks do not touch. Every cell is pulled back from its own edges, which
   turns the shared borders into a network of gaps — streets between blocks,
   and wider channels where a tunnel runs. A tunnel is a chain of those gaps
   picked by shortest path, so it threads between territories rather than
   cutting through them, and it gives a gang a way to the deep even when
   nothing it holds borders the entrance. */

const STREET = 6.5;   // ordinary gap between two blocks
const TUNNEL = 16;    // gap where a tunnel runs
/* An edge on the sector outline belongs to one block and nobody else, so it
   can be pushed outward without breaking a border. Each rim block reaches out
   its own distance, which gives the sector a ragged edge rather than the
   silhouette of the circle it was clipped to. */
const REACH_MIN = -22;
const REACH_VAR = 74;

/* planar graph of every cell edge */
const edgeUse = new Map();
for (const s of seeds) {
  for (let i = 0; i < s.cell.length; i++) {
    const a = s.cell[i], b = s.cell[(i + 1) % s.cell.length];
    const k = edgeKey(a, b);
    if (!edgeUse.has(k)) edgeUse.set(k, { a, b, cells: [] });
    edgeUse.get(k).cells.push(s);
  }
}

const ptOf = new Map();
for (const { a, b } of edgeUse.values()) { ptOf.set(ptKey(a), a); ptOf.set(ptKey(b), b); }

/* Tunnels may only follow gaps that touch the charted section: the deep is
   unsurveyed, so no route is known through its middle. */
const graph = new Map();
const DEEP_DETOUR = 4;   // how strongly a tunnel avoids skirting the deep
for (const [k, e] of edgeUse) {
  if (e.cells.length !== 2) continue;                     // not a gap between two blocks
  if (!e.cells.some((c) => c.kind === 'outer')) continue;
  const skirtsDeep = e.cells.some((c) => c.kind === 'inner');
  const w = Math.hypot(e.a[0] - e.b[0], e.a[1] - e.b[1]) * (skirtsDeep ? DEEP_DETOUR : 1);
  for (const [p, q] of [[e.a, e.b], [e.b, e.a]]) {
    const kp = ptKey(p);
    if (!graph.has(kp)) graph.set(kp, []);
    graph.get(kp).push({ to: ptKey(q), w, edge: k });
  }
}

function shortestPath(startKey, goalKey) {
  const dist = new Map([[startKey, 0]]);
  const prev = new Map();
  const done = new Set();
  for (;;) {
    let best = null, bestD = Infinity;
    for (const [k, d] of dist) if (!done.has(k) && d < bestD) { bestD = d; best = k; }
    if (best === null) return null;
    if (best === goalKey) break;
    done.add(best);
    for (const arc of graph.get(best) ?? []) {
      const nd = bestD + arc.w;
      if (nd < (dist.get(arc.to) ?? Infinity)) {
        dist.set(arc.to, nd);
        prev.set(arc.to, { from: best, edge: arc.edge });
      }
    }
  }
  const edges = [], pts = [];
  let cur = goalKey;
  while (cur !== startKey) {
    const step = prev.get(cur);
    if (!step) return null;
    edges.push(step.edge);
    pts.push(ptOf.get(cur));
    cur = step.from;
  }
  pts.push(ptOf.get(startKey));
  return { edges, pts: pts.reverse(), length: dist.get(goalKey) };
}

/* vertices on the sector outline, and on the deep's border */
const rimVerts = new Set();
const deepVerts = new Set();
for (const e of edgeUse.values()) {
  if (e.cells.length === 1) { rimVerts.add(ptKey(e.a)); rimVerts.add(ptKey(e.b)); }
  else if (e.cells.some((c) => c.kind === 'inner') && e.cells.some((c) => c.kind === 'outer')) {
    deepVerts.add(ptKey(e.a)); deepVerts.add(ptKey(e.b));
  }
}

const seedOf = (id) => {
  const s = seeds.find((q) => q.kind === 'outer' && q.meta.id === id);
  if (!s) throw new Error(`unknown territory "${id}"`);
  return s;
};

function nearestVert(set, target) {
  let best = null, bestD = Infinity;
  for (const k of set) {
    const p = ptOf.get(k);
    const d = Math.hypot(p[0] - target[0], p[1] - target[1]);
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}

/* Each tunnel runs from a mouth out on the rim to a way into the deep on the
   far side, so the gangs nearest an entrance are not the only ones who can
   reach it. */
const TUNNEL_ROUTES = [
  { id: 'theta-run',    name: 'The Theta Run',  mouth: 'sumptown',       toward: ['coil-gardens'],                  gateway: 'theta-breach',
    notes: 'A maintenance bore running the width of the Reach. It was cut to service the relay and it still ends at the breach the Tech-Acquisitors made.' },
  { id: 'the-deadfall', name: 'The Deadfall',   mouth: 'quarantines-end', toward: ['grudgehold', 'holestead'], gateway: 'prospectors-cut',
    notes: 'A collapsed transit shaft walked end to end only twice. It comes out at the shaft both Ironhead companies have filed on.' }
];

const tunnels = TUNNEL_ROUTES.map((route) => {
  const mouthSeed = seedOf(route.mouth);
  const graphVerts = new Set(graph.keys());
  const outward = [
    mouthSeed.p[0] + (mouthSeed.p[0] - CX) * 0.35,
    mouthSeed.p[1] + (mouthSeed.p[1] - CY) * 0.35
  ];
  const startKey = nearestVert(graphVerts, outward);

  /* The far end sits on the deep's border. Where a way in was found from two
     territories at once, it comes out on the corner they share, so the mouth
     sits between them rather than off to one side of both. */
  const reachableDeep = new Set([...deepVerts].filter((k) => graph.has(k)));
  const pool = reachableDeep.size ? reachableDeep : deepVerts;
  let aim;
  if (route.toward.length > 1) {
    const sets = route.toward.map((id) => new Set(seedOf(id).cell.map(ptKey)));
    const shared = [...sets[0]].filter((k) => sets.every((set) => set.has(k)));
    const corner = shared.find((k) => deepVerts.has(k)) ?? shared[0];
    if (!corner) throw new Error(`"${route.id}": ${route.toward.join(" and ")} share no corner`);
    aim = ptOf.get(corner);
  } else {
    /* one finder: come out at that territory's tip — the corner of it that
       reaches furthest into the deep */
    const cellVerts = seedOf(route.toward[0]).cell.map(ptKey).filter((k) => deepVerts.has(k));
    if (!cellVerts.length) throw new Error(`"${route.id}": ${route.toward[0]} does not touch the deep`);
    let best = null, bestD = Infinity;
    for (const k of cellVerts) {
      const p = ptOf.get(k);
      const d = Math.hypot(p[0] - CX, p[1] - CY);
      if (d < bestD) { bestD = d; best = p; }
    }
    aim = best;
  }
  const goalKey = nearestVert(pool, aim);

  const path = shortestPath(startKey, goalKey);
  if (!path) throw new Error(`no route for tunnel "${route.id}"`);
  return { ...route, ...path, end: ptOf.get(goalKey), mouthPt: ptOf.get(startKey) };
});

const tunnelEdges = new Set();
for (const t of tunnels) for (const k of t.edges) tunnelEdges.add(k);

/* ---------- pull every block back from its edges ---------- */

function insetPolygon(poly, dists) {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const sign = area > 0 ? 1 : -1;

  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * sign, ny = (dx / len) * sign;
    return { px: a[0] + nx * dists[i], py: a[1] + ny * dists[i], dx, dy };
  });

  const out = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i - 1 + n) % n], l2 = lines[i];
    const den = l1.dx * l2.dy - l1.dy * l2.dx;
    if (Math.abs(den) < 1e-9) { out.push([r2(l2.px), r2(l2.py)]); continue; }
    const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / den;
    let x = l1.px + l1.dx * t, y = l1.py + l1.dy * t;

    const v = poly[i];
    const cap = 2.2 * Math.max(Math.abs(dists[(i - 1 + n) % n]), Math.abs(dists[i]));
    const moved = Math.hypot(x - v[0], y - v[1]);
    if (moved > cap) {
      const f = cap / moved;
      x = v[0] + (x - v[0]) * f;
      y = v[1] + (y - v[1]) * f;
    }
    out.push([r2(x), r2(y)]);
  }
  return dedupe(out);
}

for (const s of seeds) {
  const reach = REACH_MIN + rnd() * REACH_VAR;   // this block's own extent
  const dists = s.cell.map((a, i) => {
    const b = s.cell[(i + 1) % s.cell.length];
    const k = edgeKey(a, b);
    if (tunnelEdges.has(k)) return TUNNEL;
    if (edgeUse.get(k).cells.length === 1) return -reach;
    return STREET;
  });
  s.block = insetPolygon(s.cell, dists);
  if (s.block.length < 3) throw new Error(`block collapsed for ${s.designation ?? s.meta.id}`);
  s.onTunnels = tunnels
    .filter((t) => s.cell.some((a, i) => t.edges.includes(edgeKey(a, s.cell[(i + 1) % s.cell.length]))))
    .map((t) => t.id);
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
  const [lx, ly] = centroid(s.block);
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
    standing: t.standing,
    effect: t.effect,
    contested: !!t.contested,
    bordersInner,
    labelX: lx,
    labelY: ly,
    polygon: s.block,
    tunnels: s.onTunnels,
    links: [...adjacency.get(t.id)].sort(),
    notes: t.notes
  };
});

/* The deep is now divided into its sixteen holdings: the ground is drawn,
   but nothing is known about any of it. `surveyed` flips to true once a
   holding has a name and a type, not when it gains a shape. */
for (const s of innerSeeds) {
  const id = s.designation.toLowerCase();
  const [lx, ly] = centroid(s.block);
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
    polygon: s.block,
    tunnels: s.onTunnels,
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

const tunnelEnd = (gatewayId) => {
  const t = tunnels.find((x) => x.gateway === gatewayId);
  return t ? t.end : null;
};
const gw1 = tunnelEnd("theta-breach") ?? pointOnInnerBorderAt(bearingFrom(["reclaimers-breach"]));
const gw2 = tunnelEnd("prospectors-cut") ?? pointOnInnerBorderAt(bearingFrom(["grudgehold", "holestead"]));

const gateways = [
  {
    id: 'theta-breach',
    name: 'The Theta Breach',
    from: ['coil-gardens'],
    discoveredBy: 'archeo-3',
    contested: false,
    x: gw1[0], y: gw1[1],
    notes: "A Tech-Acquisitor party staged out of Reclaimers' Breach, cut through at the tip of the Coil Gardens and went in. Contact was lost on the second day. The coordinates were the last thing anyone sent up."
  },
  {
    id: 'prospectors-cut',
    name: "The Prospectors' Cut",
    from: ['grudgehold', 'holestead'],
    discoveredBy: 'bjorn-prospectors',
    contested: false,
    x: gw2[0], y: gw2[1],
    notes: 'Found by Ironhead prospectors. Two companies have filed property rights over the shaft, neither claim struck out. Nobody has gone past the first chamber.'
  }
];

/* ---------- gangs ---------- */

const gangs = [
  { id: 'sumptown',            name: 'Sumptown Brawlers',                 short: 'Sumptown',      house: 'House Goliath',      color: '#e03131' },
  { id: 'chymist-cult',        name: "'Sola Dosis' Chymist Cult",         short: 'Sola Dosis',    house: 'House Escher',       color: '#9d7ad4' },
  { id: 'archeo-3',            name: 'Archeo-Acquisitions Team 3',        short: 'Archeo-3',      house: 'House Van Saar',     color: '#35a9c0' },
  { id: 'mycelium',            name: 'Mycelium Section',                  short: 'Mycelium',      house: 'House Delaque',      color: '#7d9683', player: 'Anton' },
  { id: 'precinct-22',         name: 'Precinct 22',                       short: 'Precinct 22',   house: 'Palanite Enforcers', color: '#e8c23a' },
  { id: 'bjorn-prospectors',   name: 'Bjorn "H.C.L.F" Prospectors Group', short: 'Bjorn H.C.L.F', house: 'Ironhead Squats',    color: '#e8822c' },
  { id: 'resource-extraction', name: 'Resource Extraction LLC',           short: 'Resource Ext.', house: 'Ironhead Squats',    color: '#6f9c33' },
  { id: 'malstrain',           name: 'Malstrain Genestealers',            short: 'Malstrain',     house: 'Malstrain',          color: '#c6529f', rules: 'Plays by the campaign\u2019s Malstrain rules: no settlement, no charted ground, and a hold in the deep that nobody else has walked.' }
].map((g) => ({ ...g, rating: 1100, credits: 0, reputation: 1, motto: '' }));

/* ---------- emit ---------- */

const data = {
  campaign: {
    name: 'The Hollow Reach',
    sector: 'Sector 7-Gamma, Hive Primus',
    edition: 'N26',
    arbitrator: 'Anton',
    cycle: 1,
    lastUpdated: '2026-11-10',
    /* The phase a cycle falls in is worked out from this plan, so there is
       only ever one number to change when the campaign moves on. */
    phases: [
      { id: 'exploration', name: 'Exploration Phase', cycles: 3,
        blurb: 'Gangs push out from what they hold and find out what is actually down here.' },
      { id: 'downtime-1',  name: 'Downtime',          cycles: 1, kind: 'downtime',
        blurb: 'No challenges. Recovery, trade and hiring before the next push.' },
      { id: 'occupation',  name: 'Occupation Phase',  cycles: 3,
        blurb: 'Ground is claimed and held. Territory changes hands in earnest.' },
      { id: 'downtime-2',  name: 'Downtime',          cycles: 1, kind: 'downtime',
        blurb: 'No challenges. Recovery, trade and hiring before the last push.' },
      { id: 'takeover',    name: 'Takeover Phase',    cycles: 3,
        blurb: 'The last fight over who runs the Reach.' },
      { id: 'wrap-up',     name: 'Campaign Wrap-up',  cycles: 1, kind: 'finale',
        blurb: 'Final standings, the deep is tallied, and the Reach is called.' }
    ],
    notice: 'Two ways into the deep section are known. Neither has been walked all the way in.'
  },
  map: {
    viewBox: (() => {
      const drawn = [...territories.filter((t) => t.polygon).flatMap((t) => t.polygon), ...boundary];
const xs = drawn.map((p) => p[0]), ys = drawn.map((p) => p[1]);
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
  tunnels: tunnels.map((t) => ({
    id: t.id,
    name: t.name,
    width: TUNNEL * 2,
    mouth: t.mouth,
    gateway: t.gateway,
    path: t.pts,
    notes: t.notes
  })),
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
