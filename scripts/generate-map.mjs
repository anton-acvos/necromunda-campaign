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
  { id: 'rustfall-row',       name: 'Rustfall Row',           type: 'Mess Shack',            owner: 'precinct-22',          settlement: false,  income: 15, boon: 'Or recruit a Slopper at a 30 credit discount, if you have none', notes: 'Collapsed habs stacked nine deep with one kitchen still lit at the bottom. The queue forms before the shift horn and nobody skips it.' },
  { id: 'precinct-house-22',  name: 'Precinct House 22',      type: 'Settlement',            owner: 'precinct-22',          settlement: true,   income: 15, boon: 'Or recruit a ganger at a 25 credit discount', notes: 'Built to hold two hundred. Currently holds nineteen, a vox relay and a great deal of institutional stubbornness.' },
  { id: 'the-pit-market',     name: 'The Pit Market',         type: 'Mine Workings',         owner: 'precinct-22',          settlement: false,  income: 20, boon: 'Or take two respirators', notes: 'A worked-out pit the Enforcers reopened and now run themselves. The market that gave it its name trades on the spoil heap at the top.' },
  { id: 'coil-gardens',       name: 'The Coil Gardens',       type: 'Fence Hangout',         owner: null,                   settlement: false,  income: 15, boon: 'Or recruit a Dome Runner at a 30 credit discount, if you have none', notes: 'Pipework grown into a thicket, and a dozen quiet doors inside it. Whatever leaves the sector by the back way goes through here first.' },
  { id: 'reclaimers-breach',  name: "Reclaimers' Breach",     type: 'Settlement',            owner: 'archeo-3',             settlement: true,   income: 15, boon: 'Or recruit a ganger at a 25 credit discount', notes: 'Team 3 cut their way in here and named it for the work. The Tech-Acquisitor party staged out of this hold; their last transmission was a set of coordinates and nothing else.' },
  { id: 'generatorium',       name: 'The Generatorium',       type: 'Generatorium',          owner: 'archeo-3',             settlement: false,  income: 15, standing: '+1 Reputation', rep: 1, notes: 'Plasma conduits that have not gone cold in ten thousand years. Team 3 metered the output before they posted a single guard.' },
  { id: 'cog-market',         name: 'The Cog Market',         type: 'Tech Bazaar',           owner: null,                   settlement: false,  income: 15, notes: 'The up-hive draught comes down the old vent and keeps the stalls cool. Half the tech on the tables was still working when somebody pulled it out.' },
  { id: 'cinder-yard',        name: 'Cinder Yard',            type: 'Mine Workings',         owner: 'bjorn-prospectors',    settlement: false,  income: 20, boon: 'Or take two respirators', notes: 'Ash heaps that shift without warning. Three gangs are still down there somewhere.' },
  { id: 'grudgehold',         name: 'Grudgehold',             type: 'Settlement',            owner: 'bjorn-prospectors',    settlement: true,   income: 15, boon: 'Or recruit a ganger at a 25 credit discount', notes: 'Cut into the rock and ledgered to the last slate. Bjorn filed the claim first and has the paperwork to prove it.' },
  { id: 'holestead',          name: 'Holestead',              type: 'Settlement',            owner: 'resource-extraction',  settlement: true,   income: 15, boon: 'Or recruit a ganger at a 25 credit discount', notes: 'Company housing, company store, company arbitration. Resource Extraction filed second and disputes that it matters.' },
  { id: 'scrap-shoals',       name: 'The Scrap Shoals',       type: 'Mine Workings',         owner: 'resource-extraction',  settlement: false,  income: 20, boon: 'Or take two respirators', notes: 'Quarterly extraction targets are posted at the gate. Somebody has been correcting them in blood.' },
  { id: 'brass-stair',        name: 'The Brass Stair',        type: 'Bullet Den',            owner: 'resource-extraction',  settlement: false,  income: 15, boon: 'Or recruit an Ammo-Jack at a 30 credit discount, if you have none', notes: 'The steps go down into the sump and keep going. Somebody has been stacking crates on the dry landings for a very long time.' },
  { id: 'weeping-still',      name: 'The Weeping Still',      type: 'Synth Still',           owner: null,                   settlement: false,  income: 20, notes: 'Groundwater bleeds through the rockcrete in sheets and the condensers underneath catch every drop. What comes out the other end is sold as medicine.' },
  { id: 'quarantines-end',    name: "Quarantine's End",       type: 'Settlement',            owner: 'chymist-cult',         settlement: true,   income: 15, boon: 'Or recruit a ganger at a 25 credit discount', notes: 'A cracked crystalflex dome, sealed off for something nobody will name and unsealed by the Chymists, who insist the air is clean now.' },
  { id: 'the-still-rows',     name: 'The Still Rows',         type: 'Rogue Las Factoria',    owner: 'chymist-cult',         settlement: false,  income: 20, boon: 'Escher only: instead of the income, add two lasguns to the stash for free', effect: 'Faulty Machinery: at the start of each end phase, randomly select a fighter from each gang. If that fighter is active, they become suppressed.', notes: 'Condensers in rows the length of a dome, half of them re-tooled to stamp power cells. Sola Dosis insists the fumes are therapeutic and the lasguns are legal.' },
  { id: 'black-ledger',       name: 'The Black Ledger',       type: 'Gambling Den',          owner: null,                   settlement: false,  income: 15, standing: '+1 Reputation', rep: 1, notes: 'Debts here are recorded in a real book. People have died trying to edit it.' },
  { id: 'sunken-nave',        name: 'The Sunken Nave',        type: 'Settlement',            owner: 'mycelium',             settlement: true,   income: 15, boon: 'Or recruit a ganger at a 25 credit discount', notes: 'Cawdor built it, something else kept it. Mycelium Section took the crypts and left the nave to the candles.' },
  { id: 'ratgut-tunnels',    name: 'Ratgut Tunnels',         type: 'Bounty Den',            owner: 'mycelium',             settlement: false,  income: 25, notes: 'Not mapped, not mappable. Mycelium Section charges for guides and keeps a second ledger of who is worth money to somebody up-hive.' },
  { id: 'the-bonepipe',       name: 'The Bonepipe',           type: 'Rogue Doc Shop',        owner: 'chymist-cult',         settlement: false,  income: 15, boon: 'Or recruit a Rogue Doc at a 30 credit discount, if you have none', notes: 'The doc is good. The doc is also why several gangers answer to new names.' },
  { id: 'harvest-yard',       name: 'The Harvest Yard',       type: 'Corpse Farm',           owner: 'sumptown',             settlement: false,  income: 25, notes: 'Spools of cable taller than a Goliath, and the vats behind them. The yard takes what the Underhive has finished with and sends it up-hive as protein.' },
];

/* Twenty-two is structural: the ring below is laid out from this list, and
   the seed angles assume its length. How many of them are held is not —
   that moves every time a challenge is settled, so it is not asserted here. */
if (outer.length !== 22) throw new Error(`charted section is ${outer.length}, expected 22`);

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
const INNER_COUNT = 18;   /* the deep, none of it claimed by anyone yet */
const RING_A = 12;

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

/* The Prospectors' Cut comes out on the corner Grudgehold and Holestead share,
   which is where both Ironhead companies want it. On the deep side of that
   corner there was one holding, not two, so the way in sat against I-06 rather
   than between anything.

   Sliding the I-06/I-07 border on its own would leave a T-junction where it
   used to end, and the deep's outline is walked from edges that have to match
   exactly, so I-07's seed moves instead: 88 units along the line towards the
   corner, which carries its border up to meet it. It happens after the
   relaxation, because the area pass would only pull the seed back.

   The figure is hand-found. Much less and I-07 stops short; much more and the
   corner itself starts to drift, taking the way in with it. */
const SEED_SLIDE = { 'I-07': [-47.08, -74.36] };
for (const s of seeds) {
  const d = s.designation && SEED_SLIDE[s.designation];
  if (d) s.p = [s.p[0] + d[0], s.p[1] + d[1]];
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
  { id: 'theta-run',    name: 'The Theta Run',  mouth: 'sumptown',       toward: ['reclaimers-breach'], gateway: 'theta-breach', breachAt: 'coil-gardens',
    notes: 'A maintenance bore running the width of the Reach, from the Sumptown wharves to Reclaimers’ Breach. It was cut to service the relay, and it runs on past the hole the Tech-Acquisitors made in its wall.' },
  { id: 'the-deadfall', name: 'The Deadfall',   mouth: 'quarantines-end', toward: ['grudgehold', 'holestead'], gateway: 'prospectors-cut',
    notes: 'A collapsed transit shaft walked end to end only twice. It comes out at the shaft both Ironhead companies have filed on.' }
];

/* A territory's tip: the corner of it that reaches furthest into the deep.
   A tunnel aims at one, and a gateway can be pinned to one the corridor only
   passes through, so extending a corridor does not drag its way in along. */
function deepTip(id, why) {
  const cellVerts = seedOf(id).cell.map(ptKey).filter((k) => deepVerts.has(k));
  if (!cellVerts.length) throw new Error(`"${why}": ${id} does not touch the deep`);
  let best = null, bestD = Infinity;
  for (const k of cellVerts) {
    const p = ptOf.get(k);
    const d = Math.hypot(p[0] - CX, p[1] - CY);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

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
    aim = deepTip(route.toward[0], route.id);
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
    rep: t.rep || null,
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
/* A holding stops being a blank the moment somebody walks it and lives.
   Walking it does not take it: the expedition comes back up with what it
   found and the ground goes on the map unclaimed, open to a challenge like
   any other. "owner" fills in when somebody holds it. Keyed by designation;
   everything not listed here is still a shape with nothing known about it. */
const WALKED = {
  'I-04': {
    name: 'Relumen',
    type: 'Generatorium',
    owner: null,
    income: 15,
    standing: '+1 Reputation',
    rep: 1,
    notes: 'A generatorium that had been dark long enough for the dust to settle in drifts. Archeo-Acquisitions Team 3 found the fault, cleared it, and the stack came back up on its own governors. It has been lit ever since, and nobody holds it.'
  },

  'I-06': {
    name: 'The Blind Magazine',
    type: 'Bullet Den',
    owner: null,
    income: 15,
    boon: 'Or recruit an Ammo-Jack at a 30 credit discount, if you have none',
    notes: 'A munitions store at the bottom of the Deadfall, stacked and sealed and dark enough that the two Ironhead companies who walked into it from opposite ends shot at each other before either worked out who the other was. Resource Extraction LLC held the floor when the lamps came up. Nobody holds the ground.'
  },

  'I-07': {
    name: 'Hollowbore',
    type: 'Mine Workings',
    owner: null,
    income: 20,
    boon: 'Or take two respirators',
    notes: 'A worked seam the Squats never filed, running back further than the lamps reach. Mycelium Section charted it and came back up with the air filters off the dead. Nobody holds it: it is simply on the map now, and anyone may call for it.'
  }
};

for (const s of innerSeeds) {
  const id = s.designation.toLowerCase();
  const found = WALKED[s.designation] || null;
  const [lx, ly] = centroid(s.block);
  territories.push({
    id,
    name: found ? found.name : null,
    designation: s.designation,
    section: 'inner',
    surveyed: !!found,
    type: found ? found.type : null,
    owner: found ? found.owner : null,
    hidden: false,
    income: found ? found.income : null,
    boon: found ? found.boon || null : null,
    standing: found ? found.standing || null : null,
    rep: found ? found.rep || null : null,
    contested: false,
    labelX: lx,
    labelY: ly,
    polygon: s.block,
    tunnels: s.onTunnels,
    links: [...adjacency.get(id)].sort(),
    notes: found ? found.notes : null
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
  if (!t) return null;
  return t.breachAt ? deepTip(t.breachAt, t.id) : t.end;
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
  { id: 'sumptown',            name: 'Sumptown Industries',               short: 'Sumptown',      house: 'House Goliath',      color: '#e03131', player: 'C0dy', rating: 1075, roster: 'data/rosters/sumptown.json' },
  { id: 'chymist-cult',        name: "'Sola Dosis' Chymist Cult",         short: 'Sola Dosis',    house: 'House Escher',       color: '#9d7ad4', logo: 'assets/gangs/chymist-cult.webp', player: 'AmaraTheSilent', rating: 1190, roster: 'data/rosters/chymist-cult.json' },
  { id: 'archeo-3',            name: 'Archeo-Acquisitions Team 3',        short: 'Archeo-3',      house: 'House Van Saar',     color: '#35a9c0', player: 'Gawarges', rating: 1095, roster: 'data/rosters/archeo-3.json' },
  { id: 'mycelium',            name: 'Mycelium Section',                  short: 'Mycelium',      house: 'House Delaque',      color: '#7d9683', player: 'Anton', logo: 'assets/gangs/mycelium.svg', roster: 'data/rosters/mycelium.json' },
  { id: 'precinct-22',         name: 'Precinct 22',                       short: 'Precinct 22',   house: 'Palanite Enforcers', color: '#e8c23a', rating: 1100, roster: 'data/rosters/precinct-22.json' },
  { id: 'bjorn-prospectors',   name: 'Bjorn "H.C.L.F" Prospectors Group', short: 'Bjorn H.C.L.F', house: 'Ironhead Squats',    color: '#e8822c', player: 'Maxgame107', rating: 1100, roster: 'data/rosters/bjorn-prospectors.json' },
  { id: 'resource-extraction', name: 'Resource Extraction LLC',           short: 'Resource Ext.', house: 'Ironhead Squats',    color: '#6f9c33', player: 'Almindor', rating: 1100, roster: 'data/rosters/resource-extraction.json' }
].map((g) => ({ rating: 1100, motto: '', ...g }));

/* ---------- emit ---------- */

const data = {
  campaign: {
    name: 'The Hollow Reach',
    sector: 'Sector 7-Gamma, Hive Primus',
    edition: 'N26',
    arbitrator: 'Anton',
    cycle: 1,
    lastUpdated: '2026-11-16',
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
  /* Every piece carries what it is worth in credits. The number is the
     arbitrator's, set against what the thing does rather than against
     any list, and it is what the piece adds to a gang's rating and what
     it fetches if it is ever traded. It is not money: holding a piece
     does not put a single credit in anybody's stash.

     What the deep still has in it. An expedition that wins comes back up
     with one of these, and "holder" names the gang that took it — null
     while it is still down there waiting to be found.

     Eleven pieces, one per result on 2d6. The curve does the work: the
     tails are the prizes nobody expects to see, and a 7 is a toaster.

     A weapon carries its profile; everything else carries its rule in
     plain words, because a curio that does nothing is still worth having
     if everyone wants one. */
  archeotech: [
    { id: 'voidshell-harness', roll: 12, name: 'The Voidshell Harness', kind: 'Wargear', holder: null, value: 150,
      effect: 'Once per battle, take a 2+ save against a single attack. This save takes priority over the core rules for saves.' },

    { id: 'time-sink', roll: 4, name: 'The Time Sink', kind: 'Wargear', holder: null, value: 90,
      effect: 'Any enemy fighter within Engagement range suffers \u22121 WS. Time runs slow around the bearer, and it is not pleasant to stand near.' },

    { id: 'conversion-eradicator', roll: 10, name: 'Conversion Eradicator', kind: 'Personal equipment', holder: null, value: 110,
      effect: 'Every ranged weapon carried by this fighter gains +1 Strength and +1 AP, and becomes unstable.' },

    { id: 'hagioscope', roll: 5, name: 'Hagioscope', kind: 'Wargear', holder: null, value: 60,
      effect: 'Before the battle, nominate one enemy fighter to be scanned. Gain +1 to hit against that fighter until the end of the battle.' },

    { id: 'psychofamile-pheromones', roll: 6, name: 'Psychofamile Pheromones', kind: 'One-shot', holder: null, value: 45,
      effect: 'Target an enemy fighter. For one round they are treated as a friendly model.' },

    /* Took the Servo-arc Claw's slot the cycle Team 3 carried that one out
       of the deep. A piece drops off the table when somebody holds it, and
       whatever is waiting moves up. */
    { id: 'obscuroptikon', roll: 11, name: 'The Obscuroptikon', kind: 'Wargear', holder: null, value: 120,
      effect: 'Ranged attacks targeting the bearer suffer \u22121 to hit. The field shows a shooter a corridor that is not there, and a fighter who walked out of it an hour ago.' },

    { id: 'grav-cannon', roll: 3, name: 'Grav Cannon', kind: 'Weapon', holder: null, value: 145,
      profile: { range: '12"/24"', lethality: 3, traits: ['Heavy', 'Ammo(5+)', 'Blast(5")', 'Graviton Pulse'] } },

    { id: 'taser-goad', roll: 8, name: 'Taser Goad', kind: 'Weapon', holder: null, value: 55,
      profile: { range: 'E', str: 'S+1', lethality: 1, traits: ['Melee', 'Shock(5+)', 'Concussive(5+)'] } },

    { id: 'servo-arc-claw', name: 'Servo-arc Claw', kind: 'Weapon', holder: 'archeo-3', value: 80,
      profile: { range: 'E', str: 'S+2', ap: '1', lethality: 2, traits: ['Unwieldy', 'Shock(5+)', 'Rending(5+)', 'Damage(2)'] } },

    { id: 'servo-chirurgic-claw', name: 'Servo-chirurgic Claw', kind: 'Weapon', holder: 'resource-extraction', value: 85,
      profile: { range: 'E', str: 'S', lethality: 1, traits: ['Unwieldy', 'Rending(6+)'] },
      effect: 'Blessed Augmetic Surgery (Double) \u2014 choose a friendly Seriously Injured fighter within 1". That fighter is no longer Seriously Injured and regains 1 lost Wound.' },

    { id: 'uncreator-gauntlet', roll: 2, name: 'The Uncreator Gauntlet', kind: 'Weapon', holder: null, value: 140,
      profile: { range: 'E', str: 'S+1', ap: '2', lethality: 2, traits: ['Unwieldy', 'Damage(2)'] },
      effect: 'On a hit, one weapon or piece of wargear carried by the target is destroyed outright, chosen by the bearer. The gauntlet does not break things so much as decline to let them have been made.' },

    { id: 'archaeotoaster', roll: 7, name: 'Archaeotoaster', kind: 'Curio', holder: null, value: 125,
      effect: 'A genuine bread-toasting machine out of the Dark Age of Technology. It does nothing of any value, and everybody wants one. Gain +1 reputation.' }
  ],

  /* Every challenge called this cycle, in the order it was issued, which is
     also the order they resolve in. A settled one keeps its place here and
     points at its entry in the log.

     An expedition names no holding. The deep is unsurveyed and the campaign
     keeps it that way: the arbitrator knows which tile a gang is walking
     into, the other players do not, and the tab prints "into the deep". The
     designation is here because the data has to resolve to a real tile for
     the validator; the page never shows it. */
  challenges: [
    { id: 'c1-escher-pipe',  cycle: 1, kind: 'challenge',  challenger: 'chymist-cult',      territory: 'the-bonepipe', defender: 'mycelium', status: 'settled', battle: 'b1-bonepipe' },
    { id: 'c1-bjorn-deep',   cycle: 1, kind: 'expedition', challenger: 'bjorn-prospectors', target: 'i-06',         defender: 'resource-extraction', status: 'settled', battle: 'b7-blind-magazine',
      notes: 'The two prospecting outfits hold ground that touches at Holestead, and the tunnel they both filed on runs under it. Resource Extraction LLC were already down there, with a survey crew and a prior claim they are happy to read aloud.' },
    { id: 'c1-sumptown-yard', cycle: 1, kind: 'challenge',  challenger: 'sumptown',          territory: 'harvest-yard', defender: 'chymist-cult', status: 'settled', battle: 'b2-harvest-yard' },
    { id: 'c1-archeo-deep',  cycle: 1, kind: 'expedition', challenger: 'archeo-3',          target: 'i-04',         defender: 'mycelium', status: 'settled', battle: 'b6-relumen' },
    { id: 'c1-precinct-deep', cycle: 1, kind: 'expedition', challenger: 'precinct-22',      target: 'i-03',         defender: 'archeo-3', status: 'open' },
    { id: 'c1-mycelium-deep', cycle: 1, kind: 'expedition', challenger: 'mycelium',         target: 'i-07',         defender: 'bjorn-prospectors', status: 'settled', battle: 'b4-hollowbore' },
    { id: 'c1-chymist-deep', cycle: 1, kind: 'expedition', challenger: 'chymist-cult',     target: 'i-17',         status: 'open',
      notes: 'The Chymist Cult filed on I-17 off the back of what came out of the Hollowbore: it sits one wall over from the workings Mycelium Section charted, and whatever is breathable down there is of professional interest. Nobody has been paired with them yet.' },
    { id: 'c1-resource-stair', cycle: 1, kind: 'challenge',  challenger: 'resource-extraction', territory: 'brass-stair', defender: 'chymist-cult', status: 'settled', battle: 'b3-brass-stair' },
    { id: 'c1-precinct-rustfall', cycle: 1, kind: 'challenge', challenger: 'precinct-22', territory: 'rustfall-row', defender: 'sumptown', status: 'settled', battle: 'b5-rustfall-row',
      notes: 'A second call from Precinct 22 this cycle, which is one more than the rules allow. Two concessions left half the Reach with nothing to do, so the arbitrator let it stand.' },
    { id: 'c1-sumptown-deep', cycle: 1, kind: 'expedition', challenger: 'sumptown', target: 'i-05', status: 'open',
      notes: 'Sumptown filed on the deep the cycle they lost Rustfall Row to the Enforcers. Ground nobody holds costs nothing to call for, and Sumptown would rather walk a tunnel than knock on the same door twice. Nobody has been paired with them yet.' }
  ],

  /* The log. A challenge that nobody turned up for is still how ground
     changed hands, so it goes in here with the games.

     Every entry carries the cycle it happened in. The real-world date is
     kept because it is how the arbitrator finds a game again, but nothing
     on the site is ordered or labelled by it: campaign time is what the
     players think in, and the phase is worked out from the cycle. */
  /* Money that did not come out of a battle. A battle's own rewards are
     already written down on the battle, so they are not repeated here: the
     site adds the two together and that sum IS the stash. Nobody keeps a
     running total by hand, so nobody can forget to.

     amount is credits in, or negative for credits out. gear is the same
     idea in objects rather than money: a crate bought, traded away, or
     strapped onto a fighter is one line with a positive or negative qty.
     An entry carries money, gear, or both. "what" is the one line that
     will be read back in six weeks' time, so it says where the thing
     came from, not what it was for. */
  ledger: [
    { id: 'l1-sumptown-cache', cycle: 1, gang: 'sumptown', amount: 25,
      what: 'Starting cache left over \u2014 Sumptown was founded for 1075 of the 1100 they were allowed, and never spent the rest' }
  ],

  /* What the Reach remembers a fighter for. Experience and takedowns
     come out of the battle records on their own; an honour is the part
     no column can hold — the thing that happened that the campaign will
     still be telling stories about. The arbitrator writes these by hand
     and they are the only hand-written part of the Heroes board.

       gang      whose roster the fighter is on
       fighter   the name on that roster, spelled the way the sheet does
       title     two or three words, the way it would be announced
       what      the line that says why, read back in six weeks
       cycle     when it happened
       battle    the game it came out of, if it came out of one */
  honours: [
    { id: 'h1-burton-evidence', gang: 'precinct-22', fighter: 'Jamie Burton',
      title: 'Planted the Evidence', cycle: 1, battle: 'b5-rustfall-row',
      what: 'One game into the service, and already walking onto Sumptown\u2019s own ground to leave a quantity of illicit substance where the Palanites could find it later. It is the reason Precinct 22 can come back legally, which is worth more to the precinct than anything anybody shot that day.' },

    { id: 'h1-bowling-ball-stand', gang: 'bjorn-prospectors', fighter: 'The Iron Bowling Ball',
      title: 'Last One Standing', cycle: 1, battle: 'b4-hollowbore',
      what: 'Four of the crew went down in the workings, the Charter Master among them, and the Exo-Driller was the only thing left upright at the end of it. Finished the side job anyway. The Prospectors lost the seam and came back up with the work done.' },

    { id: 'h1-spydr-angel', gang: 'archeo-3', fighter: 'Spydr 17',
      title: 'Felled the Angel', cycle: 1, battle: 'b6-relumen',
      what: 'Not just a champion. Destroying Angel, who walked out of the Hollowbore the same cycle having put three Squats down and taken nothing back, went out cold in the generatorium to an Arachni-Rig. Whoever is at the top of this board, somebody can reach them.' }
  ],

  /* The log. Each battle carries one reward entry per gang that turned up,
     win or lose, and that entry is the whole record of the game for them:

       primary      credits from the primary mission
       sidejob      credits from the side job
       credits      any other credits (a concession, a consolation, a find)
       rep          reputation gained
       xp           total experience the gang earned
       takedowns    the other side's models taken out of action
       outOfAction  their own models taken out of action
       gear         anything that came back with them, as lines rather
                    than a sentence: { item, qty, value } for ordinary
                    kit, or { piece } naming an archeotech id, whose
                    name, holder and value stay on the piece instead of
                    being written down twice. value is credits apiece
       notes        anything else worth reading back

     Money is three fields rather than one total because the two missions
     pay separately and the arbitrator is told them separately. Everything
     the site shows — a gang's stash, its reputation, how many models it
     has put down — is added up from these, so nothing is kept twice.

     A battle nobody played carries no combat numbers: there was no game.

     fighters is the same game told one model at a time. Each line names a
     fighter off that gang's roster and says what they came out of it with:

       fighter      the name on the roster
       xp           experience that fighter earned
       takedowns    models of the other side this fighter put out of
                    action, which is where a kill rate comes from
       xpFor        what the experience was for, in words
       outOfAction  true if they went out of action
       injury       what they picked up, if anything lasting
       note         anything else worth reading back

     The gang's own xp on the record above is the total, not a sum the
     site works out, because a gang can earn experience no fighter is
     credited with. */

  battles: [
    { id: 'b1-bonepipe',
      date: '2026-11-15',
      cycle: 1,
      scenario: 'Challenge declined',
      territory: 'the-bonepipe',
      participants: ['chymist-cult', 'mycelium'],
      winner: 'chymist-cult',
      /* nobody came, so nobody played: it settles the ground but counts
         as no battle fought for either side */
      played: false,
      /* rolled after the challenge settled: credits each, and the point of
         reputation that goes with taking the ground */
      rewards: [
        { gang: 'chymist-cult', credits: 50, rep: 1 },
        { gang: 'mycelium',     credits: 30 }
      ],
      summary: 'The Chymist Cult called Mycelium Section out over the Rogue Doc. Mycelium Section did not come, and the doc has new patrons.' },

    { id: 'b2-harvest-yard',
      date: '2026-11-15',
      cycle: 1,
      scenario: 'Defence conceded',
      territory: 'harvest-yard',
      participants: ['sumptown', 'chymist-cult'],
      winner: 'sumptown',
      played: false,
      rewards: [
        { gang: 'sumptown', credits: 60, rep: 1 },
        { gang: 'chymist-cult', credits: 20 }
      ],
      summary: 'Sumptown Industries called for the Corpse Farm and the Chymist Cult stood down rather than hold the gate. The vats are under Goliath management by the end of the shift.' },

    { id: 'b3-brass-stair',
      date: '2026-11-15',
      cycle: 1,
      scenario: 'Defence conceded',
      territory: 'brass-stair',
      participants: ['resource-extraction', 'chymist-cult'],
      winner: 'resource-extraction',
      played: false,
      rewards: [
        { gang: 'resource-extraction', credits: 40, rep: 1 },
        { gang: 'chymist-cult',        credits: 30 }
      ],
      summary: 'Second concession of the cycle. Resource Extraction LLC counted the crates on the dry landings, found nobody arguing, and filed the claim.' },

    { id: 'b4-hollowbore',
      date: '2026-11-20',
      cycle: 1,
      scenario: 'Expedition',
      territory: 'i-07',
      participants: ['mycelium', 'bjorn-prospectors'],
      winner: 'mycelium',
      played: true,
      rewards: [
        { gang: 'mycelium', primary: 40, sidejob: 10, rep: 1, xp: 15, takedowns: 4, outOfAction: 0,
          gear: [{ item: 'Respirator', qty: 2, value: 15, note: 'Off the dead, on the way back up' }],
          fighters: [
            { fighter: 'Slippery Jack',    xp: 2, takedowns: 1, xpFor: 'Turning up, and putting one of them out of action' },
            { fighter: 'Destroying Angel', xp: 10, takedowns: 3,
              xpFor: 'Turning up; two for seriously injuring the Charter Master and three more for putting him out of action; two apiece for two more of them',
              note: 'Three of the four Squats who went down are on this one line. Slippery Jack had the fourth.' },
            { fighter: 'Amanita',          xp: 1, xpFor: 'Turning up' },
            { fighter: 'Galerina',         xp: 1, xpFor: 'Turning up' },
            { fighter: 'Puffball',         xp: 1, xpFor: 'Turning up' }
          ] },
        { gang: 'bjorn-prospectors', xp: 6, takedowns: 0, outOfAction: 4,
          fighters: [
            { fighter: 'Bjorn Ironbeard',       xp: 1, xpFor: 'Turning up',
              outOfAction: true, injury: 'Enfeebled (-1 Toughness)', note: 'Into recovery.' },
            { fighter: 'Kadri Cromson',         xp: 1, xpFor: 'Turning up',
              outOfAction: true, note: 'Out cold, and came up with nothing lasting.' },
            { fighter: 'Sven Silverhorn',       xp: 1, xpFor: 'Turning up',
              outOfAction: true, injury: 'Critical injury', note: 'Needs a doctor.' },
            { fighter: 'Vikram Azril',          xp: 1, xpFor: 'Turning up',
              outOfAction: true, injury: 'Hobbled (-1 Movement)', note: 'Into recovery.' },
            { fighter: 'The Iron Bowling Ball', xp: 2, xpFor: 'Turning up, and seriously injuring one of theirs',
              note: 'Last of the Prospectors left standing, and finished the side job on the way out.' }
          ] }
      ],
      summary: 'First holding in the deep anyone has walked. Mycelium Section beat the Bjorn Prospectors to the seam and found it worked out but breathable: a mine, a side job paid on the way out, and no archeotech anywhere in it. Four Squats went down in the dark and Mycelium Section lost nobody at all. Three of the four are Destroying Angel, who came back up worth ten experience alone. The ground itself goes on the map unheld — the expedition charted it, it did not claim it.' },

    { id: 'b5-rustfall-row',
      date: '2026-11-20',
      cycle: 1,
      scenario: 'Challenge',
      territory: 'rustfall-row',
      participants: ['precinct-22', 'sumptown'],
      winner: 'precinct-22',
      played: true,
      rewards: [
        /* Precinct 22's own report, one officer at a time. Jones and daniel
           were on the roster and are not in it: no experience was credited
           to either, so neither has a line. */
        { gang: 'precinct-22', primary: 20, sidejob: 20, rep: 1, xp: 22, outOfAction: 1,
          notes: 'The side job was a frame, and Jamie Burton did the planting \u2014 a Rookie, one game into the service. The illicit substance sits on Sumptown ground where the Palanites can find it whenever they choose to, which gives them a reason to come back legally.',
          fighters: [
            { fighter: 'Precinct Captain Uriel',     xp: 6 },
            { fighter: 'Sergeant Marvin Heemeyer',   xp: 4 },
            { fighter: 'Specialist Hazard',          xp: 3 },
            { fighter: 'Specialist Ian',             xp: 4 },
            { fighter: 'Cave Johnson',               xp: 1, outOfAction: true,
              note: 'Gassed and went down, and came up with nothing lasting. Under observation for the foreseeable future.' },
            { fighter: 'Azazel the Unbroken',        xp: 2 },
            { fighter: 'Jamie Burton',               xp: 2, xpFor: 'Turning up, and the side job' }
          ] },
        /* Sumptown have not reported yet, so their side of this game is
           still blank: no experience, no casualties, nothing claimed. */
        { gang: 'sumptown' }
      ],
      summary: 'The call the arbitrator let stand, and the Enforcers made it pay. Precinct 22 cleared the stacks off Sumptown Industries and the kitchen at the bottom now serves whoever the Palanites say it serves.' },

    { id: 'b6-relumen',
      date: '2026-11-20',
      cycle: 1,
      scenario: 'Expedition',
      territory: 'i-04',
      participants: ['archeo-3', 'mycelium'],
      winner: 'archeo-3',
      played: true,
      rewards: [
        { gang: 'archeo-3', primary: 20, sidejob: 20, credits: 15, rep: 2, xp: 14, takedowns: 3, outOfAction: 0, gear: [{ piece: 'servo-arc-claw' }],
          notes: 'The fifteen came with the discovery, along with the point of reputation for lighting the stack.',
          fighters: [
            { fighter: 'Skorgen "Fixer" Plasen', xp: 2, xpFor: 'Standing on an objective, and the point for turning up' },
            { fighter: 'Krell "Crackles" Rache', xp: 5, takedowns: 1, xpFor: 'Three for putting the leader out of action, one for an objective, one for turning up' },
            { fighter: 'Spydr 17', xp: 4, takedowns: 1,
              xpFor: 'Three for putting Destroying Angel out of action, one for turning up' },
            { fighter: 'Skarper "Gofer" Raleski', xp: 2, xpFor: 'Standing on an objective, and the point for turning up' },
            { fighter: 'Kirsche "Deathwish" Pashkel', xp: 1, xpFor: 'Turning up',
              note: 'Ran out of ammunition while missing exclusively.' }
          ] },
        { gang: 'mycelium', primary: 10, xp: 7, takedowns: 0, outOfAction: 3,
          fighters: [
            { fighter: 'Slippery Jack', xp: 2, xpFor: 'An objective, and the point for turning up',
              outOfAction: true, injury: 'Enfeebled (-1 Toughness)' },
            { fighter: 'Destroying Angel', xp: 1, xpFor: 'Turning up',
              outOfAction: true, injury: 'Out cold' },
            { fighter: 'Amanita', xp: 1, xpFor: 'Turning up',
              note: 'Bottled out. No lasting injuries.' },
            { fighter: 'Galerina', xp: 2, xpFor: 'An objective, and the point for turning up' },
            { fighter: 'Puffball', xp: 1, xpFor: 'Turning up' }
          ] }
      ],
      summary: 'Archeo-Acquisitions Team 3 beat Mycelium Section off the approach and then did what Van Saar do: read the fault, cleared it, and brought the stack back up. One rep for the fight and one for the light, twenty credits for the win, twenty for the side job and fifteen for lighting the place at all. The claw came out of a maintenance cradle nobody had opened.' },

    { id: 'b7-blind-magazine',
      cycle: 1,
      scenario: 'Expedition',
      territory: 'i-06',
      participants: ['resource-extraction', 'bjorn-prospectors'],
      winner: 'resource-extraction',
      played: true,
      rewards: [
        /* Off the Resource Extraction player's own note, which covers both
           sides of the table. Nate and Norn are on the sheet and are not in
           it: no experience was credited to either, so neither has a line. */
        { gang: 'resource-extraction', credits: 40, xp: 14, takedowns: 2, outOfAction: 0,
          gear: [{ piece: 'servo-chirurgic-claw' }],
          notes: 'Forty credits of scrap off the floor, and a claw out of the sealed stacks.',
          fighters: [
            { fighter: 'Karl',   xp: 3, takedowns: 1,
              xpFor: 'Turning up, and two for putting one of their Drill-Kyn out of action' },
            { fighter: 'Helga',  xp: 2, xpFor: 'Turning up, and one for seriously injuring one of their gangers' },
            { fighter: 'Daedra', xp: 2, xpFor: 'Turning up, and one for seriously injuring one of their gangers' },
            { fighter: 'Alric',  xp: 2, xpFor: 'Turning up, and standing on an objective' },
            { fighter: 'Bob',    xp: 5, takedowns: 1,
              xpFor: 'Turning up, one for an objective, and three for putting their Drill Master out of action' }
          ] },
        /* Bjorn's side comes second-hand. Every Prospector who turned up took
           the point for it, but the note does not name the crew, so only the
           two the opposition could identify have lines and there is no gang
           total either. The second model that went down is one of the three
           Drill-Kyn and the note does not say which. */
        { gang: 'bjorn-prospectors', credits: 40, takedowns: 0, outOfAction: 2,
          notes: 'Reported from the other end of the table, so this side is short a few names rather than short a few points.',
          fighters: [
            { fighter: 'Okri Goldhands',        xp: 1, xpFor: 'Turning up',
              outOfAction: true, injury: 'Grievous Wound',
              note: 'Put down by the Exo-Driller and the only lasting damage either company took. The Drill-Kyn who went down beside him made a full recovery; the note does not say which of the three it was.' },
            { fighter: 'The Iron Bowling Ball', xp: 3,
              xpFor: 'Turning up, and two for seriously injuring one of their champions' }
          ] }
      ],
      summary: 'Nobody meant to fight this one. Both Ironhead companies had filed on the same shaft and both sent a scouring party down the Deadfall without telling anybody, and in a sealed munitions store with no lamps lit the two crews shot at each other for a while before either worked out it was shooting at an ally. Resource Extraction LLC held the floor when the light came up and Bjorn H.C.L.F agreed to withdraw. Karl put a Drill-Kyn out of action and Bob walked the Exo-Driller into Okri Goldhands, who came up with a Grievous Wound and is the only lasting damage on either side. Forty credits of scrap each, a Bullet Den on the map, and a Servo-chirurgic Claw out of the stacks for the company. The ground itself stays unheld.' }
  ]
};

writeFileSync('data/campaign.json', JSON.stringify(data, null, 2) + '\n');

const o = territories.filter((t) => t.section === 'outer');
console.log(`outer ${o.length}: ${o.filter(t => t.owner).length} held, ${o.filter(t => !t.owner).length} unclaimed, ${o.filter(t => t.settlement).length} settlements`);
{
  const deep = territories.filter((t) => t.section === 'inner');
  const walked = deep.filter((t) => t.surveyed);
  console.log(`inner ${deep.length}: ${walked.length
    ? walked.map((t) => t.name).join(', ') + ' walked'
    : 'all unclaimed'}`);
}
console.log(`inner border: ${innerPolygon.length} vertices; outer cells touching it: ${o.filter(t => t.bordersInner).length}`);
const reach = territories.filter((t) => t.bordersInner && t.owner);
console.log(`reach    ${reach.length} held territories touch the deep: ${reach.map((t) => t.name).join(", ") || "none"}`);
console.log(`borders  ${territories.reduce((n, t) => n + t.links.length, 0) / 2} shared across the whole sector`);
