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
  if (g.player === 'PLACEHOLDER') warn(`${at}.player: still PLACEHOLDER (${g.name})`);
  if (g.rating != null && typeof g.rating !== 'number') err(`${at}.rating: must be a number`);
}

/* --- territories --- */
const territories = Array.isArray(data.territories) ? data.territories : [];
if (!territories.length) err('territories: expected at least one territory');

const terrIds = new Set();
for (const [i, t] of territories.entries()) {
  const at = `territories[${i}]`;
  if (!t.id) err(`${at}.id: required`);
  else if (terrIds.has(t.id)) err(`${at}.id: duplicate "${t.id}"`);
  else terrIds.add(t.id);

  if (!t.name) err(`${at}.name: required`);
  for (const k of ['x', 'y']) {
    if (typeof t[k] !== 'number') err(`${at}.${k}: required number (map coordinate)`);
  }
  if (t.owner != null && !gangIds.has(t.owner)) {
    err(`${at}.owner: "${t.owner}" is not a known gang id`);
  }
  if (t.contested != null && typeof t.contested !== 'boolean') {
    err(`${at}.contested: must be true or false`);
  }
}

/* --- link integrity (must be symmetrical, or the map draws odd gaps) --- */
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
    warn(`link "${a}" -> "${b}" is one-way; add "${a}" to "${b}".links for a symmetrical map`);
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

/* --- report --- */
for (const w of warnings) console.warn(`WARN  ${w}`);
for (const e of errors) console.error(`FAIL  ${e}`);

if (errors.length) {
  console.error(`\n${errors.length} error(s) in ${path}.`);
  process.exit(1);
}

console.log(
  `OK    ${path}: ${gangs.length} gangs, ${territories.length} territories, ` +
  `${(data.battles ?? []).length} battles` +
  (warnings.length ? ` (${warnings.length} warning(s))` : '')
);
