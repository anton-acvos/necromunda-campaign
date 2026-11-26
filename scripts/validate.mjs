#!/usr/bin/env node
/* Validates data/campaign.json so a typo can never ship a broken map.
   Usage: node scripts/validate.mjs [path]  (default: data/campaign.json) */

import { readFileSync } from 'node:fs';

const path = process.argv[2] ?? 'data/campaign.json';
const errors = [];
const warnings = [];

let data;
try {
  data = JSON.parse(readFileSync(path, 'utf8'));
} catch (err) {
  console.error(`FAIL  ${path} is not valid JSON: ${err.message}`);
  process.exit(1);
}

const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

/* --- campaign block --- */
const c = data.campaign;
if (!c || typeof c !== 'object') err('campaign: missing object');
else {
  if (!c.name) err('campaign.name: required');
  if (c.cycle != null && !Number.isInteger(c.cycle)) err('campaign.cycle: must be an integer');
  if (c.lastUpdated && !/^\d{4}-\d{2}-\d{2}$/.test(c.lastUpdated)) {
    err(`campaign.lastUpdated: expected YYYY-MM-DD, got "${c.lastUpdated}"`);
  }
}

/* --- the campaign plan: named phases, each lasting whole cycles --- */
{
  const phases = Array.isArray(c?.phases) ? c.phases : [];
  if (!phases.length) warn('campaign.phases: no plan, so the Campaign tab has nothing to show');

  const phaseIds = new Set();
  let planned = 0;
  for (const [i, p] of phases.entries()) {
    const at = `campaign.phases[${i}]`;
    if (!p.id) err(`${at}.id: required`);
    else if (phaseIds.has(p.id)) err(`${at}.id: duplicate "${p.id}"`);
    else phaseIds.add(p.id);
    if (!p.name) err(`${at}.name: required`);
    if (!Number.isInteger(p.cycles) || p.cycles < 1) {
      err(`${at}.cycles: expected a whole number of cycles, got ${JSON.stringify(p.cycles)}`);
    } else planned += p.cycles;
  }

  if (planned && Number.isInteger(c?.cycle)) {
    if (c.cycle < 1) err(`campaign.cycle: ${c.cycle} is before the campaign starts`);
    else if (c.cycle > planned) {
      err(`campaign.cycle: ${c.cycle} is past the end of the plan (${planned} cycles)`);
    }
  }
  if (c?.phase) {
    warn('campaign.phase: no longer read; the phase comes from campaign.cycle and campaign.phases');
  }
}

/* --- map block --- */
const isPolygon = (p) =>
  Array.isArray(p) && p.length >= 3 &&
  p.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every((n) => typeof n === 'number'));

const map = data.map;
if (!map || typeof map !== 'object') err('map: missing object');
else {
  if (!map.viewBox) err('map.viewBox: required');
  if (!isPolygon(map.boundary)) err('map.boundary: expected an array of at least 3 [x, y] points');
  if (!map.inner || typeof map.inner !== 'object') err('map.inner: missing object');
  else if (!isPolygon(map.inner.polygon)) err('map.inner.polygon: expected an array of [x, y] points');
}

/* --- gangs --- */
const gangs = Array.isArray(data.gangs) ? data.gangs : [];
if (!gangs.length) err('gangs: expected at least one gang');

const gangIds = new Set();
for (const [i, g] of gangs.entries()) {
  const at = `gangs[${i}]`;
  if (!g.id) err(`${at}.id: required`);
  else if (gangIds.has(g.id)) err(`${at}.id: duplicate "${g.id}"`);
  else gangIds.add(g.id);

  if (!g.name) err(`${at}.name: required`);
  if (!g.color) err(`${at}.color: required`);
  else if (!/^#[0-9a-fA-F]{6}$/.test(g.color)) err(`${at}.color: expected #rrggbb, got "${g.color}"`);
  if (!g.short) warn(`${at}.short: no short map label; the map falls back to the house name (${g.name})`);
  if (g.rating != null && typeof g.rating !== 'number') err(`${at}.rating: must be a number`);
  if (g.reputation !== undefined) {
    err(`${at}.reputation: reputation is worked out from the battles and the ` +
        `standings of the ground held, so it is not stored on a gang`);
  }
}

/* The N26 territory types: the core D66 table, plus the house journal holdings.
   Names come from the published Territory Selection Table; a type outside this
   list is almost always a typo or a leftover from the invented placeholders. */
const N26_TYPES = new Set([
  'Settlement',
  'Bullet Den', 'Rogue Doc Shop', 'Mess Shack', 'Drinking Hole', 'Fence Hangout',
  'Bounty Den', 'Generatorium', 'Corpse Farm', 'Tunnels', 'Tech Bazaar',
  'Promethium Cache', 'Collapsed Dome', 'Bone Shrine', 'Mine Workings',
  'Gambling Den', 'Synth Still', 'Old Ruins', 'Fighting Pit',
  /* House of Chains (Goliath) */
  'Slug House', 'Flesh-makers Theatre', 'Fight Arena', 'Amneo-vats', 'Feasting Hall', 'Badzone Smelter',
  /* House of Blades (Escher) */
  'Phelynx Pen', 'Bio-lab', 'Wyld Den', 'Rogue Las Factoria', 'Chem Arena', 'Shivver Den',
  /* House of Iron (Orlock) */
  'Ammo Factoria', 'Vehicle Workshop', 'Wild Snake Distillery', 'Scrap Mine', 'Toll Road', 'Container Stacks'
]);

/* --- territories --- */
const territories = Array.isArray(data.territories) ? data.territories : [];
if (!territories.length) err('territories: expected at least one territory');

const terrIds = new Set();
let outerCount = 0, innerCount = 0, settlements = 0;

for (const [i, t] of territories.entries()) {
  const at = `territories[${i}]`;
  if (!t.id) err(`${at}.id: required`);
  else if (terrIds.has(t.id)) err(`${at}.id: duplicate "${t.id}"`);
  else terrIds.add(t.id);

  if (t.section !== 'outer' && t.section !== 'inner') {
    err(`${at}.section: expected "outer" or "inner", got ${JSON.stringify(t.section)}`);
  }

  if (t.section === 'outer') {
    outerCount++;
    if (!t.name) err(`${at}.name: required for a charted territory`);
    if (!isPolygon(t.polygon)) err(`${at}.polygon: a charted territory needs a shape`);
    for (const k of ['labelX', 'labelY']) {
      if (typeof t[k] !== 'number') err(`${at}.${k}: required number (label position)`);
    }
    if (!N26_TYPES.has(t.type)) err(`${at}.type: "${t.type}" is not an N26 territory type`);
    if (!Number.isInteger(t.income) || t.income < 0) {
      err(`${at}.income: expected whole credits a cycle, got ${JSON.stringify(t.income)}`);
    }
    if (t.settlement) settlements++;
  }

  /* A holding that pays reputation carries the number as well as the line
     of prose, because the number is what the site adds up. */
  if (t.rep !== undefined && t.rep !== null) {
    if (!Number.isInteger(t.rep) || t.rep < 1) {
      err(`${at}.rep: expected whole reputation paid while held, got ${JSON.stringify(t.rep)}`);
    }
    if (!t.standing) {
      err(`${at}.rep: a holding that pays reputation needs a standing line saying so`);
    }
  } else if (t.standing && /reputation/i.test(t.standing)) {
    err(`${at}.standing: says reputation but no rep number, so nothing is added up`);
  }

  if (t.section === 'inner') {
    innerCount++;
    if (!t.designation && !t.name) err(`${at}: a deep holding needs a designation or a name`);
    if (!isPolygon(t.polygon)) err(`${at}.polygon: the deep is charted, so every holding needs a shape`);
    for (const k of ['labelX', 'labelY']) {
      if (typeof t[k] !== 'number') err(`${at}.${k}: required number (label position)`);
    }
    /* surveyed means "we know what it is", not "we know where it is" */
    if (t.surveyed && !t.name) err(`${at}: marked surveyed but has no name`);
    if (!t.surveyed && t.name) {
      warn(`${at}: has the name "${t.name}" but is not marked surveyed, so it still reads as blank`);
    }
  }

  if (t.owner != null && !gangIds.has(t.owner)) {
    err(`${at}.owner: "${t.owner}" is not a known gang id`);
  }
  if (t.contested != null && typeof t.contested !== 'boolean') {
    err(`${at}.contested: must be true or false`);
  }
}

/* --- link integrity (shared borders are mutual) --- */
const linkSet = new Set();
for (const t of territories) {
  for (const other of t.links ?? []) {
    if (!terrIds.has(other)) {
      err(`territories["${t.id}"].links: "${other}" is not a known territory id`);
      continue;
    }
    if (other === t.id) err(`territories["${t.id}"].links: links to itself`);
    linkSet.add(`${t.id}>${other}`);
  }
}
for (const key of linkSet) {
  const [a, b] = key.split('>');
  if (!linkSet.has(`${b}>${a}`)) {
    warn(`border "${a}" -> "${b}" is one-way; add "${a}" to "${b}".links`);
  }
}

/* --- gateways --- */
const gatewayIds = new Set();
for (const [i, gw] of (data.gateways ?? []).entries()) {
  const at = `gateways[${i}]`;
  if (!gw.id) err(`${at}.id: required`);
  else if (gatewayIds.has(gw.id) || terrIds.has(gw.id)) err(`${at}.id: duplicate "${gw.id}"`);
  else gatewayIds.add(gw.id);

  if (!gw.name) err(`${at}.name: required`);
  for (const k of ['x', 'y']) {
    if (typeof gw[k] !== 'number') err(`${at}.${k}: required number (map position)`);
  }
  if (!Array.isArray(gw.from) || !gw.from.length) err(`${at}.from: expected at least one territory id`);
  for (const f of gw.from ?? []) {
    if (!terrIds.has(f)) err(`${at}.from: "${f}" is not a known territory id`);
  }
  if (gw.discoveredBy && !gangIds.has(gw.discoveredBy)) {
    err(`${at}.discoveredBy: "${gw.discoveredBy}" is not a known gang id`);
  }
}

/* --- challenges: issued, not yet settled --- */
const innerIds = new Set(territories.filter((t) => t.section === 'inner').map((t) => t.id));
for (const [i, c] of (data.challenges ?? []).entries()) {
  const at = `challenges[${i}]`;
  if (!gangIds.has(c.challenger)) err(`${at}.challenger: unknown gang id "${c.challenger}"`);
  if (c.defender != null && !gangIds.has(c.defender)) err(`${at}.defender: unknown gang id "${c.defender}"`);
  if (c.status && c.status !== 'open' && c.status !== 'settled') {
    err(`${at}.status: expected "open" or "settled", got ${JSON.stringify(c.status)}`);
  }
  if (c.status === 'settled' && !c.battle) warn(`${at}: settled with no battle to point at`);
  if (c.battle && !(data.battles ?? []).some((b) => b.id === c.battle)) {
    err(`${at}.battle: no log entry with id "${c.battle}"`);
  }
  const stake = c.kind === 'expedition' ? c.target : c.territory;
  if (!stake) err(`${at}: no stake — an expedition needs a target, a challenge needs a territory`);
  else if (!terrIds.has(stake)) err(`${at}: unknown territory id "${stake}"`);
  if (c.kind === 'expedition' && stake && !innerIds.has(stake)) {
    err(`${at}.target: "${stake}" is not in the deep`);
  }
}

/* --- archeotech --- */
const relicIds = new Set();
for (const [i, r] of (data.archeotech ?? []).entries()) {
  const at = `archeotech[${i}]`;
  if (!r.id) err(`${at}: no id`);
  else if (relicIds.has(r.id)) err(`${at}: duplicate id "${r.id}"`);
  else relicIds.add(r.id);
  if (!r.name) err(`${at} (${r.id}): no name`);
  if (r.holder != null && !gangIds.has(r.holder)) {
    err(`${at} (${r.id}).holder: unknown gang id "${r.holder}"`);
  }
  if (r.roll != null && (typeof r.roll !== 'number' || r.roll < 2 || r.roll > 12)) {
    err(`${at} (${r.id}).roll: expected a 2d6 result between 2 and 12`);
  }
  if (r.value == null) {
    warn(`${at} (${r.id}): no value \u2014 nobody can trade or rate a piece worth nothing`);
  } else if (!Number.isInteger(r.value) || r.value < 0) {
    err(`${at} (${r.id}).value: expected whole credits`);
  }
  if (!r.effect && !r.profile) warn(`${at} (${r.id}): neither a profile nor an effect`);
  if (r.profile && r.profile.lethality != null && typeof r.profile.lethality !== 'number') {
    err(`${at} (${r.id}).profile.lethality: must be a number`);
  }
}

/* Eleven results on 2d6, so a full table has one piece on each. A short
   table is fine while the pool is being written; two pieces on one result
   is not, because the roll would be ambiguous. */
{
  const seen = new Map();
  for (const r of data.archeotech ?? []) {
    if (r.roll == null) continue;
    if (seen.has(r.roll)) err(`archeotech: "${r.id}" and "${seen.get(r.roll)}" both sit on a roll of ${r.roll}`);
    else seen.set(r.roll, r.id);
  }
  for (const r of data.archeotech ?? []) {
    if (r.holder && r.roll != null) {
      err(`archeotech: "${r.id}" is held by ${r.holder} but still has a 2d6 result`);
    }
  }
  const missing = [];
  for (let n = 2; n <= 12; n++) if (!seen.has(n)) missing.push(n);
  if (seen.size && missing.length) warn(`archeotech: no piece on 2d6 result ${missing.join(', ')}`);
}

/* --- honours ---

   The arbitrator's own list. A fighter has to exist on the roster it is
   written against, because an honour nobody can look up is just a line. */
function checkHonours(rosterNames) {
  const battleIds = new Set((data.battles ?? []).map((b) => b.id));
  const seen = new Set();
  for (const [i, o] of (data.honours ?? []).entries()) {
    const at = `honours[${i}]`;
    if (!o.id) err(`${at}.id: required`);
    else if (seen.has(o.id)) err(`${at}.id: duplicate "${o.id}"`);
    else seen.add(o.id);

    if (!gangIds.has(o.gang)) err(`${at}.gang: unknown gang id "${o.gang}"`);
    if (!o.fighter) err(`${at}.fighter: required`);
    else {
      const names = rosterNames.get(o.gang);
      if (names && names.size && !names.has(o.fighter)) {
        err(`${at}.fighter: "${o.fighter}" is not on ${o.gang}\u2019s sheet`);
      }
    }
    if (!o.what) err(`${at}.what: required \u2014 an honour has to say why`);
    if (!Number.isInteger(o.cycle) || o.cycle < 1) {
      err(`${at}.cycle: required \u2014 the board is read in campaign time`);
    }
    if (o.battle && !battleIds.has(o.battle)) {
      err(`${at}.battle: unknown battle id "${o.battle}"`);
    }
  }
}

/* What a gang did with a fighter between games. One entry per fighter per
   action: a fighter who trained and shopped in the same cycle has two. */
function checkEndOfCycle(rosterNames) {
  const seen = new Set();
  for (const [i, e] of (data.endOfCycle ?? []).entries()) {
    const at = `endOfCycle[${i}]`;
    if (!e.id) err(`${at}.id: required`);
    else if (seen.has(e.id)) err(`${at}.id: duplicate "${e.id}"`);
    else seen.add(e.id);

    if (!gangIds.has(e.gang)) err(`${at}.gang: unknown gang id "${e.gang}"`);
    if (!e.fighter) err(`${at}.fighter: required`);
    else {
      const names = rosterNames.get(e.gang);
      if (names && names.size && !names.has(e.fighter)) {
        err(`${at}.fighter: "${e.fighter}" is not on ${e.gang}\u2019s sheet`);
      }
    }
    if (!e.action) err(`${at}.action: required \u2014 say what they did`);
    if (!Number.isInteger(e.cycle) || e.cycle < 1) {
      err(`${at}.cycle: required \u2014 actions are read in campaign time`);
    } else if (data.campaign?.cycle != null && e.cycle > data.campaign.cycle) {
      err(`${at}.cycle: ${e.cycle} is after the campaign\u2019s own cycle ${data.campaign.cycle}`);
    }
    if (e.xp != null && (!Number.isInteger(e.xp) || e.xp < 0)) {
      err(`${at}.xp: expected whole experience, got ${JSON.stringify(e.xp)}`);
    }
    if (e.notes != null && typeof e.notes !== 'string') {
      err(`${at}.notes: expected a line of text`);
    }
  }
}

/* --- gear ---

   What a gang came away with that was not money. A line is either a
   piece of ordinary kit with a count, or an archeotech id — and an
   archeotech line carries no name of its own, because the piece already
   has one and the holder written on it is what says who has it. The two
   have to agree, or the same object is in two places at once. */
function checkGear(at, gangId, gear) {
  if (gear == null) return;
  if (!Array.isArray(gear)) {
    err(`${at}.gear: expected a list of lines, not ${typeof gear}`);
    return;
  }
  for (const [j, g] of gear.entries()) {
    const w = `${at}.gear[${j}]`;
    const qty = g.qty == null ? 1 : g.qty;
    if (g.item && g.piece) {
      err(`${w}: names both an item and an archeotech piece — pick one`);
    } else if (g.piece) {
      const piece = (data.archeotech ?? []).find((r) => r.id === g.piece);
      if (!piece) err(`${w}.piece: unknown archeotech id "${g.piece}"`);
      else if (qty > 0 && piece.holder !== gangId) {
        err(`${w}.piece: "${g.piece}" went to ${gangId}, but the piece says ` +
            `${piece.holder ?? 'nobody'} is holding it`);
      } else if (qty < 0 && piece.holder === gangId) {
        err(`${w}.piece: "${g.piece}" is written off ${gangId}, but the piece ` +
            `still says they are holding it`);
      }
    } else if (!g.item) {
      err(`${w}: needs an item name or an archeotech piece`);
    }
    if (g.value != null && (!Number.isInteger(g.value) || g.value < 0)) {
      err(`${w}.value: expected whole credits apiece`);
    }
    if (g.value != null && g.piece) {
      err(`${w}.value: an archeotech piece is worth what the piece says it is`);
    }
    if (g.qty != null && (!Number.isInteger(g.qty) || g.qty === 0)) {
      err(`${w}.qty: expected a whole number in, or negative out`);
    }
  }
}

const rosterNames = new Map();

/* --- rosters ---

   A roster lives in its own file so a fighter edit never rewrites the map.
   The gang record points at it with "roster"; the file is checked here as
   part of the same run, because a roster that will not parse is a roster
   nobody sees. */
{
  const STAT_COUNT = 13;
  /* One of these has to appear in a fighter's keywords, or the roster
     summary has nothing to count them as. The rest of the list is free. */
  const RANKS = new Set([
    'Leader', 'Champion', 'Ganger', 'Prospect', 'Juve',
    'Brute', 'Beast', 'Hybrid', 'Hanger-on'
  ]);

  for (const g of data.gangs ?? []) {
    if (!g.roster) continue;
    let roster;
    try {
      roster = JSON.parse(readFileSync(g.roster, 'utf8'));
    } catch (e) {
      err(`gang "${g.id}".roster: cannot read ${g.roster} — ${e.message}`);
      continue;
    }

    if (roster.gang !== g.id) {
      err(`${g.roster}: says it belongs to "${roster.gang}", but ${g.id} points at it`);
    }

    const fighters = roster.fighters ?? [];
    if (!Array.isArray(fighters)) {
      err(`${g.roster}.fighters: expected an array`);
      continue;
    }

    const seen = new Set();
    let rating = 0;
    for (const [i, f] of fighters.entries()) {
      const at = `${g.roster}.fighters[${i}]`;
      if (!f.name) err(`${at}.name: required`);
      if (f.id == null) err(`${at}.id: required`);
      else if (seen.has(f.id)) err(`${at}.id: duplicate "${f.id}"`);
      else seen.add(f.id);

      if (f.xp != null && (!Number.isInteger(f.xp) || f.xp < 0)) {
        err(`${at}.xp: expected whole experience, got ${JSON.stringify(f.xp)}`);
      }
      if (f.name) {
        if (!rosterNames.has(g.id)) rosterNames.set(g.id, new Set());
        rosterNames.get(g.id).add(f.name);
      }

      if (!Array.isArray(f.keywords) || !f.keywords.length) {
        err(`${at}.keywords: expected the fighter's keyword list`);
      } else if (!f.keywords.some((k) => RANKS.has(k))) {
        warn(`${at}.keywords: none of them is a rank, so the summary cannot count them`);
      }
      if (!Number.isInteger(f.rating) || f.rating < 0) {
        err(`${at}.rating: expected whole credits, got ${JSON.stringify(f.rating)}`);
      } else {
        rating += f.rating;
      }
      if (!Array.isArray(f.stats) || f.stats.length !== STAT_COUNT) {
        err(`${at}.stats: expected ${STAT_COUNT} values, M through Int`);
      }
      for (const [n, w] of (f.weapons ?? []).entries()) {
        if (!w.name) err(`${at}.weapons[${n}].name: required`);
        if (w.traits != null && !Array.isArray(w.traits)) {
          err(`${at}.weapons[${n}].traits: expected an array`);
        }
      }
      for (const k of ['skills', 'rules', 'wargear']) {
        if (f[k] != null && !Array.isArray(f[k])) err(`${at}.${k}: expected an array`);
      }
    }

    /* The sheet and the gang record are two copies of one number, so say
       when they stop agreeing rather than letting the site do it. */
    if (g.rating != null && fighters.length && g.rating !== rating) {
      warn(`${g.roster}: fighters add up to ${rating}, gang record says ${g.rating}`);
    }
  }
}

/* --- ledger ---

   Money that did not come out of a battle. A battle's rewards are not
   repeated here; writing one down twice would quietly double it, so an
   entry that names a battle is rejected. */
{
  const seen = new Set();
  for (const [i, e] of (data.ledger ?? []).entries()) {
    const at = `ledger[${i}]`;
    if (!e.id) err(`${at}.id: required`);
    else if (seen.has(e.id)) err(`${at}.id: duplicate "${e.id}"`);
    else seen.add(e.id);

    if (!gangIds.has(e.gang)) err(`${at}.gang: unknown gang id "${e.gang}"`);
    if (e.amount == null && e.gear == null) {
      err(`${at}: carries neither credits nor gear, so nothing moved`);
    }
    if (e.amount != null && !Number.isInteger(e.amount)) {
      err(`${at}.amount: expected whole credits, in or negative out`);
    }
    checkGear(at, e.gang, e.gear);
    if (!e.what) err(`${at}.what: required — one line saying where it came from`);
    if (!Number.isInteger(e.cycle) || e.cycle < 1) {
      err(`${at}.cycle: required — the stash is read in campaign time`);
    }
    if (e.date && !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) err(`${at}.date: expected YYYY-MM-DD`);
    if (e.battle) {
      err(`${at}.battle: a battle's payout belongs on the battle, not here`);
    }
  }
}

/* --- a battle record: one entry per gang that turned up ---

   Credits arrive as up to three fields and every count is a whole number
   of models or points, because the site adds them up rather than printing
   them. A battle nobody played carries no combat numbers: there was no
   game to take anything out of. */
const REWARD_COUNTS = ['primary', 'sidejob', 'credits', 'xp', 'takedowns', 'outOfAction'];
const REWARD_COMBAT = ['xp', 'takedowns', 'outOfAction'];

function checkRecord(at, b, r) {
  for (const k of REWARD_COUNTS) {
    if (r[k] === undefined || r[k] === null) continue;
    if (!Number.isInteger(r[k]) || r[k] < 0) {
      err(`${at}.${k}: expected a whole count, got ${JSON.stringify(r[k])}`);
    }
  }
  if (b.played === false) {
    for (const k of REWARD_COMBAT) {
      if (r[k]) err(`${at}.${k}: "${b.id}" was never played, so nothing happened in it`);
    }
  }
  if (r.notes != null && typeof r.notes !== 'string') err(`${at}.notes: expected a line of text`);
  for (const [j, f] of (r.fighters ?? []).entries()) {
    const fat = `${at}.fighters[${j}]`;
    if (!f.fighter) err(`${fat}.fighter: required — name the fighter off the roster`);
    if (f.xp != null && (!Number.isInteger(f.xp) || f.xp < 0)) {
      err(`${fat}.xp: expected whole experience, got ${JSON.stringify(f.xp)}`);
    }
    if (f.outOfAction != null && typeof f.outOfAction !== 'boolean') {
      err(`${fat}.outOfAction: true or false — a count belongs on the gang's record`);
    }
    if (b.played === false && (f.xp || f.outOfAction)) {
      err(`${fat}: "${b.id}" was never played, so nobody did anything in it`);
    }
  }
  if ((b.participants ?? []).length && !(b.participants ?? []).includes(r.gang)) {
    err(`${at}.gang: "${r.gang}" is not down as having turned up to "${b.id}"`);
  }
}

/* Both sides of a two-gang game count the same bodies from opposite ends:
   what one side took out is what the other side lost. A mismatch is worth
   a look but not an error — a model can go down without being put down. */
/* A gang's record carries the totals; the per-fighter lines are the same
   game told one model at a time. They are allowed to disagree — a gang can
   earn experience no fighter is credited with, and a model can go down
   without an enemy putting it there — but a disagreement is worth a look. */
function checkCrew(b, rosters) {
  for (const r of b.rewards ?? []) {
    const crew = r.fighters ?? [];
    if (!crew.length) continue;

    const xp = crew.reduce((n, f) => n + (f.xp ?? 0), 0);
    if (r.xp != null && xp !== r.xp) {
      warn(`${b.id}: ${r.gang} is down for ${r.xp} XP but the fighters add up to ${xp}`);
    }
    const down = crew.filter((f) => f.outOfAction).length;
    if (r.outOfAction != null && down !== r.outOfAction) {
      warn(`${b.id}: ${r.gang} is down for ${r.outOfAction} out of action but ${down} marked`);
    }

    /* The gang's takedowns are the total; the fighters' are who did it.
       Fewer credited than counted is ordinary — nobody always knows who
       landed the shot — but more credited than counted cannot be. */
    const kills = crew.reduce((n, f) => n + (f.takedowns ?? 0), 0);
    if (r.takedowns != null && kills > r.takedowns) {
      warn(`${b.id}: ${r.gang} took out ${r.takedowns} but the fighters are credited with ${kills}`);
    }

    const names = rosters.get(r.gang);
    if (!names) continue;
    for (const f of crew) {
      if (f.fighter && !names.has(f.fighter)) {
        warn(`${b.id}: "${f.fighter}" is not a name on ${r.gang}'s roster`);
      }
    }
  }
}

function checkBodies(b) {
  const rs = (b.rewards ?? []).filter((r) => r.takedowns != null || r.outOfAction != null);
  if ((b.participants ?? []).length !== 2 || rs.length !== 2) return;
  const [x, y] = rs;
  for (const [p, q] of [[x, y], [y, x]]) {
    if (p.takedowns != null && q.outOfAction != null && p.takedowns !== q.outOfAction) {
      warn(`${b.id}: ${p.gang} took out ${p.takedowns} but ${q.gang} only lost ${q.outOfAction}`);
    }
  }
}

/* --- battles --- */
for (const [i, b] of (data.battles ?? []).entries()) {
  for (const r of b.rewards ?? []) {
    if (!gangIds.has(r.gang)) err(`battles[${i}] (${b.id}).rewards: unknown gang id "${r.gang}"`);
    if (r.credits != null && typeof r.credits !== 'number') {
      err(`battles[${i}] (${b.id}).rewards: credits must be a number`);
    }
    if (r.rep != null && typeof r.rep !== 'number') {
      err(`battles[${i}] (${b.id}).rewards: rep must be a number`);
    }
    checkGear(`battles[${i}] (${b.id}).rewards[${r.gang}]`, r.gang, r.gear);
    checkRecord(`battles[${i}] (${b.id}).rewards[${r.gang}]`, b, r);
  }
  checkBodies(b);
  checkCrew(b, rosterNames);
  if (!Number.isInteger(b.cycle) || b.cycle < 1) {
    err(`battles[${i}] (${b.id}).cycle: required — the log is read in campaign time, not by date`);
  } else if (data.campaign?.cycle != null && b.cycle > data.campaign.cycle) {
    err(`battles[${i}] (${b.id}).cycle: ${b.cycle} is after the campaign's own cycle ${data.campaign.cycle}`);
  }
  if (b.played != null && typeof b.played !== 'boolean') {
    err(`battles[${i}] (${b.id}): played must be true or false`);
  }
  const at = `battles[${i}]`;
  if (b.date && !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) err(`${at}.date: expected YYYY-MM-DD`);
  if (b.territory && !terrIds.has(b.territory)) err(`${at}.territory: unknown id "${b.territory}"`);
  if (b.winner != null && !gangIds.has(b.winner)) err(`${at}.winner: unknown gang id "${b.winner}"`);
  for (const p of b.participants ?? []) {
    if (!gangIds.has(p)) err(`${at}.participants: unknown gang id "${p}"`);
  }
}

checkHonours(rosterNames);
checkEndOfCycle(rosterNames);

/* --- campaign shape: a gang with charted ground needs a settlement on it.
   A gang that holds nothing charted is playing by its own rules, so the
   check would only ever be noise for it. --- */
for (const g of gangs.filter((g) => !g.hidden)) {
  const owned = territories.filter((t) => t.owner === g.id && t.section === 'outer');
  if (owned.length && !owned.some((t) => t.settlement)) {
    warn(`gang "${g.id}" holds charted ground but no settlement on it`);
  }
}

/* --- campaign shape: two starting and three unclaimed territories per player.
   A setup check only. Once ground starts changing hands the counts are
   supposed to drift, so the first logged result retires it. --- */
if (!(data.battles ?? []).length) {
  const players = gangs.length;
  const held = territories.filter((t) => t.owner).length;
  const open = territories.length - held;
  if (held !== players * 2) {
    warn(`${held} held territories for ${players} players; two each would be ${players * 2}`);
  }
  if (open !== players * 3) {
    warn(`${open} unclaimed territories for ${players} players; three each would be ${players * 3}`);
  }
}

/* --- report --- */
for (const w of warnings) console.warn(`WARN  ${w}`);
for (const e of errors) console.error(`FAIL  ${e}`);

if (errors.length) {
  console.error(`\n${errors.length} error(s) in ${path}.`);
  process.exit(1);
}

const planned = (data.campaign?.phases ?? []).reduce((t, p) => t + (p.cycles ?? 0), 0);
console.log(
  `OK    ${path}: cycle ${data.campaign?.cycle ?? '?'} of ${planned}, ${gangs.length} gangs, ${outerCount} charted (${settlements} settlements), ` +
  `${innerCount} deep holdings, ${(data.gateways ?? []).length} ways in, ` +
  `${(data.battles ?? []).length} battles` +
  (warnings.length ? ` (${warnings.length} warning(s))` : '')
);
