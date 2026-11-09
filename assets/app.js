/* The Hollow Reach — read-only campaign map.
   Reads data/campaign.json and renders the sector, standings and battle log.
   No build step, no dependencies. */

(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var NEUTRAL = '#2a2420';

  var state = { data: null, byId: {}, gangsById: {}, selected: null };

  /* ---------- helpers ---------- */

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

  /* Deterministic PRNG so a territory's outline never changes between loads. */
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

  /* Organic closed outline: jittered ring smoothed with quadratic midpoints. */
  function blobPath(cx, cy, r, seed) {
    var rand = mulberry32(seed || 1);
    var steps = 11;
    var pts = [];
    for (var i = 0; i < steps; i++) {
      var ang = (i / steps) * Math.PI * 2 + rand() * 0.18;
      var rad = r * (0.80 + rand() * 0.34);
      pts.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad * 0.88]);
    }
    var mid = function (a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
    var start = mid(pts[pts.length - 1], pts[0]);
    var d = 'M' + start[0].toFixed(1) + ' ' + start[1].toFixed(1);
    for (var j = 0; j < pts.length; j++) {
      var cur = pts[j];
      var next = pts[(j + 1) % pts.length];
      var m = mid(cur, next);
      d += ' Q' + cur[0].toFixed(1) + ' ' + cur[1].toFixed(1) +
           ' ' + m[0].toFixed(1) + ' ' + m[1].toFixed(1);
    }
    return d + ' Z';
  }

  function ownerOf(t) { return t.owner ? state.gangsById[t.owner] : null; }

  function fillFor(t) {
    var g = ownerOf(t);
    return g ? g.color : NEUTRAL;
  }

  /* ---------- map ---------- */

  function drawMap() {
    var links = document.getElementById('layer-links');
    var zones = document.getElementById('layer-zones');
    var labels = document.getElementById('layer-labels');
    links.textContent = ''; zones.textContent = ''; labels.textContent = '';

    var seen = {};
    state.data.territories.forEach(function (t) {
      (t.links || []).forEach(function (otherId) {
        var o = state.byId[otherId];
        if (!o) return;
        var key = [t.id, otherId].sort().join('~');
        if (seen[key]) return;
        seen[key] = true;
        links.appendChild(el('line', {
          x1: t.x, y1: t.y, x2: o.x, y2: o.y, class: 'link-line'
        }));
      });
    });

    state.data.territories.forEach(function (t) {
      var g = ownerOf(t);
      var group = el('g', {
        class: 'zone',
        'data-id': t.id,
        tabindex: '0',
        role: 'button',
        'aria-label': t.name + ', ' + (g ? 'held by ' + g.name : 'unclaimed')
      });

      group.appendChild(el('path', {
        d: blobPath(t.x, t.y, t.r || 72, t.seed),
        class: 'zone-shape',
        fill: fillFor(t),
        'fill-opacity': g ? 0.62 : 1
      }));

      if (t.contested) {
        group.appendChild(el('path', {
          d: blobPath(t.x, t.y, t.r || 72, t.seed),
          class: 'zone-overlay',
          fill: 'url(#hatch-contested)',
          stroke: 'none'
        }));
      }

      group.addEventListener('click', function () { select(t.id, true); });
      group.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(t.id, true); }
      });

      zones.appendChild(group);

      labels.appendChild(el('text', { x: t.x, y: t.y - 2, class: 'zone-name' }, t.name));
      labels.appendChild(el('text', { x: t.x, y: t.y + 15, class: 'zone-owner' },
        g ? (g.short || g.house.replace(/^House /, '')) : 'unclaimed'));
    });
  }

  function drawLegend() {
    var ul = document.getElementById('legend');
    ul.textContent = '';
    state.data.gangs.forEach(function (g) {
      var li = h('li');
      var sw = h('span', 'swatch');
      sw.style.background = g.color;
      li.appendChild(sw);
      li.appendChild(h('span', null, g.name));
      ul.appendChild(li);
    });

    var nli = h('li');
    var nsw = h('span', 'swatch');
    nsw.style.background = NEUTRAL;
    nli.appendChild(nsw);
    nli.appendChild(h('span', null, 'Unclaimed'));
    ul.appendChild(nli);

    var cli = h('li');
    var csw = h('span', 'swatch');
    csw.style.background = 'repeating-linear-gradient(45deg, #f0d060 0 3px, transparent 3px 7px)';
    cli.appendChild(csw);
    cli.appendChild(h('span', null, 'Contested'));
    ul.appendChild(cli);
  }

  /* ---------- selection + detail ---------- */

  function select(id, updateHash) {
    var t = state.byId[id];
    if (!t) return;
    state.selected = id;

    Array.prototype.forEach.call(document.querySelectorAll('.zone'), function (z) {
      z.classList.toggle('is-selected', z.getAttribute('data-id') === id);
    });

    renderDetail(t);
    if (updateHash && window.location.hash !== '#' + id) {
      history.replaceState(null, '', '#' + id);
    }
  }

  function renderDetail(t) {
    var g = ownerOf(t);
    var box = document.getElementById('detail');
    box.textContent = '';

    var head = h('div', 'detail-head');
    head.appendChild(h('h3', null, t.name));
    head.appendChild(h('span', 'tag', t.type));
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

    var dl = h('dl', 'kv');
    [['Income', t.income], ['Boon', t.boon]].forEach(function (pair) {
      if (!pair[1]) return;
      var row = h('div');
      row.appendChild(h('dt', null, pair[0]));
      row.appendChild(h('dd', null, pair[1]));
      dl.appendChild(row);
    });
    box.appendChild(dl);

    var history_ = (state.data.battles || []).filter(function (b) { return b.territory === t.id; });
    if (history_.length) {
      var last = history_[history_.length - 1];
      var w = last.winner ? state.gangsById[last.winner] : null;
      var row2 = h('div');
      row2.appendChild(h('dt', null, 'Last battle'));
      row2.appendChild(h('dd', null, last.scenario + ' — ' + (w ? w.name + ' took it' : 'no decisive result')));
      dl.appendChild(row2);
    }

    if (t.notes) box.appendChild(h('p', 'notes', t.notes));

    if ((t.links || []).length) {
      var nav = h('div', 'neighbours');
      t.links.forEach(function (nid) {
        var n = state.byId[nid];
        if (!n) return;
        var b = h('button', 'neighbour-btn', n.name);
        b.type = 'button';
        b.addEventListener('click', function () { select(nid, true); });
        nav.appendChild(b);
      });
      box.appendChild(nav);
    }
  }

  /* ---------- standings ---------- */

  function drawStandings() {
    var counts = {};
    state.data.gangs.forEach(function (g) { counts[g.id] = 0; });
    var neutral = 0;
    state.data.territories.forEach(function (t) {
      if (t.owner && counts.hasOwnProperty(t.owner)) counts[t.owner]++;
      else if (!t.owner) neutral++;
    });

    var sorted = state.data.gangs.slice().sort(function (a, b) {
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
      if (g.player) stack.appendChild(h('div', 'gang-player', g.player));
      cell.appendChild(stack);
      td1.appendChild(cell);
      tr.appendChild(td1);

      tr.appendChild(h('td', 'num', String(counts[g.id])));
      tr.appendChild(h('td', 'num', g.rating != null ? String(g.rating) : '—'));
      tr.appendChild(h('td', 'num', g.reputation != null ? String(g.reputation) : '—'));
      body.appendChild(tr);
    });

    document.getElementById('neutral-count').textContent =
      neutral + ' of ' + state.data.territories.length + ' territories still unclaimed.';
  }

  /* ---------- battle log ---------- */

  function drawBattles() {
    var list = document.getElementById('battle-log');
    list.textContent = '';
    var battles = (state.data.battles || []).slice().reverse();

    if (!battles.length) {
      list.appendChild(h('li', null, 'No battles fought yet.'));
      return;
    }

    battles.forEach(function (b) {
      var li = h('li');
      var head = h('div', 'battle-head');
      head.appendChild(h('span', 'battle-date', b.date || ''));
      head.appendChild(h('span', 'battle-scenario', b.scenario || 'Battle'));
      li.appendChild(head);

      var names = (b.participants || []).map(function (id) {
        var g = state.gangsById[id];
        return g ? g.name : id;
      }).join(' vs ');

      var p = h('p', 'battle-body');
      p.appendChild(h('span', null, names));
      var w = b.winner ? state.gangsById[b.winner] : null;
      p.appendChild(h('span', null, ' — '));
      p.appendChild(h('span', 'win', w ? w.name + ' won' : 'no decisive result'));

      var terr = b.territory ? state.byId[b.territory] : null;
      if (terr) {
        p.appendChild(h('span', null, ' over '));
        var a = document.createElement('a');
        a.href = '#' + terr.id;
        a.textContent = terr.name;
        a.style.color = 'inherit';
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
    (data.territories || []).forEach(function (t) { state.byId[t.id] = t; });
    (data.gangs || []).forEach(function (g) { state.gangsById[g.id] = g; });

    drawHeader();
    drawMap();
    drawLegend();
    drawStandings();
    drawBattles();

    var fromHash = window.location.hash.replace(/^#/, '');
    if (fromHash && state.byId[fromHash]) select(fromHash, false);

    window.addEventListener('hashchange', function () {
      var id = window.location.hash.replace(/^#/, '');
      if (id && state.byId[id]) select(id, false);
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
