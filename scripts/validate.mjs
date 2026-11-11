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

/* --- battles --- */
for (const [i, b] of (data.battles ?? []).entries()) {
  const at = `battles[${i}]`;
  if (b.date && !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) err(`${at}.date: expected YYYY-MM-DD`);
  if (b.territory && !terrIds.has(b.territory)) err(`${at}.territory: unknown id "${b.territory}"`);
  if (b.winner != null && !gangIds.has(b.winner)) err(`${at}.winner: unknown gang id "${b.winner}"`);
  for (const p of b.participants ?? []) {
    if (!gangIds.has(p)) err(`${at}.participants: unknown gang id "${p}"`);
  }
}

/* --- campaign shape: one settlement per non-hidden gang --- */
const openGangs = gangs.filter((g) => !g.hidden);
for (const g of openGangs) {
  const owned = territories.filter((t) => t.owner === g.id && t.section === 'outer');
  if (!owned.some((t) => t.settlement)) {
    warn(`gang "${g.id}" holds no settlement in the charted section`);
  }
}

/* --- campaign shape: two starting and three unclaimed territories per player --- */
{
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
