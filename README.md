# The Hollow Reach — Necromunda N26 Campaign Map

A read-only interactive sector map for our Necromunda campaign. No server, no
build step, no framework: a static page that reads one JSON file.

- **Map** — territories drawn as regions sharing borders, coloured by holder
- **Two sections** — the charted ring, and an uncharted deep nobody has surveyed
- **Forty territories** — two starting and three unclaimed per player
- **Standings** — territories held, gang rating, reputation
- **Campaign tab** — the phase plan, with past, current and coming cycles marked
- **Discord** — a GitHub Action announces every change to the campaign channel

## The sector

**The charted ring (22 territories).** One band, one tile deep, running right
round the uncharted. Seven gangs hold fourteen of it — a settlement (marked
with a star) plus one more territory alongside it — and the other eight are
unclaimed ground lying between gangs rather than behind them. Every holding on
the ring borders the deep, so no gang is further from it than another.

**The Uncharted Deep (18 holdings).** The ground is charted into eighteen
holdings, `I-01`…`I-18`, but they are blank: no name, type, income or boon.
Those get filled in as gangs push in and survey them. `surveyed` means "we
know what it is", not "we know where it is" — every holding already has a
shape.

**Two ways in.** `The Theta Breach`, cut by the Tech-Acquisitor party that
stopped transmitting, reached from Reclaimers' Breach. `The Prospectors' Cut`,
found by Ironhead prospectors and disputed between both Ironhead companies,
reached from Grudgehold or Holestead.

## Running the campaign

The campaign moves on one number: `campaign.cycle` in `data/campaign.json`.
Which phase that cycle falls in is worked out from `campaign.phases`, so the
two can never contradict each other — there is no phase to update by hand.

```
Exploration Phase   cycles 1–3
Downtime            cycle  4
Occupation Phase    cycles 5–7
Downtime            cycle  8
Takeover Phase      cycles 9–11
Campaign Wrap-up    cycle  12
```

Each player may issue one challenge per cycle. The validator fails the build if
`cycle` runs past the end of the plan, and the Discord notifier announces both
a new cycle and a new phase.

## Arbitrator's secrets

Anything with `"hidden": true` is invisible to players: it never appears on the
map, in the standings or in the legend.

The Malstrain Genestealers are hidden, and so are the two deep holdings they
start on (`I-14` and `I-17`). Players see eighteen identical unsurveyed
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
  "type": "Bone Shrine",
  "owner": null,
  "income": 25,
  "boon": "Or recruit a ganger at a 25 credit discount",
  "standing": "+1 Reputation",
  "effect": "Battlefield effect, once you know it",
  "notes": "The candles were lit when the first gang arrived."
}
```

Keep the existing `polygon`, `labelX` and `labelY` — the ground is already
mapped, so surveying only fills in what the place turns out to be. The
validator enforces the pairing: `surveyed: true` requires a name, and a name
without `surveyed: true` still renders blank.

### Advance the campaign

```json
"campaign": { "cycle": 2, "phase": "Takeover", "lastUpdated": "2026-11-15",
              "notice": "Downtime closes Friday. Get your rosters in." }
```

`notice` is the yellow banner — omit it or set `""` to hide it.

### Redraw the whole map

`scripts/generate-map.mjs` rebuilds the map from a list of territories and a
handful of geometry constants. Territories are weighted Voronoi (power) regions
grown from seeds on two rings, so they genuinely share borders and the `links`
in the data are real adjacencies. Each region carries a weight that the
generator nudges until every tile is within a few per cent of the same area —
shapes stay irregular, sizes do not. The sector wall is the intersection of ten
half-planes, which is what gives it a district silhouette rather than an oval.
It **overwrites** `data/campaign.json`
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

Territory types come from the N26 Territory Selection Table and the three
house journals, and the validator rejects a type outside that list. `income`
is whole credits a cycle, `boon` is the alternative you may take instead of
the income, and `standing` is an effect that applies the whole time you hold
the place.

`effect` is the Battlefield Effect, which applies in a battle where the
territory is the Stake. Only The Still Rows has one so far: the rest need
transcribing out of the Core Rulebook, because no published source carries
them. The boon wording here is paraphrased, not GW's text.
