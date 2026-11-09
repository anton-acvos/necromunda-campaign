#!/usr/bin/env node
/* Diffs two versions of campaign.json and posts the changes to a Discord webhook.
   Usage: node scripts/discord-notify.mjs <old.json> <new.json>
   Env:   DISCORD_WEBHOOK_URL (required to actually post)
          SITE_URL            (optional, e.g. https://user.github.io/repo — makes territories clickable)
          DRY_RUN=1           (print the payload instead of posting) */

import { readFileSync, existsSync } from 'node:fs';

const [oldPath, newPath] = process.argv.slice(2);
if (!newPath) {
  console.error('usage: node scripts/discord-notify.mjs <old.json> <new.json>');
  process.exit(2);
}

const load = (p) => {
  if (!p || !existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
};

const before = load(oldPath);
const after = load(newPath);

if (!after) {
  console.error(`cannot read ${newPath}`);
  process.exit(1);
}

const SITE_URL = (process.env.SITE_URL ?? '').replace(/\/+$/, '');
const index = (arr, key = 'id') => Object.fromEntries((arr ?? []).map((o) => [o[key], o]));

const gangsNow = index(after.gangs);
const terrNow = index(after.territories);
const terrBefore = index(before?.territories);
const gangsBefore = index(before?.gangs);

const gangName = (id) => (id ? (gangsNow[id]?.name ?? gangsBefore[id]?.name ?? id) : null);
const terrLink = (t) => (SITE_URL ? `[${t.name}](${SITE_URL}/#${t.id})` : `**${t.name}**`);

/* The phase is not stored: it is whichever band of campaign.phases the
   current cycle falls in. */
function phaseOf(snapshot) {
  const c = snapshot?.campaign ?? {};
  let n = 0;
  for (const p of c.phases ?? []) {
    n += Math.max(1, p.cycles ?? 1);
    if (c.cycle <= n) return p.name;
  }
  return c.phase ?? '';
}

const lines = [];

/* --- first run: announce the map rather than diffing against nothing --- */
if (!before) {
  lines.push(`The sector map is live${SITE_URL ? ` — ${SITE_URL}` : ''}.`);
} else {
  /* --- cycle / phase --- */
  const cb = before.campaign ?? {};
  const ca = after.campaign ?? {};
  if (cb.cycle !== ca.cycle) lines.push(`**Cycle ${ca.cycle}** begins.`);
  if (phaseOf(before) !== phaseOf(after)) lines.push(`Phase is now **${phaseOf(after)}**.`);

  /* --- territory ownership --- */
  for (const t of after.territories ?? []) {
    const prev = terrBefore[t.id];
    if (!prev) {
      lines.push(`New territory on the map: ${terrLink(t)} (${t.type ?? 'unknown type'}).`);
      continue;
    }
    if (prev.owner !== t.owner) {
      if (t.owner && prev.owner) {
        lines.push(`${terrLink(t)} seized by **${gangName(t.owner)}** from ${gangName(prev.owner)}.`);
      } else if (t.owner) {
        lines.push(`${terrLink(t)} claimed by **${gangName(t.owner)}**.`);
      } else {
        lines.push(`${terrLink(t)} abandoned — ${gangName(prev.owner)} no longer holds it.`);
      }
    }
    if (!prev.contested && t.contested) lines.push(`${terrLink(t)} is now **contested**.`);
    if (prev.contested && !t.contested) lines.push(`${terrLink(t)} is no longer contested.`);
  }

  for (const t of before.territories ?? []) {
    if (!terrNow[t.id]) lines.push(`${t.name} has been removed from the map.`);
  }

  /* --- new battles --- */
  const seen = new Set(
    (before.battles ?? []).map((b) => `${b.date}|${b.scenario}|${b.territory}`)
  );
  for (const b of after.battles ?? []) {
    if (seen.has(`${b.date}|${b.scenario}|${b.territory}`)) continue;
    const who = (b.participants ?? []).map(gangName).join(' vs ');
    const where = b.territory && terrNow[b.territory] ? ` at ${terrLink(terrNow[b.territory])}` : '';
    const result = b.winner ? `**${gangName(b.winner)}** won` : 'no decisive result';
    lines.push(`Battle — *${b.scenario ?? 'unnamed scenario'}*${where}: ${who}. ${result}.`);
  }

  /* --- notice --- */
  if ((cb.notice ?? '') !== (ca.notice ?? '') && ca.notice) {
    lines.push(`Arbitrator's notice: ${ca.notice}`);
  }

  /* --- rating movement, compacted onto one line --- */
  const moves = [];
  for (const g of after.gangs ?? []) {
    const prev = gangsBefore[g.id];
    if (prev && typeof prev.rating === 'number' && typeof g.rating === 'number' && prev.rating !== g.rating) {
      const delta = g.rating - prev.rating;
      moves.push(`${g.name} ${delta > 0 ? '+' : ''}${delta}`);
    }
  }
  if (moves.length) lines.push(`Gang ratings: ${moves.join(', ')}.`);
}

if (!lines.length) {
  console.log('No campaign-visible changes; nothing to post.');
  process.exit(0);
}

/* --- standings snapshot for the embed footer --- */
const held = {};
for (const t of after.territories ?? []) {
  if (t.owner) held[t.owner] = (held[t.owner] ?? 0) + 1;
}
const standings = (after.gangs ?? [])
  .map((g) => ({ name: g.name, n: held[g.id] ?? 0 }))
  .sort((a, b) => b.n - a.n)
  .map((g) => `${g.name} ${g.n}`)
  .join(' · ');

const payload = {
  username: 'The Arbitrator',
  embeds: [{
    title: after.campaign?.name ?? 'Campaign Update',
    url: SITE_URL || undefined,
    description: lines.map((l) => `• ${l}`).join('\n').slice(0, 4000),
    color: 0xd2652a,
    fields: standings ? [{ name: 'Territories held', value: standings.slice(0, 1024) }] : undefined,
    footer: {
      text: `Cycle ${after.campaign?.cycle ?? '?'} · ${phaseOf(after)}`.trim()
    },
    timestamp: new Date().toISOString()
  }]
};

if (process.env.DRY_RUN === '1' || !process.env.DISCORD_WEBHOOK_URL) {
  if (!process.env.DISCORD_WEBHOOK_URL) console.log('DISCORD_WEBHOOK_URL not set — printing payload instead.');
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const res = await fetch(process.env.DISCORD_WEBHOOK_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});

if (!res.ok) {
  console.error(`Discord returned ${res.status}: ${await res.text()}`);
  process.exit(1);
}

console.log(`Posted ${lines.length} change(s) to Discord.`);
