/* The Hollow Reach — read-only campaign map.
   Reads data/campaign.json and renders the sector as filled territories
   sharing borders, plus standings and the detail panel.
   No build step, no dependencies. */

(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var NEUTRAL = '#2b2521';

  var state = { data: null, byId: {}, gangsById: {}, gatewaysById: {}, selected: null };

  /* ---------- tiny helpers ---------- */

  function el(tag, attrs, text) {
    var n = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) { if (attrs[k] != null) n.setAttribute(k, attrs[k]); }
    if (text != null) n.textContent = text;
    return n;
  }

  function h(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  /* Blocks are straight-edged convex polygons separated by streets, so the
     path is just the points. Nothing is shared between neighbours any more,
     which is why no seam-matching wiggle is needed. */
  function polygonPath(poly) {
    if (!poly || poly.length < 3) return "";
    var d = "M" + poly[0][0] + " " + poly[0][1];
    for (var i = 1; i < poly.length; i++) d += "L" + poly[i][0] + " " + poly[i][1];
    return d + "Z";
  }

  function polylinePath(pts) {
    if (!pts || pts.length < 2) return "";
    var d = "M" + pts[0][0] + " " + pts[0][1];
    for (var i = 1; i < pts.length; i++) d += "L" + pts[i][0] + " " + pts[i][1];
    return d;
  }

  /* ---------- data accessors (hidden things stay hidden) ---------- */

  function gangOf(id) {
    var g = state.gangsById[id];
    return g && !g.hidden ? g : null;
  }

  function ownerOf(t) {
    if (!t || t.hidden || !t.owner) return null;
    return gangOf(t.owner);
  }

  function visibleGangs() {
    return (state.data.gangs || []).filter(function (g) { return !g.hidden; });
  }

  function outerTerritories() {
    return (state.data.territories || []).filter(function (t) { return t.section === 'outer'; });
  }

  function innerTerritories() {
    return (state.data.territories || []).filter(function (t) { return t.section === 'inner'; });
  }

  function displayName(t) {
    return t.name || t.designation || t.id;
  }

  /* ---------- map ---------- */

  function wrapLabel(name) {
    if (name.length <= 13) return [name];
    var words = name.split(' ');
    if (words.length < 2) return [name];
    var best = 1, bestDiff = Infinity;
    for (var i = 1; i < words.length; i++) {
      var left = words.slice(0, i).join(' ').length;
      var right = words.slice(i).join(' ').length;
      var diff = Math.abs(left - right);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
  }

  function drawMap() {
    var map = state.data.map || {};
    var svg = document.getElementById('map');
    if (map.viewBox) svg.setAttribute('viewBox', map.viewBox);

    var gBound = document.getElementById('layer-boundary');
    var gTunnels = document.getElementById('layer-tunnels');
    var gLand = document.getElementById('layer-land');
    var gInner = document.getElementById('layer-inner');
    var gGates = document.getElementById('layer-gateways');
    var gLabels = document.getElementById('layer-labels');
    [gBound, gTunnels, gLand, gInner, gGates, gLabels].forEach(function (n) { n.textContent = ''; });

    /* No sector outline is drawn: the blocks jut out past the circle they
       were clipped to, so their own edges are the silhouette. */

    /* Tunnels run under the blocks and show through the gaps the inset
       leaves, so a channel reads as a space between buildings rather than a
       line drawn over them. */
    (state.data.tunnels || []).forEach(function (t) {
      var d = polylinePath(t.path);
      if (!d) return;
      var group = el('g', {
        class: 'tunnel',
        'data-id': t.id,
        tabindex: '0',
        role: 'button',
        'aria-label': t.name + ', tunnel'
      });
      group.appendChild(el('path', {
        d: d, class: 'tunnel-channel', 'stroke-width': t.width || 22
      }));
      group.appendChild(el('path', {
        d: d, class: 'tunnel-spine', 'stroke-width': Math.max(2, (t.width || 22) * 0.16)
      }));
      group.addEventListener('click', function () { select(t.id, true); });
      group.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(t.id, true); }
      });
      gTunnels.appendChild(group);
    });

    /* the charted ring */
    outerTerritories().forEach(function (t) {
      if (!t.polygon) return;
      var g = ownerOf(t);
      var group = el('g', {
        class: 'territory' + (t.settlement ? ' is-settlement' : ''),
        'data-id': t.id,
        tabindex: '0',
        role: 'button',
        'aria-label': t.name + ', ' + (g ? 'held by ' + g.name : 'unclaimed')
      });

      var d = polygonPath(t.polygon);

      group.appendChild(el('path', {
        d: d,
        class: 'territory-shape',
        fill: g ? g.color : NEUTRAL,
        'fill-opacity': g ? 0.55 : 1
      }));

      if (t.contested) {
        group.appendChild(el('path', { d: d, class: 'territory-overlay', fill: 'url(#hatch-contested)' }));
      }

      group.addEventListener('click', function () { select(t.id, true); });
      group.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(t.id, true); }
      });

      gLand.appendChild(group);

      /* label */
      var lines = wrapLabel(t.name);
      var baseY = t.labelY - (lines.length > 1 ? 8 : 0);
      lines.forEach(function (line, i) {
        gLabels.appendChild(el('text', {
          x: t.labelX, y: baseY + i * 19, class: 'territory-name'
        }, line));
      });
      gLabels.appendChild(el('text', {
        x: t.labelX, y: baseY + lines.length * 19 + 1, class: 'territory-owner'
      }, g ? (g.short || g.house) : 'unclaimed'));

      if (t.settlement) {
        gLabels.appendChild(el('path', {
          d: settlementMark(t.labelX, baseY - 24),
          class: 'settlement-mark'
        }));
      }
    });

    /* The deep: the ground is charted into its holdings, but nothing is known
       about any of them. The fog and the dashed section edge sit above the
       cells and ignore the pointer, so clicks land on a holding. */
    var inner = map.inner;
    var innerD = inner && inner.polygon ? polygonPath(inner.polygon) : null;

    if (innerD) gInner.appendChild(el('path', { d: innerD, class: 'inner-fill' }));

    innerTerritories().forEach(function (t) {
      if (!t.polygon) return;
      var g = ownerOf(t);
      var group = el('g', {
        class: 'territory is-deep',
        'data-id': t.id,
        tabindex: '0',
        role: 'button',
        'aria-label': (t.designation || t.id) + ', unsurveyed'
      });

      group.appendChild(el('path', {
        d: polygonPath(t.polygon),
        class: 'deep-shape',
        fill: g ? g.color : null,
        'fill-opacity': g ? 0.5 : null
      }));

      group.addEventListener('click', function () { select(t.id, true); });
      group.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(t.id, true); }
      });
      gInner.appendChild(group);

      gLabels.appendChild(el('text', {
        x: t.labelX, y: t.labelY - 1, class: 'deep-name'
      }, t.designation || t.id));
      if (g) {
        gLabels.appendChild(el('text', {
          x: t.labelX, y: t.labelY + 14, class: 'deep-sub'
        }, g.short || g.house));
      }
    });

    if (innerD) {
      gInner.appendChild(el('path', { d: innerD, class: 'inner-fog' }));
      gInner.appendChild(el('path', { d: innerD, class: 'inner-edge' }));
    }

    /* the two known ways in */
    (state.data.gateways || []).forEach(function (gw) {
      var group = el('g', {
        class: 'gateway' + (gw.contested ? ' is-contested' : ''),
        'data-id': gw.id,
        tabindex: '0',
        role: 'button',
        'aria-label': gw.name + ', entrance to the uncharted deep'
      });

      group.appendChild(el('circle', { cx: gw.x, cy: gw.y, r: 26, class: 'gateway-halo' }));
      group.appendChild(el('path', { d: diamond(gw.x, gw.y, 17), class: 'gateway-mark' }));
      group.appendChild(el('path', { d: diamond(gw.x, gw.y, 7), class: 'gateway-core' }));
      group.addEventListener('click', function () { select(gw.id, true); });
      group.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(gw.id, true); }
      });
      gGates.appendChild(group);

      /* Sit the label inside the deep: outside it collides with the name of
         whichever charted holding the way in opens from. */
      var cxDeep = inner && inner.labelX != null ? inner.labelX : gw.x;
      var cyDeep = inner && inner.labelY != null ? inner.labelY : gw.y;
      var vx = cxDeep - gw.x, vy = cyDeep - gw.y;
      var vlen = Math.sqrt(vx * vx + vy * vy) || 1;
      gLabels.appendChild(el('text', {
        x: gw.x + (vx / vlen) * 46,
        y: gw.y + (vy / vlen) * 46 + 5,
        class: 'gateway-name'
      }, gw.name));
    });

    /* A way in sits on the deep border and its name reaches inside, which can
       land on the designation of the holding behind it. Nudge the designation
       clear rather than let the two overlap. */
    var wayNames = Array.prototype.slice.call(gLabels.querySelectorAll('.gateway-name'));
    var PAD = 7;
    Array.prototype.forEach.call(gLabels.querySelectorAll('.deep-name, .deep-sub'), function (n) {
      wayNames.forEach(function (lab) {
        var A = lab.getBBox(), B = n.getBBox();
        var dx = (B.x + B.width / 2) - (A.x + A.width / 2);
        var dy = (B.y + B.height / 2) - (A.y + A.height / 2);
        var needX = (A.width + B.width) / 2 + PAD - Math.abs(dx);
        var needY = (A.height + B.height) / 2 + PAD - Math.abs(dy);
        if (needX <= 0 || needY <= 0) return;          // boxes already clear
        if (needX < needY) {
          n.setAttribute('x', Number(n.getAttribute('x')) + (dx < 0 ? -needX : needX));
        } else {
          n.setAttribute('y', Number(n.getAttribute('y')) + (dy < 0 ? -needY : needY));
        }
      });
    });
  }

  function diamond(x, y, r) {
    return 'M' + x + ' ' + (y - r) + 'L' + (x + r) + ' ' + y +
           'L' + x + ' ' + (y + r) + 'L' + (x - r) + ' ' + y + 'Z';
  }

  function settlementMark(x, y) {
    var r = 7, d = '';
    for (var i = 0; i < 10; i++) {
      var rad = i % 2 === 0 ? r : r * 0.44;
      var a = (-90 + i * 36) * Math.PI / 180;
      d += (i ? 'L' : 'M') + (x + Math.cos(a) * rad).toFixed(1) + ' ' + (y + Math.sin(a) * rad).toFixed(1);
    }
    return d + 'Z';
  }

  /* ---------- selection ---------- */

  function select(id, updateHash) {
    if (id === 'campaign' || id === 'gangs') {
      showTab(id);
      if (updateHash && window.location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
      return;
    }
    showTab('map');
    state.selected = id;

    Array.prototype.forEach.call(
      document.querySelectorAll('.territory, .gateway, .tunnel'),
      function (n) { n.classList.toggle('is-selected', n.getAttribute('data-id') === id); }
    );
    if (id === 'uncharted') renderInnerRegionDetail();
    else if (state.gatewaysById[id]) renderGatewayDetail(state.gatewaysById[id]);
    else if ((state.tunnelsById || {})[id]) renderTunnelDetail(state.tunnelsById[id]);
    else if (state.byId[id]) renderTerritoryDetail(state.byId[id]);
    else return;

    if (updateHash && window.location.hash !== '#' + id) {
      history.replaceState(null, '', '#' + id);
    }
  }

  function detailBox() {
    var box = document.getElementById('detail');
    box.textContent = '';
    return box;
  }

  function kvList(pairs) {
    var dl = h('dl', 'kv');
    pairs.forEach(function (pair) {
      if (!pair[1]) return;
      var row = h('div');
      row.appendChild(h('dt', null, pair[0]));
      row.appendChild(h('dd', null, pair[1]));
      dl.appendChild(row);
    });
    return dl;
  }

  function renderTerritoryDetail(t) {
    var box = detailBox();
    var g = ownerOf(t);

    var head = h('div', 'detail-head');
    head.appendChild(h('h3', null, displayName(t)));
    if (t.type) head.appendChild(h('span', 'tag', t.type));
    if (t.settlement) head.appendChild(h('span', 'tag settlement', 'Settlement'));
    if (t.section === 'inner') head.appendChild(h('span', 'tag unsurveyed', 'Unsurveyed'));
    if (t.contested) head.appendChild(h('span', 'tag contested', 'Contested'));
    box.appendChild(head);

    var bar = h('div', 'owner-bar');
    bar.style.borderLeftColor = g ? g.color : 'var(--line-bright)';
    if (g) {
      var names = h('div');
      names.appendChild(h('div', 'owner-name', g.name));
      names.appendChild(h('div', 'owner-house', g.house + (g.player ? ' · ' + g.player : '')));
      if (g.motto) names.appendChild(h('div', 'owner-motto', '“' + g.motto + '”'));
      bar.appendChild(names);
    } else {
      bar.appendChild(h('div', 'owner-name', 'Unclaimed'));
    }
    box.appendChild(bar);

    if (t.section === 'inner') {
      box.appendChild(h('p', 'notes',
        'The ground is charted and nothing else is. What this holding is, what it is worth and whatever already lives in it all get written down the first time a gang walks it.'));
      box.appendChild(neighbourNav(t));
      return;
    }

    var dl = kvList([
      ['Income', t.income == null ? null : t.income + ' credits a cycle'],
      ['Boon', t.boon],
      ['Standing', t.standing],
      ['Battlefield effect', t.effect]
    ]);

    var fought = (state.data.battles || []).filter(function (b) { return b.territory === t.id; });
    if (fought.length) {
      var last = fought[fought.length - 1];
      var w = last.winner ? gangOf(last.winner) : null;
      var row = h('div');
      row.appendChild(h('dt', null, 'Last battle'));
      row.appendChild(h('dd', null, last.scenario + ' — ' + (w ? w.name + ' took it' : 'no decisive result')));
      dl.appendChild(row);
    }
    box.appendChild(dl);

    if (t.notes) box.appendChild(h('p', 'notes', t.notes));

    var nav = neighbourNav(t);
    if (nav.childNodes.length) box.appendChild(nav);
  }

  function neighbourNav(t) {
    var nav = h('div', 'neighbours');
    (t.tunnels || []).forEach(function (tid) {
      var tun = (state.tunnelsById || {})[tid];
      if (!tun) return;
      var b = linkBtn(tid, tun.name);
      b.classList.add('is-tunnel');
      nav.appendChild(b);
    });
    (t.links || []).forEach(function (nid) {
      var n = state.byId[nid];
      if (!n) return;
      nav.appendChild(linkBtn(n.id, displayName(n)));
    });
    if (t.section === 'outer' && t.bordersInner) {
      nav.appendChild(linkBtn('uncharted', 'Uncharted Deep'));
    }
    return nav;
  }

  function linkBtn(id, label) {
    var b = h('button', 'neighbour-btn', label);
    b.type = 'button';
    b.addEventListener('click', function () { select(id, true); });
    return b;
  }

  function renderInnerRegionDetail() {
    var inner = (state.data.map || {}).inner || {};
    var box = detailBox();

    var head = h('div', 'detail-head');
    head.appendChild(h('h3', null, inner.label || 'Uncharted Deep'));
    head.appendChild(h('span', 'tag unsurveyed', 'Unsurveyed'));
    box.appendChild(head);

    var list = innerTerritories();
    box.appendChild(kvList([
      ['Holdings', list.length + ' known to exist, none surveyed'],
      ['Ways in', (state.data.gateways || []).length + ' found so far']
    ]));

    if (inner.blurb) box.appendChild(h('p', 'notes', inner.blurb));

    var nav = h('div', 'neighbours');
    (state.data.gateways || []).forEach(function (gw) { nav.appendChild(linkBtn(gw.id, gw.name)); });
    box.appendChild(nav);
  }

  function renderTunnelDetail(t) {
    var box = detailBox();

    var head = h('div', 'detail-head');
    head.appendChild(h('h3', null, t.name));
    head.appendChild(h('span', 'tag tunnel-tag', 'Tunnel'));
    box.appendChild(head);

    var mouth = t.mouth ? state.byId[t.mouth] : null;
    var gw = t.gateway ? state.gatewaysById[t.gateway] : null;
    var along = (state.data.territories || []).filter(function (x) {
      return (x.tunnels || []).indexOf(t.id) !== -1;
    });

    box.appendChild(kvList([
      ['Runs from', mouth ? displayName(mouth) : null],
      ['Comes out at', gw ? gw.name : null],
      ['Territories on it', along.length + ' along its length']
    ]));

    if (t.notes) box.appendChild(h('p', 'notes', t.notes));

    var nav = h('div', 'neighbours');
    along.forEach(function (x) { nav.appendChild(linkBtn(x.id, displayName(x))); });
    if (gw) nav.appendChild(linkBtn(gw.id, gw.name));
    box.appendChild(nav);
  }

  function renderGatewayDetail(gw) {
    var box = detailBox();

    var head = h('div', 'detail-head');
    head.appendChild(h('h3', null, gw.name));
    head.appendChild(h('span', 'tag', 'Way in'));
    if (gw.contested) head.appendChild(h('span', 'tag contested', 'Disputed'));
    box.appendChild(head);

    var found = gw.discoveredBy ? gangOf(gw.discoveredBy) : null;
    var from = (gw.from || []).map(function (id) {
      var t = state.byId[id];
      return t ? displayName(t) : id;
    }).join(' and ');

    box.appendChild(kvList([
      ['Found by', found ? found.name : gw.discoveredBy],
      ['Reached from', from]
    ]));

    if (gw.notes) box.appendChild(h('p', 'notes', gw.notes));

    var nav = h('div', 'neighbours');
    (gw.from || []).forEach(function (id) {
      var t = state.byId[id];
      if (t) nav.appendChild(linkBtn(t.id, displayName(t)));
    });
    nav.appendChild(linkBtn('uncharted', 'Uncharted Deep'));
    box.appendChild(nav);
  }

  /* ---------- standings ---------- */

  function drawStandings() {
    var counts = {}, settlements = {};
    visibleGangs().forEach(function (g) { counts[g.id] = 0; settlements[g.id] = 0; });

    var unclaimedOuter = 0;
    outerTerritories().forEach(function (t) {
      var g = ownerOf(t);
      if (g) {
        counts[g.id]++;
        if (t.settlement) settlements[g.id]++;
      } else {
        unclaimedOuter++;
      }
    });

    var sorted = visibleGangs().slice().sort(function (a, b) {
      return (counts[b.id] - counts[a.id]) || ((b.rating || 0) - (a.rating || 0));
    });

    var body = document.getElementById('standings-body');
    body.textContent = '';
    sorted.forEach(function (g) {
      var tr = h('tr');

      var td1 = h('td');
      var cell = h('div', 'gang-cell');
      var sw = h('span', 'swatch');
      sw.style.background = g.color;
      cell.appendChild(sw);
      var stack = h('div');
      stack.appendChild(h('div', 'gang-name', g.name));
      stack.appendChild(h('div', 'gang-player', g.house));
      cell.appendChild(stack);
      td1.appendChild(cell);
      tr.appendChild(td1);

      tr.appendChild(h('td', 'num', String(counts[g.id])));
      tr.appendChild(h('td', 'num', g.rating != null ? String(g.rating) : '—'));
      tr.appendChild(h('td', 'num', g.reputation != null ? String(g.reputation) : '—'));
      body.appendChild(tr);
    });

    document.getElementById('neutral-count').textContent =
      unclaimedOuter + ' of ' + outerTerritories().length +
      ' charted territories unclaimed · ' + innerTerritories().length + ' deep holdings unsurveyed.';
  }

  /* ---------- the campaign plan ----------

     One number moves the campaign on: campaign.cycle. Which phase that falls
     in is worked out from campaign.phases, so the two can never disagree. */

  function phasePlan() {
    var phases = (state.data.campaign || {}).phases || [];
    var n = 0;
    return phases.map(function (p) {
      var from = n + 1;
      n += Math.max(1, p.cycles || 1);
      return { phase: p, from: from, to: n };
    });
  }

  function totalCycles() {
    var plan = phasePlan();
    return plan.length ? plan[plan.length - 1].to : 0;
  }

  function phaseOfCycle(cycle) {
    var hit = phasePlan().filter(function (b) { return cycle >= b.from && cycle <= b.to; })[0];
    return hit ? hit.phase : null;
  }

  function drawTimeline() {
    var c = state.data.campaign || {};
    var host = document.getElementById('panel-campaign');
    var plan = phasePlan();
    var cur = c.cycle;
    host.textContent = '';
    if (!plan.length) {
      host.appendChild(h('p', 'detail-empty', 'No campaign plan in the data yet.'));
      return;
    }

    var head = h('div', 'plan-head');
    var now = phaseOfCycle(cur);
    head.appendChild(h('h2', null, now ? now.name : 'Campaign'));
    var into = now ? (cur - plan.filter(function (b) { return b.phase === now; })[0].from + 1) : 0;
    var span = now ? Math.max(1, now.cycles || 1) : 0;
    head.appendChild(h('p', 'plan-where',
      'Cycle ' + cur + ' of ' + totalCycles() + (now ? ' — cycle ' + into + ' of ' + span + ' in this phase' : '')));
    host.appendChild(head);

    var track = h('div', 'track');
    plan.forEach(function (b) {
      var where = cur > b.to ? 'is-past' : (cur < b.from ? 'is-ahead' : 'is-now');
      var band = h('div', 'band ' + where + (b.phase.kind ? ' is-' + b.phase.kind : ''));

      band.appendChild(h('h3', 'band-name', b.phase.name));
      band.appendChild(h('p', 'band-span',
        b.from === b.to ? 'Cycle ' + b.from : 'Cycles ' + b.from + '–' + b.to));

      var chips = h('div', 'band-cycles');
      for (var n = b.from; n <= b.to; n++) {
        var mark = n < cur ? 'is-past' : (n === cur ? 'is-now' : 'is-ahead');
        var chip = h('span', 'cyc ' + mark, String(n));
        chip.title = 'Cycle ' + n + (n === cur ? ' — where we are' : (n < cur ? ' — done' : ' — to come'));
        chips.appendChild(chip);
      }
      band.appendChild(chips);
      if (b.phase.blurb) band.appendChild(h('p', 'band-blurb', b.phase.blurb));
      track.appendChild(band);
    });
    host.appendChild(track);

    var foot = h('p', 'hint plan-hint',
      'Each player may issue one challenge per cycle. The arbitrator moves the campaign on by ' +
      'raising "cycle" in data/campaign.json.');
    host.appendChild(foot);
  }

  /* ---------- the gangs tab ---------- */

  /* What a gang draws each cycle is the income on every charted holding it
     owns. Standing boons are listed beside the holding rather than folded
     into the total, because several only pay out for the right House. */
  function holdingsOf(g) {
    return outerTerritories().filter(function (t) { return t.owner === g.id; });
  }

  function incomeOf(g) {
    return holdingsOf(g).reduce(function (n, t) { return n + (t.income || 0); }, 0);
  }

  function deepHoldingsOf(g) {
    return (state.data.territories || []).filter(function (t) {
      return t.owner === g.id && t.section === 'inner';
    });
  }

  /* One card. Every gang here is a player; some play by their own rules,
     which the card states. Holdings in the deep are counted rather than
     named, because the deep stays unsurveyed until a gang walks it. */
  function gangCard(g) {
    var held = holdingsOf(g);
    var deep = deepHoldingsOf(g);

    var card = h('article', 'gang-card' + (g.rules ? ' is-unseen' : ''));
    card.style.borderLeftColor = g.color;

    var side = h('div', 'gang-side');
    var top = h('div', 'gang-card-head');
    /* A gang with a badge shows it instead of the colour chip. The badge
       carries the colour anyway, and a gang without one is not made to
       look like it is missing something. */
    if (g.logo) {
      var badge = document.createElement('img');
      badge.className = 'gang-logo';
      badge.src = g.logo;
      badge.alt = '';
      badge.width = 96;
      badge.height = 96;
      badge.loading = 'lazy';
      top.appendChild(badge);
    } else {
      var sw = h('span', 'swatch');
      sw.style.background = g.color;
      top.appendChild(sw);
    }
    var titles = h('div');
    titles.appendChild(h('h3', 'gang-card-name', g.name));
    titles.appendChild(h('p', 'gang-card-house',
      g.house + (g.player ? ' \u00b7 ' + g.player : '')));
    top.appendChild(titles);
    side.appendChild(top);

    if (g.motto) {
      side.appendChild(h('p', 'gang-card-motto', '“' + g.motto + '”'));
    }
    if (g.rules) side.appendChild(h('p', 'gang-card-rules', g.rules));

    var stats = h('div', 'gang-stats');
    [
      ['Rating', g.rating != null ? g.rating : '\u2014'],
      ['Credits', g.credits != null ? g.credits : '\u2014'],
      ['Rep', g.reputation != null ? g.reputation : '\u2014'],
      ['Income', incomeOf(g) + '/cycle']
    ].forEach(function (pair) {
      var cell = h('div', 'gang-stat');
      cell.appendChild(h('span', 'gang-stat-label', pair[0]));
      cell.appendChild(h('strong', null, String(pair[1])));
      stats.appendChild(cell);
    });
    side.appendChild(stats);
    card.appendChild(side);

    var list = h('ul', 'holdings');
    held.forEach(function (t) {
      var li = h('li', 'holding');
      var row = h('div', 'holding-row');
      var link = h('button', 'holding-name');
      link.type = 'button';
      link.textContent = t.name;
      link.title = 'Show ' + t.name + ' on the map';
      link.addEventListener('click', function () { select(t.id, true); });
      row.appendChild(link);
      if (t.settlement) row.appendChild(h('span', 'tag settlement', 'Settlement'));
      row.appendChild(h('span', 'holding-income', (t.income || 0) + ' cr'));
      li.appendChild(row);
      li.appendChild(h('p', 'holding-type', t.type || 'Unknown type'));
      if (t.boon) li.appendChild(h('p', 'holding-boon', t.boon));
      if (t.standing) {
        li.appendChild(h('p', 'holding-boon is-standing', t.standing + ', the whole time it is held'));
      }
      list.appendChild(li);
    });

    if (deep.length) {
      var unsurveyed = deep.filter(function (t) { return !t.surveyed; });
      var li = h('li', 'holding is-deep');
      li.appendChild(h('div', 'holding-row',
        deep.length === 1 ? 'One holding in the deep' : deep.length + ' holdings in the deep'));
      li.appendChild(h('p', 'holding-type', unsurveyed.length === deep.length
        ? 'Nobody has walked them, so nobody has charted which they are.'
        : 'Some of them have been walked.'));
      list.appendChild(li);
    }

    if (!held.length && !deep.length) {
      list.appendChild(h('li', 'holding is-empty', 'Holds nothing on the charted map.'));
    }
    card.appendChild(list);
    return card;
  }

  function drawGangs() {
    var host = document.getElementById('panel-gangs');
    host.textContent = '';
    var all = state.data.gangs || [];
    if (!all.length) {
      host.appendChild(h('p', 'detail-empty', 'No gangs in the data yet.'));
      return;
    }
    var players = all;

    var head = h('div', 'plan-head');
    head.appendChild(h('h2', null, 'The gangs of the Hollow Reach'));
    var holdings = players.reduce(function (n, g) { return n + holdingsOf(g).length; }, 0);
    var purse = players.reduce(function (n, g) { return n + incomeOf(g); }, 0);
    head.appendChild(h('p', 'plan-where',
      players.length + ' gangs hold ' + holdings + ' charted territories between them, ' +
      'worth ' + purse + ' credits a cycle.'));
    host.appendChild(head);

    var grid = h('div', 'gang-grid');
    players.slice().sort(function (a, b) {
      return incomeOf(b) - incomeOf(a) || a.name.localeCompare(b.name);
    }).forEach(function (g) { grid.appendChild(gangCard(g)); });
    host.appendChild(grid);

    host.appendChild(h('p', 'hint plan-hint',
      'Rating, credits and reputation are whatever the arbitrator last wrote into ' +
      'data/campaign.json. Income is worked out from the holdings listed here.'));
  }

  /* ---------- tabs ---------- */

  function showTab(name) {
    var panels = { map: 'panel-map', campaign: 'panel-campaign', gangs: 'panel-gangs' };
    var tabs = { map: 'tab-map', campaign: 'tab-campaign', gangs: 'tab-gangs' };
    Object.keys(panels).forEach(function (key) {
      var on = key === name;
      document.getElementById(panels[key]).hidden = !on;
      var btn = document.getElementById(tabs[key]);
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  /* ---------- chrome ---------- */

  function drawHeader() {
    var c = state.data.campaign || {};
    if (c.name) {
      document.getElementById('campaign-name').textContent = c.name;
      document.title = c.name;
    }
    document.getElementById('campaign-sector').textContent = c.sector || '';
    document.getElementById('meta-cycle').textContent = c.cycle != null ? c.cycle : '—';
    var nowPhase = phaseOfCycle(c.cycle);
    document.getElementById('meta-phase').textContent = nowPhase ? nowPhase.name.replace(/ Phase$/, '') : (c.phase || '—');
    document.getElementById('meta-edition').textContent = c.edition || '—';
    document.getElementById('meta-updated').textContent = c.lastUpdated || '—';
    document.getElementById('foot-arbitrator').textContent =
      c.arbitrator ? 'Arbitrator: ' + c.arbitrator : '';

    var notice = document.getElementById('notice');
    if (c.notice) { notice.textContent = c.notice; notice.hidden = false; }
  }

  /* ---------- boot ---------- */

  function boot(data) {
    state.data = data;
    state.byId = {};
    state.gangsById = {};
    state.gatewaysById = {};
    (data.territories || []).forEach(function (t) { state.byId[t.id] = t; });
    (data.gangs || []).forEach(function (g) { state.gangsById[g.id] = g; });
    (data.gateways || []).forEach(function (gw) { state.gatewaysById[gw.id] = gw; });
    state.tunnelsById = {};
    (data.tunnels || []).forEach(function (t) { state.tunnelsById[t.id] = t; });

    drawHeader();
    drawMap();
    drawStandings();
    drawTimeline();
    drawGangs();

    document.getElementById('tab-map').addEventListener('click', function () {
      showTab('map');
      if (window.location.hash === '#campaign') {
        history.replaceState(null, '', state.selected ? '#' + state.selected : window.location.pathname);
      }
    });
    document.getElementById('tab-campaign').addEventListener('click', function () { select('campaign', true); });
    document.getElementById('tab-gangs').addEventListener('click', function () { select('gangs', true); });

    var fromHash = window.location.hash.replace(/^#/, '');
    if (fromHash) select(fromHash, false);

    window.addEventListener('hashchange', function () {
      select(window.location.hash.replace(/^#/, ''), false);
    });
  }

  fetch('data/campaign.json', { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(boot)
    .catch(function (err) {
      var box = h('div', 'error', 'Could not load data/campaign.json — ' + err.message);
      document.body.insertBefore(box, document.querySelector('.layout'));
    });
})();
