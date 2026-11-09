# The Hollow Reach — Necromunda N26 Campaign Map

A read-only interactive sector map for our Necromunda campaign. No server, no
build step, no framework: a static page that reads one JSON file.

- **Map** — territories drawn as regions sharing borders, coloured by holder
- **Two sections** — the charted ring, and an uncharted deep nobody has surveyed
- **Standings** — territories held, gang rating, reputation
- **Battle log** — what happened and where
- **Discord** — a GitHub Action announces every change to the campaign channel

## The sector

**The rim (14 territories).** The outermost band. Seven gangs, each holding one
settlement (marked with a star) plus one more territory alongside it.

**The marches (8 territories).** An unclaimed band between the gangs and the
deep. It is a loose buffer, not a sealed one — a couple of rim territories
push through it and reach the uncharted border themselves, which is deliberate.
Perfectly concentric bands read as a diagram; uneven ones read as ground.

**The Uncharted Deep (16 holdings).** Only its border is mapped. The sixteen
holdings inside are known to exist but have no shape, type, income or boon
yet — they get filled in as gangs push in and survey them. Rendered as one
fogged region, listed as `I-01`…`I-16` in the sidebar.

**Two ways in.** `The Theta Breach`, cut by the Tech-Acquisitor party that
stopped transmitting, reached from Relay Station Theta. `The Prospectors' Cut`,
found by Ironhead prospectors and disputed between both Ironhead companies,
reached from Grudgehold or Holestead.

## Arbitrator's secrets

Anything with `"hidden": true` is invisible to players: it never appears on the
map, in the standings, in the legend or in the battle log.

The Malstrain Genestealers are hidden, and so are the two deep holdings they
start on (`I-13` and `I-16`). Players see sixteen identical unsurveyed
holdings. When you want the reveal, delete `"hidden": true` from the gang and
from those territories, and they appear everywhere at once.

## How it works

```
data/campaign.json          the single source of truth — the only file you edit
index.html                  the page
assets/app.js               renders map, standings, deep roster and log
assets/style.css            styling
scripts/validate.mjs        catches typos before they ship
scripts/discord-notify.mjs  diffs two versions and posts the changes
scripts/generate-map.mjs    regenerates the whole tessellation from scratch
.github/workflows/campaign.yml  runs validate + notify on push
```

Update a game night's results by editing `data/campaign.json` and committing.
The site redeploys itself, Discord gets a summary, and git history becomes the
campaign chronicle.

## One-time setup

**1. Push to GitHub** and enable Pages:
Settings → Pages → Source: *Deploy from a branch* → Branch: `main`, folder `/ (root)`.
Your map lands at `https://<user>.github.io/<repo>/`.

**2. Discord announcements** (optional):
In Discord, Channel → Edit Channel → Integrations → Webhooks → New Webhook, copy
the URL. Then in GitHub: Settings → Secrets and variables → Actions →
- **Secrets** → New repository secret → `DISCORD_WEBHOOK_URL`, paste the URL
- **Variables** → New repository variable → `SITE_URL`, `https://<user>.github.io/<repo>`

`SITE_URL` makes territory names in Discord clickable, deep-linking straight to
that territory on the map.

## Editing the data

### Change who holds a territory

```json
{ "id": "rustfall-row", "owner": "sumptown", "contested": false }
```

`owner` is a gang `id`, or `null` for unclaimed.

### Log a battle

Append to `battles`; newest shows at the top of the log.

```json
{
  "date": "2026-11-15",
  "scenario": "Border Dispute",
  "territory": "the-pit-market",
  "participants": ["chymist-cult", "archeo-3"],
  "winner": "chymist-cult",
  "summary": "Escher gas took the market stalls in three turns."
}
```

`winner` may be `null` for a draw.

### Survey a deep holding

When a gang maps part of the Uncharted Deep, fill the holding in and give it a
shape:

```json
{
  "id": "i-07",
  "name": "The Hollow Chapel",
  "designation": "I-07",
  "section": "inner",
  "surveyed": true,
  "type": "Shrine",
  "owner": null,
  "income": "D3x10 credits",
  "boon": "Reroll one Willpower test per battle",
  "polygon": [[x, y], [x, y], ...],
  "labelX": 0, "labelY": 0,
  "links": []
}
```

The validator enforces the pairing: `surveyed: true` requires a polygon, and a
polygon without `surveyed: true` will not be drawn.

### Advance the campaign

```json
"campaign": { "cycle": 2, "phase": "Takeover", "lastUpdated": "2026-11-15",
              "notice": "Downtime closes Friday. Get your rosters in." }
```

`notice` is the yellow banner — omit it or set `""` to hide it.

### Redraw the whole map

`scripts/generate-map.mjs` rebuilds the map from a list of territories and a
handful of geometry constants. Territories are Voronoi regions grown from seeds
on three rings, so they genuinely share borders and the `links` in the data are
real adjacencies. Border waviness is added at render time, seeded from each edge
and tapering to zero at its ends, so both neighbours draw the same line. It **overwrites** `data/campaign.json`
entirely, losing any ownership changes and battles, so it is for reshaping the
sector before a campaign rather than during one. Everything it produces is
plain JSON you can hand-edit afterwards.

### Before committing

```bash
node scripts/validate.mjs
```

Checks ids are unique, owners and battle references resolve, borders are
mutual, polygons are well-formed and gateways point at real territories. CI
runs it on every push too.

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

Territory types, income and boons are generic underhive placeholders, not
transcribed N26 territories — swap them for the real list out of the Core
Rulebook. Nothing in the code depends on their values; they are free text.
