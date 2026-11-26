# The Hollow Reach — Necromunda N26 Campaign Map

A read-only interactive sector map for our Necromunda campaign. No server, no
build step, no framework: a static page that reads one JSON file.

- **Map** — territories drawn as regions sharing borders, coloured by holder
- **Two sections** — the charted ring, and an uncharted deep nobody has surveyed
- **Forty territories** — two starting and three unclaimed per player
- **Standings** — territories held, gang rating, reputation
- **Campaign tab** — the phase plan, with past, current and coming cycles marked,
  the cycle's challenges and count, and the battle log
- **Archeotech tab** — the pool an expedition can come back up with
  (`archeotech` in the data; `holder` names the gang that found a piece, or
  null while it is still down there)
- **Gangs tab** — one card per gang: rating, stash, reputation, income a cycle,
  and every holding it owns with that holding's type and boon
- **Discord** — a GitHub Action announces every change to the campaign channel

## The sector

**The charted ring (22 territories).** One band, one tile deep, running right
round the uncharted. Seven gangs hold fourteen of it — a stronghold (marked
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

Each player may issue one challenge per cycle, and the arbitrator may allow a
second when concessions leave the cycle light — such a challenge carries a
`notes` line saying so. The validator fails the build if
`cycle` runs past the end of the plan, and the Discord notifier announces both
a new cycle and a new phase.

## Arbitrator's secrets

A territory with `"hidden": true` is invisible to players: it never appears on
the map, in the standings or in the legend.

Nothing is hidden at the moment. The deep is eighteen identical unsurveyed
holdings, none of them owned, and the Gangs tab counts a gang's deep holdings
rather than naming them, so a gang that takes one does not show the others
where it went.

A gang's `rules` field, if it has one, is campaign rules of its own, and the
Gangs tab prints it on that gang's card.

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

### Campaign time

Everything the players read is dated by **cycle**, never by the calendar.
A battle and a ledger entry both carry a `cycle`, and the phase is worked
out from it through `campaign.phases`, so the two can never disagree. The
real-world `date` stays in the data — it is how the arbitrator finds a game
again — but nothing is ordered or labelled by it. In the stash, a line that
came out of a game links back to that entry in the log.

### A battle record

A settled battle carries one entry in `rewards` for **each gang that turned
up**, win or lose, and that entry is the whole record of the game for them:

| field | what it holds |
| --- | --- |
| `primary` | credits from the primary mission |
| `sidejob` | credits from the side job |
| `credits` | any other credits — a concession, a consolation, a find |
| `rep` | reputation gained |
| `xp` | total experience the gang earned |
| `takedowns` | the other side's models taken out of action |
| `outOfAction` | their own models taken out of action |
| `gear` | anything that came back with them, as lines — see the lockup |
| `notes` | anything else worth reading back |

Those same `fighters` lines come back out on the roster card, under
"From the log": every game the campaign has written down for that fighter,
with the experience it paid, a link into the log and the reason in the
tooltip.

A roster's `xp` is where the fighter **started**: what they had the day
that sheet was written down, not what they have now. The number in the
card's corner is that plus everything the log has paid them since, and its
tooltip splits the two. So a sheet is never out of date for experience —
it only has to be right about the day it was taken, and the log carries
the rest. Re-reading a player's sheet after some games means subtracting
the logged experience back out, or the same games get counted twice.

A record may also carry `fighters`: the same game told one model at a
time. Each line names a fighter off that gang's roster and carries `xp`,
`xpFor` (what the experience was for, in words), `takedowns` (models
*this* fighter put out of action), `outOfAction`, `injury` and `note`. The log card gives each gang a column of its own and lists them
there, showing the name and the experience, with `xpFor` and `note` in the
tooltip. The gang's own `xp` and `outOfAction` stay the totals — a gang can
earn experience no fighter is credited with, and a model can go down
without an enemy putting it there — but the validator warns when the two
disagree, and when a named fighter is not on that gang's roster.

Money is three fields rather than one total because the two missions pay
separately. Everything the site shows is added up from these: the stash
lists each mission as its own line, reputation adds the `rep`, and the Gangs
tab's **Taken out** stat is every `takedowns` a gang has ever been credited
with. A battle with `played: false` may carry credits and reputation but no
combat numbers — there was no game — and the validator enforces that, warns
when one side's takedowns do not match the other side's losses, and rejects
an entry for a gang that is not in `participants`.

### Reputation

Reputation is not stored either. A gang starts the campaign on **1**, each
`rep` on a battle's `rewards` adds to it, and a held territory with a `rep`
number pays that for as long as it is held — drop the ground and the
reputation goes with it, with nothing to remember. A territory carries both
`standing` (the line the site prints, e.g. `+1 Reputation`) and `rep` (the
number that gets added up); the validator rejects a standing that mentions
reputation without a `rep`, and rejects a `reputation` field on a gang.

Reputation also **pays**. A gang draws ten credits a cycle for every point
it carries, on top of the income from its ground, so a gang on two holdings
and a name can out-earn one on four and nothing. The rate lives in one
place, `REP_RATE` in `assets/app.js`.

The Income stat on a gang card is the two added together, and the holdings
list underneath carries a **Standing in the Reach** line at the bottom
showing what the reputation part is worth, so the list adds up to the
figure in the corner. It is deliberately not a holding: it moves the
moment the Reach changes its mind about a gang.

### The stash

A gang's stash is not stored. It is worked out from every line of money that
has reached them: the `credits` on each battle's `rewards`, plus any entry
in the top-level `ledger` array that names the gang. The Gangs tab shows the
total as the **Stash** stat and a shut **Stash** fold underneath lists the
lines that make it, newest first.

Because battle payouts are read off the battles themselves, the same credits
are never written down twice and the total cannot drift away from the history
that explains it. `ledger` is for everything else — a cycle's income once it
is collected, a purchase (a negative `amount`), a trade between gangs — and
an entry carries `id`, `gang`, `cycle`, `date`, `amount` and `what`. The
validator rejects an entry that names a `battle`, because that payout already
lives on the battle.

### The lockup

Kit is kept the same way money is, and for the same reason: from the lines
that say where each thing came from, never as a total somebody maintains.
A battle's `rewards` carry `gear`, and so may a `ledger` entry. Each gear
line is one of two shapes:

```js
gear: [{ item: 'Respirator', qty: 2, note: 'Off the dead, on the way back up' }]
gear: [{ piece: 'servo-arc-claw' }]
```

A line may also carry `value`, the credits **one** of them is worth; the
fold multiplies it by the count and totals the lockup in its summary. An
archeotech line never carries one, because the piece already has it.

An `item` line names ordinary kit and counts it; `qty` defaults to 1 and
goes **negative** when the thing leaves. A `piece` line names an entry in
`archeotech` instead of repeating it, and the name shown comes off that
piece — as does who holds it, so the validator rejects a gear line that
disagrees with the piece's own `holder`.

The Gangs tab shows a shut **Lockup** fold under the stash: one row per
thing, the count beside it, and under each row the lines that got it there.
A gang holding nothing gets no fold.

Giving an item to a fighter is two edits: add it to their `wargear` on the
roster, and write a ledger line with a negative `qty` saying who took it.
The lockup is therefore **what is spare**, not everything the gang owns —
a fighter's own card is the only place their kit is written down, so it
is never counted twice.

### Heroes

The **Heroes** tab ranks the ten most renowned fighters in the campaign.
Renown is one number made of three:

| worth | for |
| --- | --- |
| 1 | each experience point **the log** has paid them |
| 3 | each model they have put out of action |
| 2 | each lasting injury they carry out of a game |
| 5 | each honour the arbitrator has written down |

Each row prints that working beside the total, so the board can be
checked without reading any code.

A scar counts the lasting **injury**, not the knockdown: going out of
action and getting up again is a bad afternoon, and the board does not pay
for bad afternoons. It is the cheapest of the four on purpose — a fighter
should not climb this board by being shot.

Experience is counted from the log only, never off the sheet: a Leader is
written onto a sheet with sixty-odd before a shot is fired and a Prospect
with one, so ranking on the total would rank the roster rather than the
campaign. Ties go to the fighter who took more models out, then to
whoever did it in fewer games.

Takedowns come from a `takedowns` field on a battle reward's `fighters`
line — the models *that fighter* put out of action, where the reward's own
`takedowns` is the gang total. Nothing else has to be written down for a
fighter to climb: experience and kills both fall out of the battle records.

**Honours** are the exception, and the only hand-written part of the
board. They live in a top-level `honours` array for the things a battle
record has no column for — the moments the campaign will still be telling
stories about:

```js
{ id: 'h1-angel-charter', gang: 'mycelium', fighter: 'Destroying Angel',
  title: 'Broke the Charter', cycle: 1, battle: 'b4-hollowbore',
  what: 'Put the Prospectors\u2019 Charter Master down in the dark and two of his crew after him.' }
```

`battle` is optional, because an honour need not have come out of a game.
The validator rejects one whose fighter is not on that gang’s sheet.

The board reads every roster file at once the first time it is opened, and
shares that cache with the Gangs tab.

### Rosters

A gang's fighters live in their own file, `data/rosters/<gang>.json`, and the
gang record in `campaign.json` points at it with `roster`. These files are
**hand-kept**: `scripts/generate-map.mjs` does not write them, so editing a
fighter never rewrites the map.

The Gangs tab shows a shut `Roster` fold under each card that has one. The
file is fetched the first time somebody opens the fold and cached after that,
so a gang nobody expands costs nothing to load.

A fighter carries `id`, `name`, `archetype`, `keywords`, `rating`, a
13-value `stats` array in the order **M WS BS S T W I A Sv Ld Cl Wil Int**,
a `weapons` array of `{ name, sr, lr, str, ap, l, traits }`, and `skills`,
`rules` and `wargear` arrays. `keywords` is the fighter's keyword list in
sheet order — a fighter can be Leader, Champion, Fighter and Wyrd all at
once — and the roster summary reads the rank back out of it, counting each
fighter once as the highest rank they carry. `status` is free text for
anything the sheet
notes about them right now — "In recovery", "Captured" — and is left null
otherwise.

`scripts/validate.mjs` reads every roster a gang points at: it rejects a
duplicate id, a missing name, a statline that is not 13 values and a weapon
with no name, and it warns when the fighters' ratings no longer add up to
the gang's `rating`. The site says the same thing in the fold, so a sheet
that has drifted is visible without running the validator.

### End-of-cycle actions

Between games a gang spends its fighters on something — training, a trip to
the trading post, a visit to a doc. These happen at the end of every cycle
and live in the top-level `endOfCycle` array, one entry per fighter per
action:

```js
{ id: 'e1-mycelium-death-cap', cycle: 1, gang: 'mycelium', fighter: 'Death Cap',
  action: 'Training', xp: 2, notes: 'Two points, and a level with it' }
```

`id`, `cycle`, `gang`, `fighter` and `action` are required; `xp` and `notes`
are optional. An action that pays nothing still gets an entry, because what
a fighter did with a cycle is worth reading back either way. A fighter stuck
in recovery has no entry: recovery is not something they did.

The experience counts towards what a fighter is worth, and therefore towards
their level — the fighter card shows a **Between games** block under the
battles, and the XP in the corner is the sheet plus the log plus this.

It does **not** count towards renown on the Heroes board. Renown is for what
a fighter did to the other gangs; everybody gets the same actions, and a
fighter in recovery gets none, so ranking on them would rank the downtime
rather than the campaign.

`scripts/validate.mjs` rejects a duplicate id, an unknown gang, a fighter who
is not on that gang’s sheet, a missing action, a cycle that has not happened
yet, and a negative or fractional `xp`.

### The experience ladder

A fighter carries `xp` on their sheet: what they had the day the roster was
written down. Everything the log has credited them with since is added on, so
the number in the corner of a fighter card is what they are worth **now**.
Hover it to see the split.

Beside it sits the level that total reaches, and what the book calls somebody
standing on it. The ladder lives in one place, `LEVEL_FLOOR` in
`assets/app.js`, and both the fighter card and the Heroes board read it:

| Level | Total XP | Title |
| --- | --- | --- |
| 1–4 | 1–12 | Rookie |
| 5–8 | 13–36 | Gang member |
| 9–12 | 37–84 | Gang exemplar |
| 13–16 | 85–132 | Gang hero |
| 17–20 | 133–228 | Gang legend |
| 21 | 229+ | Legend of the Underhive |

The bands inside each title are uneven on purpose: three points a level at
the bottom, twenty-four at the top. The printed table has a gap between 204
and 208, which has to be a typo, so level 20 starts at **205** here and
nobody falls down the hole.

A total below 1 has no level at all. The Heroes board only prints one when
the sheet said where the fighter started, because a level worked out from
log experience alone would be wrong by sixty for a Leader.

The N26 starting baselines, for a sheet that never recorded them: **Leader
61, Champion 37, Brute 25, Ganger 13, Prospect 1**. Anything else — a Psyker,
a pet — comes off the player’s own sheet, because the archetype does not
give it away.

### House rule: shared infrastructure

The Reach pays for an unbroken block. A charted holding within **two held
steps** of its gang's stronghold — each step over ground that same gang
holds — pays **5 more** a cycle than the card says. A holding with no run of
held ground back to the stronghold at all pays **5 less**. Three or more
steps out, it pays what the card says. The stronghold is zero steps from
itself, so it takes the bonus too.

A gang's stronghold is its seat: the territory carries the N26 **Settlement**
type, and the site labels it **Stronghold** so it reads as the main holding
rather than as one type among several. It heads the gang's list of ground.

An expedition charts a holding in the deep; it does not take it. The ground
goes on the map with its name, type and income filled in and no owner, open
to a challenge like anywhere else. A holding in the deep is never adjusted
either way: it is not part of the charted block, and there is no run of held
ground back to the seat. Once a gang does hold one, its income counts
towards their total unadjusted.

The site works this out from ownership and borders every time it loads, so
`income` in the data stays the book's number and the rule follows the ground
as it changes hands. The Gangs tab totals and the territory panel both show
what the holder actually collects, with the adjustment spelled out.

`effect` is the Battlefield Effect, which applies in a battle where the
territory is the Stake. Only The Still Rows has one so far: the rest need
transcribing out of the Core Rulebook, because no published source carries
them. The boon wording here is paraphrased, not GW's text.
