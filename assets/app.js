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

  /* Every gang comes into the campaign on one reputation. */
  var BASE_REP = 1;

  function visibleGangs() {
    return (state.data.gangs || []).filter(function (g) { return !g.hidden; });
  }

  /* Reputation is what the Reach plays for, so it orders every list of
     gangs on the site. Name breaks the tie, which keeps the order steady
     between loads instead of leaving it to the data file. */
  function byRep(a, b) {
    return (repOf(b) - repOf(a)) ||
           (a.name || '').localeCompare(b.name || '');
  }

  function outerTerritories() {
    return (state.data.territories || []).filter(function (t) { return t.section === 'outer'; });
  }

  function innerTerritories() {
    return (state.data.territories || []).filter(function (t) { return t.section === 'inner'; });
  }

  /* An expedition names a deep holding before anyone has walked it, so the
     map has to say which cells are spoken for. A settled one drops off the
     map: the mark is about what is still to be fought over. */
  function expeditionsOn(id) {
    return (state.data.challenges || []).filter(function (c) {
      return c.kind === 'expedition' && c.target === id &&
             (c.status || 'open') !== 'settled';
    });
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

    /* The fog and the glow are the deep being unknown. A holding somebody
       has walked is known, so they are cut out around it: the region path
       carries each charted cell as a second sub-path and the even-odd rule
       turns them into holes. The cells lie wholly inside the region and
       never overlap, so the holes come out clean. */
    var chartedD = innerTerritories()
      .filter(function (t) { return t.surveyed && t.polygon; })
      .map(function (t) { return polygonPath(t.polygon); })
      .join(' ');
    var fogD = innerD ? innerD + (chartedD ? ' ' + chartedD : '') : null;

    if (innerD) {
      gInner.appendChild(el('path', {
        d: fogD, class: 'inner-fill', 'fill-rule': 'evenodd'
      }));
    }

    innerTerritories().forEach(function (t) {
      if (!t.polygon) return;
      var g = ownerOf(t);
      var bids = expeditionsOn(t.id);
      var bidder = bids.length ? gangOf(bids[0].challenger) : null;
      var group = el('g', {
        class: 'territory is-deep' + (bids.length ? ' is-target' : ''),
        'data-id': t.id,
        tabindex: '0',
        role: 'button',
        'aria-label': displayName(t) + (t.surveyed ? ', walked' : ', unsurveyed') +
          (bids.length ? ', expedition target' : '')
      });

      /* A hover tooltip, because the coloured outline alone does not say
         whose expedition it is. */
      if (bids.length) {
        group.appendChild(el('title', {}, bids.map(function (c) {
          var ch = gangOf(c.challenger), df = gangOf(c.defender);
          return 'Expedition: ' + (ch ? ch.name : c.challenger) +
                 (df ? ' against ' + df.name : ', nobody paired with it yet');
        }).join('\n')));
      }

      /* Held: the gang's colour. Walked but unheld: the same brown the
         charted ring uses for ground nobody has claimed, so the two read
         alike. Never walked: the dark the stylesheet gives it. */
      /* Walked ground is drawn with the charted ring's class, so a holding
         nobody holds looks the same whichever side of the border it is on.
         Only ground nobody has walked keeps the deep's dark. */
      group.appendChild(el('path', {
        d: polygonPath(t.polygon),
        class: t.surveyed ? 'territory-shape' : 'deep-shape',
        fill: g ? g.color : (t.surveyed ? NEUTRAL : null),
        'fill-opacity': g ? (t.surveyed ? 0.55 : 0.5) : (t.surveyed ? 1 : null)
      }));

      group.addEventListener('click', function () { select(t.id, true); });
      group.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(t.id, true); }
      });
      gInner.appendChild(group);

      /* The outline goes in the label layer so it sits over the fog; in
         the cell layer the fog would wash it out. */
      if (bids.length) {
        gLabels.appendChild(el('path', {
          d: polygonPath(t.polygon),
          class: 'deep-target',
          stroke: bidder ? bidder.color : 'var(--warn)'
        }));
      }

      gLabels.appendChild(el('text', {
        x: t.labelX, y: t.labelY - 1,
        class: 'deep-name' + (t.surveyed ? ' is-walked' : '')
      }, t.surveyed && t.name ? t.name : (t.designation || t.id)));
      var subY = t.labelY + 14;
      if (g) {
        gLabels.appendChild(el('text', {
          x: t.labelX, y: subY, class: 'deep-sub'
        }, g.short || g.house));
        subY += 13;
      }
      if (bids.length) {
        gLabels.appendChild(el('text', {
          x: t.labelX, y: subY, class: 'deep-bid',
          fill: bidder ? bidder.color : 'var(--warn)'
        }, bids.length > 1 ? bids.length + ' expeditions'
                           : '\u25b8 ' + (bidder ? (bidder.short || bidder.house) : 'expedition')));
      }
    });

    if (innerD) {
      gInner.appendChild(el('path', {
        d: fogD, class: 'inner-fog', 'fill-rule': 'evenodd'
      }));
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
    if (id === 'campaign' || id === 'gangs' || id === 'heroes' || id === 'archeotech') {
      showTab(id);
      if (id === 'heroes') drawHeroes();
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
    if (t.type && !t.settlement) head.appendChild(h('span', 'tag', t.type));
    if (t.settlement) head.appendChild(h('span', 'tag settlement', 'Stronghold'));
    if (t.section === 'inner' && !t.surveyed) {
      head.appendChild(h('span', 'tag unsurveyed', 'Unsurveyed'));
    }
    if (t.section === 'inner' && t.surveyed) {
      head.appendChild(h('span', 'tag deep-tag', 'In the deep'));
      if (!t.owner) head.appendChild(h('span', 'tag is-open', 'Open to a call'));
    }
    if (t.section === 'inner' && expeditionsOn(t.id).length) {
      head.appendChild(h('span', 'tag target', 'Expedition target'));
    }
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

    if (t.section === 'inner' && !t.surveyed) {
      box.appendChild(h('p', 'notes',
        'The ground is charted and nothing else is. What this holding is, what it is worth and whatever already lives in it all get written down the first time a gang walks it.'));
      expeditionsOn(t.id).forEach(function (c) {
        var ch = gangOf(c.challenger), df = gangOf(c.defender);
        box.appendChild(h('p', 'notes is-bid',
          (ch ? ch.name : c.challenger) + ' are going down for it' +
          (c.cycle != null ? ' in cycle ' + c.cycle : '') + '. ' +
          (df ? (df.name + ' drew the defence.') : 'Nobody paired with it yet.')));
      });
      box.appendChild(neighbourNav(t));
      return;
    }

    var dl = kvList([
      ['Income', incomeText(t)],
      ['Boon', t.boon],
      ['Standing', t.standing],
      ['Battlefield effect', t.effect]
    ]);

    var fought = (state.data.battles || []).filter(function (b) { return b.territory === t.id; });
    if (fought.length) {
      var last = fought[fought.length - 1];
      var w = last.winner ? gangOf(last.winner) : null;
      var row = h('div');
      row.appendChild(h('dt', null, 'Last result'));
      row.appendChild(h('dd', null, last.scenario + ' — ' +
        (w ? w.name + (t.section === 'inner' ? ' charted it' : ' took it')
           : 'no decisive result')));
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
    var spoken = list.filter(function (t) { return expeditionsOn(t.id).length; });
    box.appendChild(kvList([
      ['Holdings', (function () {
        var walked = list.filter(function (t) { return t.surveyed; });
        return list.length + ' known to exist, ' +
               (walked.length
                 ? walked.length + ' charted: ' +
                   walked.map(function (t) { return displayName(t); }).join(', ')
                 : 'none surveyed');
      })()],
      ['Ways in', (state.data.gateways || []).length + ' found so far'],
      ['Spoken for', spoken.length
        ? spoken.map(function (t) { return t.designation || t.id; }).join(', ') +
          ' \u2014 expeditions named them this cycle'
        : null]
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

    /* Reputation leads; ground held and rating break the tie before the
       name does. */
    var sorted = visibleGangs().slice().sort(function (a, b) {
      return (repOf(b) - repOf(a)) ||
             (counts[b.id] - counts[a.id]) ||
             ((b.rating || 0) - (a.rating || 0)) ||
             (a.name || '').localeCompare(b.name || '');
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
      tr.appendChild(h('td', 'num', String(repOf(g))));
      body.appendChild(tr);
    });

    document.getElementById('neutral-count').textContent =
      unclaimedOuter + ' of ' + outerTerritories().length +
      ' charted territories unclaimed · ' +
      innerTerritories().filter(function (t) { return !t.surveyed; }).length +
      ' deep holdings unsurveyed.';
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

  /* How a moment in the campaign is named: the cycle, and the phase that
     cycle falls in. Nothing the players read is dated by the calendar. */
  function whenOf(cycle) {
    if (cycle == null) return { cycle: null, phase: null, label: 'Before the log' };
    var p = phaseOfCycle(cycle);
    return {
      cycle: cycle,
      phase: p ? p.name.replace(/ Phase$/, '') : null,
      label: 'Cycle ' + cycle + (p ? ' \u00b7 ' + p.name.replace(/ Phase$/, '') : '')
    };
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

    /* The cycle reads left to right: what was called, and what that adds
       up to per gang. Side by side because they are the same question
       asked two ways, and because the count is short. */
    var cols = h('div', 'cycle-cols');
    cols.appendChild(renderSlate());
    cols.appendChild(renderTally());
    host.appendChild(cols);
    host.appendChild(renderLog());

    var foot = h('p', 'hint plan-hint',
      'Each player may issue one challenge per cycle, and the arbitrator may allow another ' +
      'when a cycle runs light. The arbitrator moves the campaign on by ' +
      'raising "cycle" in data/campaign.json.');
    host.appendChild(foot);
  }

  /* The cycle at a glance: every challenge called, in the order it was
     issued, which is the order they resolve in. Settled ones keep their
     place and carry their result, so the run of the cycle reads top to
     bottom without opening the log underneath.

     An expedition names the holding it was nominated for. The designation
     is all anyone gets — the map already lets you click any deep tile and
     read it, and nothing is known about what is in one until a gang walks
     it. Two expeditions nominating neighbours is the interesting part, and
     it only reads that way if the board is on the table. */
  /* What to call a battle out loud: what was played, and where. The id is
     for the data; this is for the page. */
  function battleName(b) {
    if (!b) return 'a battle';
    var t = b.territory ? state.byId[b.territory] : null;
    return (b.scenario || 'Battle') + (t ? ' at ' + displayName(t) : '');
  }

  /* Jump to that battle in the log, wherever the reader is. */
  function goToLog(id) {
    showTab('campaign');
    var row = document.getElementById('log-' + id);
    if (!row) return;
    if (row.scrollIntoView) row.scrollIntoView({ block: 'center' });
    row.classList.remove('is-flash');
    /* reading offsetWidth restarts the animation on a second click */
    void row.offsetWidth;
    row.classList.add('is-flash');
  }

  function logLink(b) {
    var btn = h('button', 'log-link', battleName(b));
    btn.type = 'button';
    btn.addEventListener('click', function () { goToLog(b.id); });
    return btn;
  }

  function battleOf(id) {
    var found = (state.data.battles || []).filter(function (b) { return b.id === id; });
    return found.length ? found[0] : null;
  }

  /* A gang as it reads in a title: its colour, then its short name, both
     at the same weight as the other side of the fight. */
  function gangSide(id) {
    var g = gangOf(id);
    var side = h('span', 'slate-side');
    if (g) {
      var sw = h('span', 'swatch');
      sw.style.background = g.color;
      side.appendChild(sw);
    }
    side.appendChild(h('strong', null, g ? (g.short || g.name) : id));
    return side;
  }

  function renderSlate() {
    var cycle = (state.data.campaign || {}).cycle;
    var called = (state.data.challenges || []).filter(function (c) {
      return c.cycle == null || c.cycle === cycle;
    });

    var wrap = h('section', 'slate');
    if (!called.length) {
      wrap.appendChild(h('p', 'hint', 'Nothing called yet this cycle.'));
      return wrap;
    }

    var list = h('ol', 'slate-list');
    called.forEach(function (c, i) {
      var done = (c.status || 'open') === 'settled';
      var row = h('li', 'slate-row' + (done ? ' is-done' : ''));
      row.appendChild(h('span', 'slate-no', String(i + 1)));

      var body = h('div', 'slate-body');
      var what = h('p', 'slate-what');

      what.appendChild(gangSide(c.challenger));
      what.appendChild(h('span', 'slate-v', 'v'));
      what.appendChild(c.defender ? gangSide(c.defender)
                                  : h('span', 'slate-side is-waiting', 'nobody yet'));

      var stake = state.byId[c.kind === 'expedition' ? c.target : c.territory];
      what.appendChild(h('span', 'slate-at', 'at'));
      if (stake) {
        var where = linkBtn(stake.id, displayName(stake));
        where.classList.add('slate-where');
        what.appendChild(where);
      } else {
        what.appendChild(h('span', 'slate-side is-waiting',
          c.kind === 'expedition' ? 'the deep' : 'ground off the map'));
      }
      body.appendChild(what);

      var under = done ? outcomeOf(c) : standingOf(c);
      if (under) body.appendChild(h('p', 'slate-who', under));
      if (c.notes) body.appendChild(h('p', 'slate-note', c.notes));

      row.appendChild(body);
      row.appendChild(h('span', 'tag ' + (done ? 'is-done' : 'is-open'),
                        done ? 'Settled' : 'Outstanding'));
      list.appendChild(row);
    });

    wrap.appendChild(list);
    return wrap;
  }

  /* The line under the title, where there is one to add. The title already
     names both gangs and the ground, so this only speaks when it says
     something the title cannot: how two gangs came to be in the same part
     of the deep, or that nobody has been put opposite this one yet. */
  function standingOf(c) {
    var d = c.defender ? gangOf(c.defender) : null;
    if (!d) {
      return c.kind === 'expedition' ? 'Nobody paired with it yet'
                                     : 'Defender to be decided';
    }
    return c.kind === 'expedition' ? 'Stumbles into ' + (d.short || d.name) : null;
  }

  /* How it went, read off the log entry the challenge points at. */
  function outcomeOf(c) {
    var b = c.battle ? battleOf(c.battle) : null;
    if (!b) return 'Settled';
    var w = b.winner ? gangOf(b.winner) : null;
    var head = b.scenario ? b.scenario + ' \u2014 ' : '';
    return head + (w ? (w.short || w.name) + ' took it' : 'no decisive result');
  }

  /* ---------- what is down there ----------

     The pool an expedition can come back up with. A piece that has been
     found says who holds it; the rest are still in the dark, and the page
     does not say which tile any of them is under, because nobody knows
     until a gang walks it. */
  function profileLine(p) {
    if (!p) return null;
    var bits = [];
    if (p.range) bits.push(p.range);
    if (p.str) bits.push(p.str);
    if (p.ap) bits.push('AP' + p.ap);
    if (p.lethality != null) bits.push('L' + p.lethality);
    return bits.join('  \u00b7  ');
  }

  function drawRelics() {
    var host = document.getElementById('panel-archeotech');
    host.textContent = '';
    var pool = state.data.archeotech || [];

    var head = h('div', 'plan-head');
    head.appendChild(h('h2', null, 'Archeotech of the deep'));
    var found = pool.filter(function (r) { return r.holder; }).length;
    var worth = pool.reduce(function (n, r) { return n + (r.value || 0); }, 0);
    head.appendChild(h('p', 'plan-where',
      pool.length + ' pieces catalogued, eleven of them on a 2d6 table \u2014 ' +
      (found ? found + ' recovered, ' + (pool.length - found) + ' still down there'
             : 'none recovered yet') +
      (worth ? '. ' + worth + ' credits of it in all.' : '')));
    host.appendChild(head);

    var wrap = h('section', 'relics');
    if (!pool.length) {
      host.appendChild(h('p', 'detail-empty', 'Nothing catalogued yet.'));
      return;
    }

    wrap.appendChild(h('p', 'relics-intro',
      'An expedition that wins its fight rolls 2d6 and comes back up with ' +
      'what the dice say. The curve is the point: a 7 is common and a 2 is ' +
      'once a campaign. Nothing says which holding any of it is under \u2014 ' +
      'nobody knows until somebody walks the ground.'));

    var grid = h('div', 'relic-grid');
    pool.slice().sort(function (x, y) {
      return (x.roll || 99) - (y.roll || 99);
    }).forEach(function (r) {
      var held = r.holder ? gangOf(r.holder) : null;
      var card = h('article', 'relic' + (held ? ' is-held' : ''));

      var head = h('div', 'relic-head');
      var pip = h('span', 'relic-roll' + (r.roll == null ? ' is-off' : ''),
                   r.roll == null ? '\u2014' : String(r.roll));
      pip.title = r.roll != null ? 'Rolled on 2d6'
                 : r.holder ? 'Off the table \u2014 somebody is carrying it'
                            : 'Not on the table \u2014 the arbitrator\'s to give';
      head.appendChild(pip);
      head.appendChild(h('h4', 'relic-name', r.name));
      if (r.kind) head.appendChild(h('span', 'tag relic-kind', r.kind));
      if (r.value != null) {
        var worthEl = h('span', 'relic-value', r.value + ' cr');
        worthEl.title = 'What it adds to a gang\u2019s rating, and what it would ' +
                        'fetch. Holding it does not put credits in the stash.';
        head.appendChild(worthEl);
      }
      card.appendChild(head);

      var line = profileLine(r.profile);
      if (line) card.appendChild(h('p', 'relic-stats', line));
      if (r.profile && (r.profile.traits || []).length) {
        card.appendChild(h('p', 'relic-traits', r.profile.traits.join(', ')));
      }
      if (r.effect) card.appendChild(h('p', 'relic-effect', r.effect));

      var who = h('p', 'relic-who');
      if (held) {
        var sw = h('span', 'swatch');
        sw.style.background = held.color;
        who.appendChild(sw);
        who.appendChild(document.createTextNode('Held by ' + (held.short || held.name)));
      } else {
        who.classList.add('is-lost');
        who.appendChild(document.createTextNode('Still down there'));
      }
      card.appendChild(who);

      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    host.appendChild(wrap);

    host.appendChild(h('p', 'hint plan-hint',
      'A piece moves to a gang by setting "holder" on it in data/campaign.json. ' +
      'Until then it reads as still down there, wherever there is.'));
  }

  /* ---------- the count, per cycle ----------

     Two numbers a gang can plan around: how many challenges they called,
     and how many games that leaves them holding dice for. Calling a fight
     and being called out are both games, so the second number counts a
     gang on either side of one.

     A challenge nobody turned up for was still called, so it counts in
     the first column and not the second: the log entry carries
     played: false and the count reads it off there rather than guessing
     from the scenario name. */
  function wasPlayed(c) {
    if ((c.status || 'open') !== 'settled') return true;   /* still to come */
    var b = c.battle ? battleOf(c.battle) : null;
    return !b || b.played !== false;
  }

  function cycleOf(c) {
    return c.cycle == null ? (state.data.campaign || {}).cycle : c.cycle;
  }

  /* Newest cycle first: the one being played is the one people are
     counting, and finished cycles stay underneath it. */
  function cyclesCalled() {
    var seen = [];
    (state.data.challenges || []).forEach(function (c) {
      var n = cycleOf(c);
      if (n != null && seen.indexOf(n) < 0) seen.push(n);
    });
    return seen.sort(function (x, y) { return y - x; });
  }

  function tallyFor(cycle) {
    var rows = {};
    function row(id) {
      if (!rows[id]) rows[id] = { id: id, called: 0, fights: 0, done: 0 };
      return rows[id];
    }
    (state.data.challenges || []).forEach(function (c) {
      if (cycleOf(c) !== cycle) return;
      row(c.challenger).called++;
      if (!wasPlayed(c)) return;
      var settled = (c.status || 'open') === 'settled';
      [c.challenger, c.defender].forEach(function (id) {
        if (!id) return;
        var r = row(id);
        r.fights++;
        if (settled) r.done++;
      });
    });
    return visibleGangs().map(function (gang) {
      var r = rows[gang.id] || { id: gang.id, called: 0, fights: 0, done: 0 };
      r.gang = gang;
      return r;
    }).sort(function (x, y) {
      return byRep(x.gang, y.gang) || (y.fights - x.fights) || (y.called - x.called);
    });
  }

  function renderTally() {
    var wrap = h('section', 'tally');
    var cycles = cyclesCalled();
    if (!cycles.length) return wrap;

    cycles.forEach(function (n) {
      wrap.appendChild(h('h3', 'tally-head', 'Cycle ' + n + ' \u2014 games each gang has'));

      var table = h('table', 'tally-table');
      var head = h('tr', 'tally-row is-head');
      head.appendChild(h('th', 'tally-gang', 'Gang'));
      head.appendChild(h('th', 'tally-num', 'Called'));
      head.appendChild(h('th', 'tally-num', 'Games'));
      var thead = h('thead'); thead.appendChild(head);
      table.appendChild(thead);

      var body = h('tbody');
      tallyFor(n).forEach(function (r) {
        var tr = h('tr', 'tally-row' + (r.fights ? '' : ' is-idle'));

        var who = h('td', 'tally-gang');
        var sw = h('span', 'swatch');
        sw.style.background = r.gang.color;
        who.appendChild(sw);
        who.appendChild(document.createTextNode(r.gang.short || r.gang.name));
        tr.appendChild(who);

        tr.appendChild(h('td', 'tally-num', String(r.called)));

        /* Played out of booked, as one figure. "2/3" reads faster than
           "3 (2 played)" and keeps the column a column. */
        var left = r.fights - r.done;
        var games = h('td', 'tally-num' + (r.fights && !left ? ' is-complete' : ''),
                      r.fights ? r.done + '/' + r.fights : '0');
        if (r.fights) {
          games.title = left ? r.done + ' played, ' + left + ' still to fight'
                             : 'All ' + r.fights + ' played';
        }
        tr.appendChild(games);

        body.appendChild(tr);
      });
      table.appendChild(body);
      wrap.appendChild(table);
    });

    wrap.appendChild(h('p', 'tally-foot',
      'Called: challenges and expeditions a gang issued. Games: how many of ' +
      'the fights they are in, on either side, have actually been played. A ' +
      'declined challenge was called, but nobody played it.'));
    return wrap;
  }

  /* The log, under the phase track. Brief on purpose: when, what, who,
     and who walked away with the ground. Newest first, because the thing
     that just happened is the thing anyone is here to read.

     The territory is a button into the map rather than a name repeated,
     and it goes through displayName, so a fight in the deep is logged
     without naming a holding nobody has surveyed. */
  function logDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return s || '';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return Number(m[3]) + ' ' + months[Number(m[2]) - 1];
  }

  /* One gang's record of one battle. Credits, reputation and experience
     first, then what it cost in bodies, then anything that came back with
     them. A side with nothing written down yet says so rather than
     pretending the game was bloodless. */
  /* One fighter's share of one game. The line says what they earned and
     what it cost them; why they earned it is in the tooltip, because the
     reasons are the same five phrases over and over and the numbers are
     what anybody is reading for. */
  function crewLine(f) {
    var li = h('li', 'crew' + (f.outOfAction ? ' is-down' : ''));

    var why = [];
    if (f.xpFor) why.push(f.xpFor);
    if (f.note) why.push(f.note);
    if (why.length) li.title = why.join(' ');

    var top = h('p', 'crew-head');
    top.appendChild(h('span', 'crew-name', f.fighter || 'A fighter'));
    if (f.xp != null) top.appendChild(h('span', 'crew-xp', f.xp + ' XP'));
    li.appendChild(top);

    var hurt = [];
    if (f.outOfAction) hurt.push('out of action');
    if (f.injury) hurt.push(f.injury);
    if (hurt.length) li.appendChild(h('p', 'crew-hurt', hurt.join(', ')));
    return li;
  }

  function recordLine(r, b) {
    var row = h('div', 'log-paid');
    var side = h('span', 'log-paid-one');
    var gg = gangOf(r.gang);
    if (gg) {
      var sw = h('span', 'swatch');
      sw.style.background = gg.color;
      side.appendChild(sw);
    }
    side.appendChild(h('span', 'log-paid-who', gg ? (gg.short || gg.name) : r.gang));

    var bits = [];
    PAYOUTS.forEach(function (kind) {
      if (r[kind[0]]) {
        bits.push(r[kind[0]] + ' cr' + (kind[1] ? ' ' + kind[1] : ''));
      }
    });
    if (r.rep) bits.push((r.rep > 0 ? '+' : '') + r.rep + ' rep');
    if (r.xp) bits.push(r.xp + ' XP');
    /* A nought is a result, not a blank: a gang that came through a game
       without losing anybody wants that written down. */
    if (r.takedowns != null) bits.push(r.takedowns ? r.takedowns + ' taken out' : 'none taken out');
    if (r.outOfAction != null) bits.push(r.outOfAction ? r.outOfAction + ' lost' : 'none lost');

    if (!bits.length) {
      side.appendChild(h('span', 'log-paid-none',
        b.played === false ? 'no game played' : 'nothing recorded yet'));
    } else {
      side.appendChild(h('span', 'log-paid-bits', bits.join('  \u00b7  ')));
    }
    row.appendChild(side);

    var extra = [];
    if ((r.gear || []).length) extra.push(r.gear.map(gearWords).join(
));
    if (r.notes) extra.push(r.notes);
    if (extra.length) row.appendChild(h('p', 'log-paid-extra', extra.join(' — ')));

    if ((r.fighters || []).length) {
      var crew = h('ul', 'crew-list');
      r.fighters.forEach(function (f) { crew.appendChild(crewLine(f)); });
      row.appendChild(crew);
    }
    return row;
  }

  function renderLog() {
    var wrap = h('section', 'log');
    wrap.appendChild(h('h3', 'log-head', 'The log'));

    var rows = (state.data.battles || []).slice().reverse();
    if (!rows.length) {
      wrap.appendChild(h('p', 'hint', 'Nothing settled yet. Results land here as they are called.'));
      return wrap;
    }

    var list = h('ol', 'log-list');
    rows.forEach(function (b) {
      var row = h('li', 'log-row');
      if (b.id) row.id = 'log-' + b.id;
      var when = whenOf(b.cycle);
      var stamp = h('span', 'log-when');
      stamp.appendChild(h('span', 'log-cycle', when.cycle != null ? 'Cycle ' + when.cycle : logDate(b.date)));
      if (when.phase) stamp.appendChild(h('span', 'log-phase', when.phase));
      row.appendChild(stamp);

      var body = h('div', 'log-body');

      var what = h('p', 'log-what');
      what.appendChild(h('strong', null, b.scenario || 'Battle'));
      var t = state.byId[b.territory];
      if (t) {
        what.appendChild(document.createTextNode(' at '));
        what.appendChild(linkBtn(t.id, displayName(t)));
      }
      body.appendChild(what);

      var who = (b.participants || []).map(function (id) {
        var g = gangOf(id);
        return g ? (g.short || g.name) : id;
      }).join(' vs ');
      var w = b.winner ? gangOf(b.winner) : null;
      var outcome = w ? (w.short || w.name) + ' took it' : 'no decisive result';
      body.appendChild(h('p', 'log-who', who ? who + ' — ' + outcome : outcome));

      /* The records do not go here. They go in the empty half of the
         card, a column to a gang, because a battle has two sides and the
         loser's is worth reading too. */

      if (b.summary) body.appendChild(h('p', 'log-sum', b.summary));

      row.appendChild(body);

      var rewards = b.rewards || [];
      if (rewards.length) {
        row.classList.add('has-sides');
        var sides = h('div', 'log-sides' + (rewards.length === 1 ? ' is-one' : ''));
        rewards.forEach(function (r) { sides.appendChild(recordLine(r, b)); });
        row.appendChild(sides);
      }

      list.appendChild(row);
    });

    wrap.appendChild(list);
    return wrap;
  }

  /* ---------- the infrastructure rule ----------

     The Reach pays for being close together. A charted holding within two
     steps of its gang's stronghold — every step over ground that same gang
     holds — shares roads, power and water with it and pays 5 more a cycle
     than the book says. A holding with no unbroken run of held ground back
     to the stronghold at all pays 5 less: everything it needs is hauled in
     past somebody else.

     Between the two, three or more held steps out, it pays what the book
     says. Growing the block outwards is worth money; a holding taken on
     the far side of the sector costs money to keep.

     The stronghold is the middle of its own block and zero steps from
     itself, so it takes the bonus like anything else inside two steps. A
     gang with no stronghold has no block to measure from, and nothing it
     holds is adjusted at all.

     Worked out here rather than written into the data, because it changes
     the moment ground changes hands. data/campaign.json keeps the number
     off the territory card; this is what the gang actually collects. */
  function computeAdjust() {
    var adjust = {};
    var terr = state.data.territories || [];

    (state.data.gangs || []).forEach(function (g) {
      var mine = terr.filter(function (t) {
        return t.owner === g.id && t.section === 'outer';
      });

      var seat = null;
      mine.forEach(function (t) { if (t.settlement && !seat) seat = t; });

      /* How many held steps each holding is from the seat. The walk runs
         all the way out, because the penalty is for ground with no run of
         held territory back to the seat at all — not for ground that is
         merely far. */
      if (!seat) return;
      var step = {};
      step[seat.id] = 0;
      var edge = [seat.id];
      for (var n = 1; edge.length; n++) {
        var next = [];
        var depth = n;
        edge.forEach(function (id) {
          ((state.byId[id] || {}).links || []).forEach(function (nid) {
            var t = state.byId[nid];
            if (!t || t.owner !== g.id || t.section !== 'outer') return;
            if (step[nid] != null) return;
            step[nid] = depth;
            next.push(nid);
          });
        });
        edge = next;
      }

      mine.forEach(function (t) {
        if (step[t.id] == null) { adjust[t.id] = -5; return; }
        adjust[t.id] = (step[t.id] <= 2) ? 5 : 0;
      });
    });

    return adjust;
  }

  function adjustOf(t) {
    return (state.adjust && state.adjust[t.id]) || 0;
  }

  /* What the holder actually banks for it. */
  function incomeOn(t) {
    return t.income == null ? null : t.income + adjustOf(t);
  }

  function adjustWhy(t) {
    var n = adjustOf(t);
    if (n > 0) return t.settlement ? 'the stronghold itself'
                                   : 'shares infrastructure with the stronghold';
    if (n < 0) return 'cut off from the rest of the block';
    return null;
  }

  /* "30 credits a cycle (25 + 5, shares infrastructure…)" */
  function incomeText(t) {
    var paid = incomeOn(t);
    if (paid == null) return null;
    var n = adjustOf(t);
    if (!n) return paid + ' credits a cycle';
    return paid + ' credits a cycle (' + t.income +
           (n > 0 ? ' + 5, ' : ' \u2212 5, ') + adjustWhy(t) + ')';
  }

  /* ---------- the gangs tab ---------- */

  /* What a gang draws each cycle is the income on every charted holding it
     owns. Standing boons are listed beside the holding rather than folded
     into the total, because several only pay out for the right House. */
  /* The stronghold heads the list: it is the ground the rest is measured
     from, so it reads first. The rest keep the order the map gives them. */
  function holdingsOf(g) {
    return outerTerritories().filter(function (t) {
      return t.owner === g.id;
    }).sort(function (x, y) {
      return (y.settlement ? 1 : 0) - (x.settlement ? 1 : 0);
    });
  }

  /* ---------- what a battle paid ----------

     The two missions pay separately and anything else — a concession, a
     consolation, credits that came with a discovery — is its own field, so
     a payout is read as three numbers and added up in one place. */
  var PAYOUTS = [
    ['primary', 'primary mission'],
    ['sidejob', 'side job'],
    ['credits', null]
  ];

  function payoutOf(r) {
    return (r.primary || 0) + (r.sidejob || 0) + (r.credits || 0);
  }

  /* Every model this gang has put down, across the whole campaign. */
  /* Every game the log credits this fighter with, in the order the
     battles are written. A fighter nobody has written into a record comes
     back empty, which is the ordinary case for a gang whose games have
     not been filled in. */
  function logXpOf(gangId, name) {
    var out = [];
    (state.data.battles || []).forEach(function (b) {
      (b.rewards || []).forEach(function (r) {
        if (r.gang !== gangId) return;
        (r.fighters || []).forEach(function (f) {
          if (f.fighter !== name) return;
          out.push({ battle: b, xp: f.xp || 0, xpFor: f.xpFor, note: f.note,
                     outOfAction: f.outOfAction, injury: f.injury });
        });
      });
    });
    return out;
  }

  function takedownsOf(gang) {
    return (state.data.battles || []).reduce(function (n, b) {
      return n + (b.rewards || []).reduce(function (m, r) {
        return m + (r.gang === gang.id ? (r.takedowns || 0) : 0);
      }, 0);
    }, 0);
  }

  /* ---------- the stash ----------

     A gang's stash is not a number in the data. It is every line of money
     that has ever reached them, added up: what each battle paid out, plus
     anything in campaign.ledger that did not come out of a fight. The
     battle rewards are read straight off the battles, so the same credits
     are never written down twice and the total cannot drift away from the
     history that explains it. */
  function stashLines(gang) {
    var out = [];

    (state.data.battles || []).forEach(function (b) {
      (b.rewards || []).forEach(function (r) {
        if (r.gang !== gang.id) return;
        PAYOUTS.forEach(function (kind) {
          var n = r[kind[0]];
          if (!n) return;
          out.push({
            cycle: b.cycle,
            date: b.date,
            amount: n,
            what: kind[1],
            battle: b.id
          });
        });
      });
    });

    (state.data.ledger || []).forEach(function (e) {
      if (e.gang !== gang.id) return;
      out.push({ date: e.date, amount: e.amount || 0, what: e.what, cycle: e.cycle });
    });

    /* Latest cycle first. The calendar date is only a tie-break inside a
       cycle, and a line with neither sits with the oldest rather than
       jumping the queue. */
    return out.sort(function (x, y) {
      return ((y.cycle || 0) - (x.cycle || 0)) ||
             String(y.date || '').localeCompare(String(x.date || ''));
    });
  }

  function stashOf(gang) {
    return stashLines(gang).reduce(function (n, e) { return n + (e.amount || 0); }, 0);
  }

  function stashFold(gang) {
    var lines = stashLines(gang);
    var box = h('details', 'fold is-ledger');
    var total = stashOf(gang);
    box.appendChild(h('summary', 'fold-summary',
      'Stash \u2014 ' + total + ' credits' +
      (lines.length ? ' from ' + lines.length +
        (lines.length === 1 ? ' entry' : ' entries') : ', nothing banked yet')));

    var body = h('div', 'fold-body');
    if (!lines.length) {
      body.appendChild(h('p', 'fold-note', 'Nothing has reached them yet.'));
      box.appendChild(body);
      return box;
    }

    var tbl = h('table', 'ledger-table');
    var head = h('tr');
    ['When', 'Where from', 'In'].forEach(function (k) { head.appendChild(h('th', null, k)); });
    var thead = h('thead'); thead.appendChild(head);
    var tb = h('tbody');
    lines.forEach(function (e) {
      var tr = h('tr');

      var when = whenOf(e.cycle);
      var td1 = h('td', 'led-when');
      td1.appendChild(h('span', 'led-cycle', when.cycle != null ? 'Cycle ' + when.cycle : '\u2013'));
      if (when.phase) td1.appendChild(h('span', 'led-phase', when.phase));
      tr.appendChild(td1);

      /* A payout points back at the game it came out of; anything else is
         just the line somebody wrote down. */
      var td2 = h('td', 'led-what');
      var b = e.battle ? battleOf(e.battle) : null;
      if (b) {
        td2.appendChild(logLink(b));
        if (e.what) td2.appendChild(h('span', 'led-part', e.what));
      } else {
        td2.appendChild(document.createTextNode(e.what || '\u2013'));
      }
      tr.appendChild(td2);
      tr.appendChild(h('td', 'led-amt' + (e.amount < 0 ? ' is-out' : ''),
        (e.amount > 0 ? '+' : '') + e.amount));
      tb.appendChild(tr);
    });
    var foot = h('tr', 'led-total');
    foot.appendChild(h('td', 'led-when', ''));
    foot.appendChild(h('td', 'led-what', 'Stash'));
    foot.appendChild(h('td', 'led-amt', String(total)));
    var tfoot = h('tfoot'); tfoot.appendChild(foot);
    tbl.appendChild(thead); tbl.appendChild(tb); tbl.appendChild(tfoot);
    body.appendChild(tbl);
    box.appendChild(body);
    return box;
  }

  /* ---------- the lockup ----------

     Everything a gang owns that is not money, worked out exactly the way
     the stash is: from the lines that each say where one thing came from.
     A battle that paid out kit says so on its reward; anything else is a
     ledger line; and an item strapped onto a fighter leaves again with a
     negative count. So the lockup is what is spare rather than what the
     gang owns in total, and a fighter's own wargear stays the one place
     their kit is written down.

     An archeotech line names the piece instead of repeating it. The name
     and the holder live on the piece, so both are read off it here. */
  function relicOf(id) {
    var all = state.data.archeotech || [];
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  /* One gear line in the words the log wants: a name, a count when there
     is more than one of it, and which way it went if it went out. */
  function gearWords(g) {
    var relic = g.piece ? relicOf(g.piece) : null;
    var name = relic ? relic.name : g.item;
    var n = g.qty == null ? 1 : g.qty;
    if (n < 0) return name + (n < -1 ? ' \u00d7' + (-n) : '') + ' given up';
    return name + (n > 1 ? ' \u00d7' + n : '');
  }

  function lockupLines(gang) {
    var out = [];

    function take(src, g) {
      var relic = g.piece ? relicOf(g.piece) : null;
      if (g.piece && !relic) return;
      out.push({
        key: g.piece ? 'piece:' + g.piece : 'item:' + g.item,
        name: relic ? relic.name : g.item,
        relic: relic,
        /* A piece is worth what the piece says; ordinary kit is worth
           what the line that brought it in says, because the same thing
           can be picked up off the dead one week and bought the next. */
        value: relic ? relic.value : g.value,
        qty: g.qty == null ? 1 : g.qty,
        note: g.note,
        cycle: src.cycle,
        date: src.date,
        what: src.what,
        battle: src.battle
      });
    }

    (state.data.battles || []).forEach(function (b) {
      (b.rewards || []).forEach(function (r) {
        if (r.gang !== gang.id) return;
        (r.gear || []).forEach(function (g) {
          take({ cycle: b.cycle, date: b.date, battle: b.id }, g);
        });
      });
    });

    (state.data.ledger || []).forEach(function (e) {
      if (e.gang !== gang.id) return;
      (e.gear || []).forEach(function (g) {
        take({ cycle: e.cycle, date: e.date, what: e.what }, g);
      });
    });

    return out;
  }

  /* One row per thing, with the lines that got it there kept alongside,
     so a count can always be read back to where it came from. Something
     that has all gone out again nets to nothing and drops off the list
     rather than sitting there at zero. */
  function lockupOf(gang) {
    var order = [];
    var by = {};
    lockupLines(gang).forEach(function (l) {
      if (!by[l.key]) {
        by[l.key] = { name: l.name, relic: l.relic, value: null, qty: 0, from: [] };
        order.push(l.key);
      }
      if (l.value != null) by[l.key].value = l.value;
      by[l.key].qty += l.qty;
      by[l.key].from.push(l);
    });
    return order.map(function (k) { return by[k]; })
                .filter(function (r) { return r.qty > 0; });
  }

  /* A gang with nothing in the lockup gets no fold at all: an empty one
     would say less than the silence does. */
  function lockupFold(gang) {
    var rows = lockupOf(gang);
    if (!rows.length) return null;

    var things = rows.reduce(function (n, r) { return n + r.qty; }, 0);
    /* Worth, not money: it is what the lockup would fetch, and it stays
       out of the stash because nobody has sold any of it. */
    var worth = rows.reduce(function (n, r) {
      return n + (r.value || 0) * r.qty;
    }, 0);
    var box = h('details', 'fold is-lockup');
    box.appendChild(h('summary', 'fold-summary',
      'Lockup \u2014 ' + things + (things === 1 ? ' thing' : ' things') +
      ' across ' + rows.length + (rows.length === 1 ? ' line' : ' lines') +
      (worth ? ', worth ' + worth + ' credits' : '')));

    var body = h('div', 'fold-body');
    var list = h('ul', 'lockup-list');
    rows.forEach(function (r) {
      var li = h('li', 'lockup' + (r.relic ? ' is-relic' : ''));
      var head = h('p', 'lockup-head');
      head.appendChild(h('span', 'lockup-name', r.name));
      if (r.qty > 1) head.appendChild(h('span', 'lockup-qty', '\u00d7' + r.qty));
      if (r.relic) head.appendChild(h('span', 'lockup-tag', 'Archeotech'));
      if (r.value != null) {
        head.appendChild(h('span', 'lockup-worth',
          (r.qty > 1 ? r.value * r.qty + ' cr' : r.value + ' cr')));
      }
      li.appendChild(head);

      var from = h('ul', 'lockup-from');
      r.from.forEach(function (l) {
        var line = h('li', 'lockup-line' + (l.qty < 0 ? ' is-out' : ''));
        var b = l.battle ? battleOf(l.battle) : null;
        if (b) line.appendChild(logLink(b));
        else line.appendChild(h('span', 'lockup-what', l.what || '\u2013'));
        if (l.note) line.appendChild(h('span', 'lockup-note', l.note));
        line.appendChild(h('span', 'lockup-amt', (l.qty > 0 ? '+' : '') + l.qty));
        from.appendChild(line);
      });
      li.appendChild(from);
      list.appendChild(li);
    });
    body.appendChild(list);
    box.appendChild(body);
    return box;
  }

  /* ---------- reputation ----------

     Reputation is not a number in the data either. Every gang starts the
     campaign on one, battles pay more, and a holding with a standing pays
     for exactly as long as it is held — so losing the ground loses the
     reputation with it, without anyone having to remember to take it off
     again. */
  function repLines(gang) {
    var out = [{ what: 'Starting reputation', amount: BASE_REP }];

    (state.data.battles || []).forEach(function (b) {
      (b.rewards || []).forEach(function (r) {
        if (r.gang !== gang.id || !r.rep) return;
        var t = b.territory ? state.byId[b.territory] : null;
        out.push({
          date: b.date,
          amount: r.rep,
          what: (b.scenario || 'Battle') + (t ? ' \u2014 ' + displayName(t) : '')
        });
      });
    });

    holdingsOf(gang).concat(surveyedDeepOf(gang)).forEach(function (t) {
      if (!t.rep) return;
      out.push({ amount: t.rep, what: displayName(t) + ', while it is held', held: true });
    });

    return out;
  }

  function repOf(gang) {
    return repLines(gang).reduce(function (n, e) { return n + (e.amount || 0); }, 0);
  }

  /* A walked holding in the deep pays like any other. It takes no
     infrastructure adjustment: it is not part of the charted block, and
     there is no road back to the seat worth the name. */
  function surveyedDeepOf(g) {
    return (state.data.territories || []).filter(function (t) {
      return t.owner === g.id && t.section === 'inner' && t.surveyed;
    });
  }

  function incomeOf(g) {
    return holdingsOf(g).concat(surveyedDeepOf(g)).reduce(function (n, t) {
      return n + (incomeOn(t) || 0);
    }, 0);
  }

  function deepHoldingsOf(g) {
    return (state.data.territories || []).filter(function (t) {
      return t.owner === g.id && t.section === 'inner';
    });
  }

  /* ---------- rosters ----------

     A roster is its own file under data/rosters/, hand-kept, one per gang,
     and the gang record points at it. It is fetched the first time somebody
     opens the fold and cached after that, so a gang nobody expands costs
     nothing and an edit to a fighter never touches campaign.json.

     The fold is shut on load. Open, it is the whole sheet: statline,
     weapons, skills, rules and gear, in the order the paper roster has
     them. */
  var STAT_HEAD = ['M', 'WS', 'BS', 'S', 'T', 'W', 'I', 'A', 'Sv', 'Ld', 'Cl', 'Wil', 'Int'];
  var rosterCache = {};

  /* The keyword list is the fighter's rank and everything else about them
     at once, in the order the sheet prints it. The tally reads the rank
     back out: a fighter who is both Leader and Champion counts once, as
     the highest thing they are. */
  var RANK_ORDER = ['Leader', 'Champion', 'Ganger', 'Prospect', 'Juve',
                    'Brute', 'Beast', 'Hybrid', 'Hanger-on'];

  function rankOf(f) {
    var kw = f.keywords || [];
    for (var i = 0; i < RANK_ORDER.length; i++) {
      if (kw.indexOf(RANK_ORDER[i]) !== -1) return RANK_ORDER[i];
    }
    return null;
  }

  function rosterLine(f) {
    var kw = (f.keywords || []).join(', ');
    return [f.archetype, kw].filter(Boolean).join(' \u2022 ');
  }

  function rosterSummary(r) {
    var fs_ = r.fighters || [];
    var byRank = {};
    fs_.forEach(function (f) {
      var rank = rankOf(f);
      if (rank) byRank[rank] = (byRank[rank] || 0) + 1;
    });
    var parts = [fs_.length + (fs_.length === 1 ? ' fighter' : ' fighters')];
    RANK_ORDER
      .forEach(function (rank) {
        var n = byRank[rank];
        if (!n) return;
        var word = rank.toLowerCase();
        parts.push(n + ' ' + (n === 1 ? word : word + 's'));
      });
    var rating = fs_.reduce(function (n, f) { return n + (f.rating || 0); }, 0);
    parts.push(rating + ' rating');
    return parts.join(' \u00b7 ');
  }

  function fighterCard(f, gang) {
    var card = h('article', 'fighter');

    /* The sheet's experience is where the fighter started: what they had
       the day the roster was written down. Everything the log has credited
       them with since is added on, so the number in the corner is what
       they are worth now rather than what they were worth then. */
    var games = gang ? logXpOf(gang.id, f.name) : [];
    var earned = games.reduce(function (n, g) { return n + g.xp; }, 0);
    var total = (f.xp || 0) + earned;

    var head = h('div', 'fighter-head');
    head.appendChild(h('h4', 'fighter-name', f.name));
    if (f.rating != null) head.appendChild(h('span', 'fighter-rating', f.rating + ' rating'));
    if (f.xp != null || earned) {
      var xpEl = h('span', 'fighter-xp' + (earned ? ' is-earned' : ''), total + ' XP');
      if (earned) {
        xpEl.title = (f.xp != null ? f.xp + ' on the sheet' : 'nothing on the sheet') +
                     ', ' + earned + ' since, out of the log.';
      }
      head.appendChild(xpEl);
    }
    card.appendChild(head);
    card.appendChild(h('p', 'fighter-role', rosterLine(f)));
    if (f.status) card.appendChild(h('p', 'fighter-status', f.status));

    /* statline */
    if ((f.stats || []).length) {
      var wrap = h('div', 'stat-scroll');
      var tbl = h('table', 'statline');
      var hr = h('tr');
      STAT_HEAD.forEach(function (k, n) {
        var th = h('th', n === 9 ? 'is-split' : null, k);
        hr.appendChild(th);
      });
      var br = h('tr');
      f.stats.forEach(function (v, n) {
        br.appendChild(h('td', n === 9 ? 'is-split' : null, String(v)));
      });
      var thead = h('thead'); thead.appendChild(hr);
      var tbody = h('tbody'); tbody.appendChild(br);
      tbl.appendChild(thead); tbl.appendChild(tbody);
      wrap.appendChild(tbl);
      card.appendChild(wrap);
    }

    /* weapons */
    if ((f.weapons || []).length) {
      var ww = h('div', 'stat-scroll');
      var wt = h('table', 'weapons');
      var wh = h('tr');
      ['Weapon', 'SR', 'LR', 'Str', 'AP', 'L', 'Traits'].forEach(function (k) {
        wh.appendChild(h('th', null, k));
      });
      var wb = h('tbody');
      f.weapons.forEach(function (w) {
        var tr = h('tr');
        tr.appendChild(h('td', 'wep-name', w.name));
        ['sr', 'lr', 'str', 'ap', 'l'].forEach(function (k) {
          tr.appendChild(h('td', 'wep-num', w[k] == null || w[k] === '' ? '\u2013' : String(w[k])));
        });
        tr.appendChild(h('td', 'wep-traits', (w.traits || []).join(', ') || '\u2013'));
        wb.appendChild(tr);
      });
      var wthead = h('thead'); wthead.appendChild(wh);
      wt.appendChild(wthead); wt.appendChild(wb);
      ww.appendChild(wt);
      card.appendChild(ww);
    }

    [['Skills', f.skills], ['Rules', f.rules], ['Wargear', f.wargear]].forEach(function (pair) {
      if (!(pair[1] || []).length) return;
      var p = h('p', 'fighter-extra');
      p.appendChild(h('span', 'fighter-extra-label', pair[0]));
      p.appendChild(document.createTextNode(' ' + pair[1].join(', ')));
      card.appendChild(p);
    });

    /* What the log says this fighter did. The sheet's number is the total
       and stays in the header; this is the part of it the campaign can
       account for, game by game. */
    if (games.length) {
      var box = h('div', 'fighter-log');
      var lead = h('p', 'fighter-extra');
      lead.appendChild(h('span', 'fighter-extra-label', 'From the log'));
      lead.appendChild(document.createTextNode(' ' + earned + ' XP across ' +
        games.length + (games.length === 1 ? ' battle' : ' battles') +
        (f.xp != null ? ', on top of ' + f.xp + ' on the sheet' : '')));
      box.appendChild(lead);

      var list = h('ul', 'flog-list');
      games.forEach(function (g) {
        var li = h('li', 'flog' + (g.outOfAction ? ' is-down' : ''));
        var why = [];
        if (g.xpFor) why.push(g.xpFor);
        if (g.note) why.push(g.note);
        if (why.length) li.title = why.join(' ');
        li.appendChild(logLink(g.battle));
        var hurt = [];
        if (g.outOfAction) hurt.push('out of action');
        if (g.injury) hurt.push(g.injury);
        if (hurt.length) li.appendChild(h('span', 'flog-hurt', hurt.join(', ')));
        li.appendChild(h('span', 'flog-xp', g.xp + ' XP'));
        list.appendChild(li);
      });
      box.appendChild(list);
      card.appendChild(box);
    }

    return card;
  }

  function fillRoster(host, r, gang) {
    host.textContent = '';
    var fs_ = r.fighters || [];
    if (!fs_.length) {
      host.appendChild(h('p', 'fold-note', 'The file is there but it has nobody in it yet.'));
      return;
    }
    var rating = fs_.reduce(function (n, f) { return n + (f.rating || 0); }, 0);
    if (gang && gang.rating != null && gang.rating !== rating) {
      host.appendChild(h('p', 'fold-note is-off',
        'The sheet adds up to ' + rating + ' and the gang record says ' + gang.rating +
        '. One of the two is out of date.'));
    }
    if (r.updated) {
      host.appendChild(h('p', 'fold-note', 'Sheet as of ' + r.updated + '.'));
    }
    fs_.forEach(function (f) { host.appendChild(fighterCard(f, gang)); });
  }

  /* The fold does the fetching, once, the first time it is opened. */
  function rosterFold(g) {
    var box = h('details', 'fold is-roster');
    var sum = h('summary', 'fold-summary', 'Roster');
    box.appendChild(sum);
    var host = h('div', 'fold-body');
    host.appendChild(h('p', 'fold-note', 'Reading the sheet\u2026'));
    box.appendChild(host);

    var loaded = false;
    box.addEventListener('toggle', function () {
      if (!box.open || loaded) return;
      loaded = true;
      if (rosterCache[g.id]) { fillRoster(host, rosterCache[g.id], g); return; }
      fetch(g.roster, { cache: 'no-cache' })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (r) {
          rosterCache[g.id] = r;
          sum.textContent = 'Roster \u2014 ' + rosterSummary(r);
          fillRoster(host, r, g);
        })
        .catch(function (e) {
          loaded = false;
          host.textContent = '';
          host.appendChild(h('p', 'fold-note is-off',
            'Could not read ' + g.roster + ' (' + e.message + '). Close and open to try again.'));
        });
    });

    return box;
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
    var titles = h('div', 'gang-card-titles');
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
      ['Stash', stashOf(g)],
      ['Rep', repOf(g)],
      ['Income', incomeOf(g) + '/cycle'],
      ['Taken out', takedownsOf(g)]
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
      if (t.settlement) row.appendChild(h('span', 'tag settlement', 'Stronghold'));
      row.appendChild(h('span', 'holding-income', (incomeOn(t) || 0) + ' cr'));
      if (adjustOf(t)) {
        var mark = h('span', 'holding-adjust', adjustOf(t) > 0 ? '+5' : '\u22125');
        mark.title = t.income + ' on the card, ' + adjustWhy(t);
        row.appendChild(mark);
      }
      li.appendChild(row);
      li.appendChild(h('p', 'holding-type', t.type || 'Unknown type'));
      if (t.boon) li.appendChild(h('p', 'holding-boon', t.boon));
      if (t.standing) {
        li.appendChild(h('p', 'holding-boon is-standing', t.standing + ', the whole time it is held'));
      }
      list.appendChild(li);
    });

    deep.filter(function (t) { return t.surveyed; }).forEach(function (t) {
      var li = h('li', 'holding is-walked');
      var row = h('div', 'holding-row');
      var link = h('button', 'holding-name');
      link.type = 'button';
      link.textContent = displayName(t);
      link.title = 'Show ' + displayName(t) + ' on the map';
      link.addEventListener('click', function () { select(t.id, true); });
      row.appendChild(link);
      row.appendChild(h('span', 'tag deep-tag', 'In the deep'));
      row.appendChild(h('span', 'holding-income', (incomeOn(t) || 0) + ' cr'));
      li.appendChild(row);
      li.appendChild(h('p', 'holding-type', t.type || 'Unknown type'));
      if (t.boon) li.appendChild(h('p', 'holding-boon', t.boon));
      list.appendChild(li);
    });

    var blank = deep.filter(function (t) { return !t.surveyed; });
    if (blank.length) {
      var li = h('li', 'holding is-deep');
      li.appendChild(h('div', 'holding-row',
        blank.length === 1 ? 'One more holding in the deep'
                           : blank.length + ' more holdings in the deep'));
      li.appendChild(h('p', 'holding-type',
        'Nobody has walked them, so nobody has charted which they are.'));
      list.appendChild(li);
    }

    if (!held.length && !deep.length) {
      list.appendChild(h('li', 'holding is-empty', 'Holds nothing on the charted map.'));
    }
    card.appendChild(list);

    card.appendChild(stashFold(g));
    var lock = lockupFold(g);
    if (lock) card.appendChild(lock);
    if (g.roster) card.appendChild(rosterFold(g));
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
    /* an arbitrator's hidden gang stays off the page here too */
    var players = visibleGangs();

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
      return byRep(a, b) || incomeOf(b) - incomeOf(a);
    }).forEach(function (g) { grid.appendChild(gangCard(g)); });
    host.appendChild(grid);

    host.appendChild(h('p', 'hint plan-hint',
      'Rating is whatever the arbitrator last wrote into data/campaign.json. ' +
      'Stash, reputation and income are all worked out: the stash from every ' +
      'payout on record, reputation from one to start plus the battles and the ' +
      'standings of the ground held, income from the holdings listed here.'));
  }


  /* ---------- heroes ----------

     Three things earn a fighter a place, so the board adds all three up
     and calls the sum renown:

       every experience point the log has paid them     1 each
       every model they have put out of action          3 each
       every honour the arbitrator has written down     5 each

     The weights are a judgement, not a rule out of the book, so the row
     shows its own working: the three figures are printed beside the
     total and anyone can check it. A takedown is worth more than the
     experience it pays because a gang that fights wins ground, and an
     honour is worth more again because somebody had to decide it was
     worth remembering.

     Experience is counted from the log only, never off the sheet. A
     Leader is written down with sixty-odd before a shot is fired and a
     Prospect with one, and neither of them fought for that; ranking on
     the total would rank the roster rather than the campaign.

     The board needs every roster at once, which the Gangs tab only ever
     loads one at a time, so the first look fetches the missing ones and
     the cache is shared with the folds. */
  var RENOWN = { xp: 1, takedown: 3, honour: 5 };
  var HERO_LIMIT = 10;

  function withRosters(then) {
    var want = (state.data.gangs || []).filter(function (g) {
      return g.roster && !rosterCache[g.id];
    });
    if (!want.length) { then(); return; }
    var left = want.length;
    want.forEach(function (g) {
      fetch(g.roster, { cache: 'no-cache' })
        .then(function (res) { return res.ok ? res.json() : null; })
        .catch(function () { return null; })
        .then(function (r) {
          if (r) rosterCache[g.id] = r;
          if (!--left) then();
        });
    });
  }

  /* Everything the campaign knows about one fighter, gathered across every
     game they are written into and every honour against their name. The
     sheet is looked up for what they are and what they started on; a
     fighter the log names who is on no sheet still counts, because the
     game happened either way. */
  function heroRows() {
    var by = {};
    var order = [];

    function rowFor(gangId, name) {
      var key = gangId + '|' + name;
      if (!by[key]) {
        by[key] = { gang: gangOf(gangId), name: name, earned: 0, kills: 0,
                    games: 0, down: 0, hurt: [], honours: [], best: null };
        order.push(key);
      }
      return by[key];
    }

    (state.data.battles || []).forEach(function (b) {
      (b.rewards || []).forEach(function (r) {
        (r.fighters || []).forEach(function (f) {
          var row = rowFor(r.gang, f.fighter);
          row.earned += f.xp || 0;
          row.kills += f.takedowns || 0;
          row.games += 1;
          if (f.outOfAction) row.down += 1;
          if (f.injury) row.hurt.push(f.injury);
          /* The single best night they have had, kept for the line under
             their name. A tie goes to the earlier game. */
          if (f.xpFor && (!row.best || (f.xp || 0) > row.best.xp)) {
            row.best = { xp: f.xp || 0, why: f.xpFor, battle: b };
          }
        });
      });
    });

    (state.data.honours || []).forEach(function (o) {
      rowFor(o.gang, o.fighter).honours.push(o);
    });

    order.forEach(function (k) {
      var row = by[k];
      var r = row.gang ? rosterCache[row.gang.id] : null;
      var sheet = null;
      ((r && r.fighters) || []).forEach(function (f) {
        if (f.name === row.name) sheet = f;
      });
      row.archetype = sheet ? sheet.archetype : null;
      row.start = sheet ? sheet.xp : null;
      row.total = (sheet && sheet.xp != null ? sheet.xp : 0) + row.earned;
      row.renown = row.earned * RENOWN.xp +
                   row.kills * RENOWN.takedown +
                   row.honours.length * RENOWN.honour;
    });

    /* Most renown first. A tie goes to the one who took more models out,
       then to whoever did it in fewer games, then alphabetically, so the
       order never wobbles between loads. */
    return order.map(function (k) { return by[k]; })
      .filter(function (row) { return row.renown > 0; })
      .sort(function (a, b) {
        return (b.renown - a.renown) || (b.kills - a.kills) ||
               (a.games - b.games) || a.name.localeCompare(b.name);
      });
  }

  function drawHeroes() {
    var host = document.getElementById('panel-heroes');
    if (host.getAttribute('data-drawn') === 'yes') return;
    host.setAttribute('data-drawn', 'yes');
    host.textContent = '';
    host.appendChild(h('p', 'detail-empty', 'Reading every sheet\u2026'));
    withRosters(function () { fillHeroes(host); });
  }

  function fillHeroes(host) {
    var rows = heroRows();
    host.textContent = '';
    host.appendChild(h('h2', 'panel-title', 'Heroes of the Hollow Reach'));

    if (!rows.length) {
      host.appendChild(h('p', 'detail-empty',
        'Nobody has done anything yet. The board fills up as the log does.'));
      return;
    }

    var top = rows.slice(0, HERO_LIMIT);
    host.appendChild(h('p', 'panel-sub',
      'The ' + top.length + ' most renowned fighters in the Reach' +
      (rows.length > top.length
        ? ', out of ' + rows.length + ' who have earned a place at all' : '') + '.'));

    var list = h('ol', 'hero-list');
    top.forEach(function (row, i) {
      var li = h('li', 'hero' + (i < 3 ? ' is-podium rank-' + (i + 1) : ''));
      li.appendChild(h('span', 'hero-rank', String(i + 1)));

      var who = h('div', 'hero-who');
      var name = h('p', 'hero-name');
      if (row.gang) {
        var sw = h('span', 'swatch');
        sw.style.background = row.gang.color;
        name.appendChild(sw);
      }
      name.appendChild(document.createTextNode(row.name));
      who.appendChild(name);

      var bits = [];
      if (row.archetype) bits.push(row.archetype);
      if (row.gang) bits.push(row.gang.short || row.gang.name);
      bits.push(row.games + (row.games === 1 ? ' game' : ' games'));
      if (row.kills) {
        /* Per game once there is more than one game to average over. On a
           single outing the rate is the count, and saying "a game" about
           it reads like a claim nobody has tested. */
        bits.push(row.games > 1
          ? (row.kills / row.games).toFixed(1).replace(/\.0$/, '') + ' taken out a game'
          : row.kills + ' taken out');
      }
      if (row.down) {
        bits.push(row.down + (row.down === 1 ? ' time down' : ' times down'));
      }
      who.appendChild(h('p', 'hero-what', bits.join(' \u00b7 ')));

      row.honours.forEach(function (o) {
        var line = h('p', 'hero-honour');
        line.appendChild(h('span', 'hero-honour-tag', o.title || 'Honour'));
        line.appendChild(document.createTextNode(o.what));
        who.appendChild(line);
      });

      if (row.best && row.best.why) {
        var why = h('p', 'hero-why');
        why.appendChild(logLink(row.best.battle));
        why.appendChild(h('span', 'hero-why-text', row.best.why));
        who.appendChild(why);
      }

      if (row.hurt.length) {
        who.appendChild(h('p', 'hero-hurt', row.hurt.join(' \u00b7 ')));
      }
      li.appendChild(who);

      var score = h('div', 'hero-score');
      score.appendChild(h('strong', 'hero-renown', String(row.renown)));
      score.appendChild(h('span', 'hero-score-label', 'renown'));

      /* The working: each part is what it contributed and what for, so the
         total adds up on the page without anybody reading the code. */
      var parts = [];
      if (row.earned) parts.push(row.earned + ' XP');
      if (row.kills) {
        parts.push((row.kills * RENOWN.takedown) + ' for ' + row.kills + ' taken out');
      }
      if (row.honours.length) {
        parts.push((row.honours.length * RENOWN.honour) + ' for ' + row.honours.length +
                   (row.honours.length === 1 ? ' honour' : ' honours'));
      }
      score.appendChild(h('span', 'hero-sum', parts.join(' + ')));
      if (row.start != null) {
        score.appendChild(h('span', 'hero-total', row.total + ' XP all told'));
      }
      li.appendChild(score);

      list.appendChild(li);
    });
    host.appendChild(list);

    host.appendChild(h('p', 'tally-foot',
      'Renown is one point per experience the log has paid them, ' +
      RENOWN.takedown + ' per model they have put out of action, and ' +
      RENOWN.honour + ' per honour the arbitrator has written down. ' +
      'Experience is counted from the log only \u2014 a Leader starts with ' +
      'sixty of it and a Prospect with one, and neither of them fought ' +
      'for that. Ties go to the one who took more models out, then to ' +
      'whoever did it in fewer games.'));
  }

  /* ---------- tabs ---------- */

  function showTab(name) {
    var panels = { map: 'panel-map', campaign: 'panel-campaign', gangs: 'panel-gangs',
                   heroes: 'panel-heroes', archeotech: 'panel-archeotech' };
    var tabs = { map: 'tab-map', campaign: 'tab-campaign', gangs: 'tab-gangs',
                 heroes: 'tab-heroes', archeotech: 'tab-archeotech' };
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
    state.adjust = computeAdjust();
    state.tunnelsById = {};
    (data.tunnels || []).forEach(function (t) { state.tunnelsById[t.id] = t; });

    drawHeader();
    drawMap();
    drawStandings();
    drawTimeline();
    drawGangs();
    drawRelics();

    document.getElementById('tab-map').addEventListener('click', function () {
      showTab('map');
      if (['#campaign', '#gangs', '#heroes', '#archeotech'].indexOf(window.location.hash) >= 0) {
        history.replaceState(null, '', state.selected ? '#' + state.selected : window.location.pathname);
      }
    });
    document.getElementById('tab-campaign').addEventListener('click', function () { select('campaign', true); });
    document.getElementById('tab-gangs').addEventListener('click', function () { select('gangs', true); });
    document.getElementById('tab-heroes').addEventListener('click', function () { select('heroes', true); });
    document.getElementById('tab-archeotech').addEventListener('click', function () { select('archeotech', true); });

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
