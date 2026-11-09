/* The Hollow Reach — read-only campaign map.
   Reads data/campaign.json and renders the sector as filled territories
   sharing borders, plus standings, the uncharted deep and the battle log.
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

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashStr(s) {
    var hsh = 2166136261;
    for (var i = 0; i < s.length; i++) {
      hsh ^= s.charCodeAt(i);
      hsh = Math.imul(hsh, 16777619);
    }
    return hsh >>> 0;
  }

  var ptKey = function (p) { return p[0].toFixed(2) + ',' + p[1].toFixed(2); };

  /* A border is drawn identically by both territories that share it:
     the wiggle is seeded from the edge itself and tapers to zero at each
     vertex, so neighbouring regions never show a seam. */
  function wiggledEdge(a, b) {
    var ka = ptKey(a), kb = ptKey(b);
    var flip = ka > kb;
    var p0 = flip ? b : a, p1 = flip ? a : b;
    var rand = mulberry32(hashStr(flip ? kb + '|' + ka : ka + '|' + kb));
    var dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len, ny = dx / len;
    var amp = Math.min(13, len * 0.09);
    var steps = 7;
    var pts = [];
    for (var s = 1; s < steps; s++) {
      var t = s / steps;
      var off = (rand() - 0.5) * 2 * amp * Math.sin(Math.PI * t);
      pts.push([p0[0] + dx * t + nx * off, p0[1] + dy * t + ny * off]);
    }
    return flip ? pts.reverse() : pts;
  }

  function polygonPath(poly) {
    if (!poly || poly.length < 3) return '';
    var d = 'M' + poly[0][0].toFixed(1) + ' ' + poly[0][1].toFixed(1);
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      var mids = wiggledEdge(a, b);
      for (var j = 0; j < mids.length; j++) {
        d += ' L' + mids[j][0].toFixed(1) + ' ' + mids[j][1].toFixed(1);
      }
      d += ' L' + b[0].toFixed(1) + ' ' + b[1].toFixed(1);
    }
    return d + ' Z';
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
    var gLand = document.getElementById('layer-land');
    var gInner = document.getElementById('layer-inner');
    var gGates = document.getElementById('layer-gateways');
    var gLabels = document.getElementById('layer-labels');
    [gBound, gLand, gInner, gGates, gLabels].forEach(function (n) { n.textContent = ''; });

    /* sector outline, sitting under everything as a faint coastline */
    if (map.boundary) {
      gBound.appendChild(el('path', {
        d: polygonPath(map.boundary),
        class: 'sector-outline'
      }));
    }

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

    /* the uncharted core: border mapped, interior not */
    var inner = map.inner;
    if (inner && inner.polygon) {
      var ig = el('g', {
        class: 'inner-region',
        'data-id': 'uncharted',
        tabindex: '0',
        role: 'button',
        'aria-label': inner.label + ', unsurveyed'
      });
      var innerD = polygonPath(inner.polygon);
      ig.appendChild(el('path', { d: innerD, class: 'inner-fill' }));
      ig.appendChild(el('path', { d: innerD, class: 'inner-fog' }));
      ig.appendChild(el('path', { d: innerD, class: 'inner-edge' }));
      ig.addEventListener('click', function () { select('uncharted', true); });
      ig.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select('uncharted', true); }
      });
      gInner.appendChild(ig);

      var n = innerTerritories().length;
      gLabels.appendChild(el('text', {
        x: inner.labelX, y: inner.labelY - 10, class: 'inner-label'
      }, inner.label.toUpperCase()));
      gLabels.appendChild(el('text', {
        x: inner.labelX, y: inner.labelY + 16, class: 'inner-sub'
      }, n + ' holdings · unsurveyed'));
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

      (gw.from || []).forEach(function (fromId) {
        var f = state.byId[fromId];
        if (!f) return;
        group.appendChild(el('line', {
          x1: f.labelX, y1: f.labelY, x2: gw.x, y2: gw.y, class: 'gateway-link'
        }));
      });

      group.appendChild(el('path', { d: diamond(gw.x, gw.y, 13), class: 'gateway-mark' }));
      group.addEventListener('click', function () { select(gw.id, true); });
      group.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(gw.id, true); }
      });
      gGates.appendChild(group);

      /* Push the label inward over the fog, where nothing else is written —
         below the marker it collides with the marches territory names. */
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
    state.selected = id;

    Array.prototype.forEach.call(
      document.querySelectorAll('.territory, .inner-region, .gateway'),
      function (n) { n.classList.toggle('is-selected', n.getAttribute('data-id') === id); }
    );
    Array.prototype.forEach.call(document.querySelectorAll('.roster-btn'), function (n) {
      n.classList.toggle('is-selected', n.getAttribute('data-id') === id);
    });

    if (id === 'uncharted') renderInnerRegionDetail();
    else if (state.gatewaysById[id]) renderGatewayDetail(state.gatewaysById[id]);
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
        'Nothing is known about this holding beyond that it exists. Its ground, its worth and whatever is already living in it get written down the first time a gang walks it.'));
      return;
    }

    var dl = kvList([['Income', t.income], ['Boon', t.boon]]);

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

    var nav = h('div', 'neighbours');
    (t.links || []).forEach(function (nid) {
      var n = state.byId[nid];
      if (!n) return;
      nav.appendChild(linkBtn(n.id, displayName(n)));
    });
    if (t.bordersInner) nav.appendChild(linkBtn('uncharted', 'Uncharted Deep'));
    if (nav.childNodes.length) box.appendChild(nav);
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

  /* ---------- uncharted roster ---------- */

  function drawRoster() {
    var card = document.getElementById('uncharted-card');
    var inner = (state.data.map || {}).inner || {};
    card.textContent = '';

    card.appendChild(h('h2', null, inner.label || 'Uncharted Deep'));
    if (inner.blurb) card.appendChild(h('p', 'hint roster-blurb', inner.blurb));

    var ways = h('div', 'neighbours');
    (state.data.gateways || []).forEach(function (gw) {
      var b = linkBtn(gw.id, gw.name);
      if (gw.contested) b.classList.add('is-disputed');
      ways.appendChild(b);
    });
    card.appendChild(ways);

    var grid = h('div', 'roster');
    innerTerritories().forEach(function (t) {
      var b = h('button', 'roster-btn', t.designation || t.id);
      b.type = 'button';
      b.setAttribute('data-id', t.id);
      b.title = 'Unsurveyed';
      b.addEventListener('click', function () { select(t.id, true); });
      grid.appendChild(b);
    });
    card.appendChild(grid);
  }

  /* ---------- battle log ---------- */

  function drawBattles() {
    var list = document.getElementById('battle-log');
    list.textContent = '';
    var battles = (state.data.battles || []).slice().reverse();

    if (!battles.length) {
      list.appendChild(h('li', 'hint', 'No battles fought yet.'));
      return;
    }

    battles.forEach(function (b) {
      var li = h('li');
      var head = h('div', 'battle-head');
      head.appendChild(h('span', 'battle-date', b.date || ''));
      head.appendChild(h('span', 'battle-scenario', b.scenario || 'Battle'));
      li.appendChild(head);

      var names = (b.participants || []).map(function (id) {
        var g = gangOf(id);
        return g ? g.name : 'Unknown';
      }).join(' vs ');

      var p = h('p', 'battle-body');
      p.appendChild(h('span', null, names));
      var w = b.winner ? gangOf(b.winner) : null;
      p.appendChild(h('span', null, ' — '));
      p.appendChild(h('span', 'win', w ? w.name + ' won' : 'no decisive result'));

      var terr = b.territory ? state.byId[b.territory] : null;
      if (terr) {
        p.appendChild(h('span', null, ' over '));
        var a = document.createElement('a');
        a.href = '#' + terr.id;
        a.textContent = displayName(terr);
        a.className = 'battle-link';
        a.addEventListener('click', function () { select(terr.id, true); });
        p.appendChild(a);
      }
      li.appendChild(p);

      if (b.summary) li.appendChild(h('p', 'battle-body', b.summary));
      list.appendChild(li);
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
    document.getElementById('meta-phase').textContent = c.phase || '—';
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

    drawHeader();
    drawMap();
    drawStandings();
    drawRoster();
    drawBattles();

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
