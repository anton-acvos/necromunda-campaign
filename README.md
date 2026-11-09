# The Hollow Reach — Necromunda N26 Campaign Map

A read-only interactive sector map for our Necromunda campaign. No server, no
build step, no framework: a static page that reads one JSON file.

- **Map** — territories coloured by holder, tunnels between them, click for details
- **Standings** — territories held, gang rating, reputation
- **Battle log** — what happened and where
- **Discord** — a GitHub Action announces every change to the campaign channel

## How it works

```
data/campaign.json     the single source of truth — the only file you edit
index.html             the page
assets/app.js          renders map, standings and log from the JSON
assets/style.css       styling
scripts/validate.mjs   catches typos before they ship
scripts/discord-notify.mjs  diffs two versions and posts the changes
.github/workflows/campaign.yml  runs both on push
```

Update a game night's results by editing `data/campaign.json` and committing.
The site redeploys itself, Discord gets a summary, and git history becomes the
campaign chronicle.

## One-time setup

**1. Push to GitHub** and enable Pages:
Settings → Pages → Source: *Deploy from a branch* → Branch: `main`, folder `/ (root)`.
Your map lands at `https://<user>.github.io/<repo>/`.

**2. Discord announcements** (optional):
In your Discord server, Channel → Edit Channel → Integrations → Webhooks → New Webhook,
copy the URL. Then in GitHub: Settings → Secrets and variables → Actions →
- **Secrets** → New repository secret → name `DISCORD_WEBHOOK_URL`, paste the URL
- **Variables** → New repository variable → name `SITE_URL`, value `https://<user>.github.io/<repo>`

`SITE_URL` is what makes territory names in Discord clickable, deep-linking
straight to that territory on the map.

## Editing the data

### Change who holds a territory

```json
{ "id": "rustfall-row", "owner": "goliath", "contested": false }
```

`owner` is a gang `id`, or `null` for unclaimed.

### Log a battle

Append to `battles`. The newest entry shows at the top of the log, and the
territory's panel shows the most recent battle fought there.

```json
{
  "date": "2026-11-15",
  "scenario": "Border Dispute",
  "territory": "the-pit-market",
  "participants": ["escher", "vansaar"],
  "winner": "escher",
  "summary": "Escher gas took the market stalls in three turns."
}
```

`winner` may be `null` for a draw.

### Advance the campaign

```json
"campaign": { "cycle": 2, "phase": "Takeover", "lastUpdated": "2026-11-15",
              "notice": "Downtime closes Friday. Get your rosters in." }
```

`notice` is the yellow banner at the top of the page — leave it out or set it to
`""` to hide it.

### Add or move a territory

`x` / `y` are coordinates on a 980 × 710 canvas. `r` is roughly its size and
`seed` picks its outline — any integer works, and the same seed always draws the
same shape, so the map is stable between loads. `links` draws tunnels; list the
connection on **both** territories or the validator warns you.

### Before committing

```bash
node scripts/validate.mjs
```

Checks ids are unique, owners and battle references point at things that exist,
links are symmetrical, and dates parse. CI runs it on every push too.

Preview the Discord message without posting:

```bash
DRY_RUN=1 node scripts/discord-notify.mjs <(git show HEAD:data/campaign.json) data/campaign.json
```

## Local preview

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`. The page fetches the JSON, so opening
`index.html` from the filesystem directly will not work.

## Notes on edition

Territory types, income and boons in the seed data are generic underhive
placeholders, not transcribed N26 territories — swap them for the real list out
of the Core Rulebook. Nothing in the code depends on their values; they are
free text.
