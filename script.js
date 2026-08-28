/* ============================================================
   RemitPK — comparison engine
   ------------------------------------------------------------
   HOW PRICING WORKS HERE

   The mid-market rate (the true wholesale rate) is fetched live
   from a free API and cached in the visitor's browser. Nobody
   needs to maintain it.

   What each provider actually quotes is mid-market MINUS their
   margin. No public API exposes those margins, so they live in
   CORRIDORS below as maintained numbers, alongside each fee.

       provider rate = mid-market x (1 - margin%)
       delivered     = (amount - fee) x provider rate

   TO KEEP THE SITE ACCURATE: check each provider's real quote
   periodically and adjust `margin` and the fee fields. The rate
   itself looks after itself.

   TO ADD YOUR AFFILIATE LINKS: replace the values in LINKS.
   Until then they point at the providers' public sites, so every
   button on the page still works.
   ============================================================ */

var LINKS = {
  wise:       'https://wise.com/',
  remitly:    'https://www.remitly.com/',
  worldremit: 'https://www.worldremit.com/'
};

/* ---------------- live mid-market rates ---------------- */

var FX = {
  /* Used only until the live fetch lands, and as a fallback if it
     fails. Refresh these occasionally so the fallback is not stale. */
  fallback: { GBP: 377.73, AED: 75.57, USD: 277.52 },
  fallbackDate: '2026-08-28',

  cacheKey: 'remitpk.fx.v1',
  ttlHours: 12,

  /* Both are free, need no key, and send CORS headers. The second is
     a fallback for when the CDN is unreachable. */
  sources: [
    {
      url: function (code) {
        return 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/' +
               code.toLowerCase() + '.json';
      },
      rate: function (json, code) {
        var block = json[code.toLowerCase()];
        return block && block.pkr;
      },
      date: function (json) { return json.date; }
    },
    {
      url: function (code) { return 'https://open.er-api.com/v6/latest/' + code; },
      rate: function (json) { return json.rates && json.rates.PKR; },
      date: function (json) {
        var d = json.time_last_update_utc || '';
        return d ? d.slice(5, 16) : '';
      }
    }
  ]
};

/* Live values once loaded; starts on the fallback so the first paint
   is never empty. `date` is when the source published the rate; `checkedAt`
   is when this browser actually fetched it. They differ by up to a day,
   because these feeds publish once daily. */
var fx = { rates: FX.fallback, date: FX.fallbackDate, checkedAt: null, live: false };

var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDay(d) {
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}

/* "2026-08-27" -> "27 Aug 2026". Anything unparseable is passed through. */
function fmtPublished(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  return fmtDay(new Date(+m[1], +m[2] - 1, +m[3]));
}

/* Checks made today read as "today at 14:32" — the clearest possible
   signal that the page is pulling rates rather than shipping them. */
function fmtChecked(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  var now = new Date();
  var time = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  var sameDay = d.getFullYear() === now.getFullYear() &&
                d.getMonth() === now.getMonth() &&
                d.getDate() === now.getDate();
  return sameDay ? 'today at ' + time : fmtDay(d) + ' at ' + time;
}

function fxCacheRead() {
  try {
    var raw = localStorage.getItem(FX.cacheKey);
    if (!raw) return null;
    var c = JSON.parse(raw);
    if (!c || !c.rates || !c.ts) return null;
    if ((Date.now() - c.ts) > FX.ttlHours * 3600 * 1000) return null;
    return c;
  } catch (e) { return null; }
}

function fxCacheWrite(rates, date, ts) {
  try {
    localStorage.setItem(FX.cacheKey, JSON.stringify({
      rates: rates, date: date, ts: ts || Date.now()
    }));
  } catch (e) { /* private mode, quota — the page works without it */ }
}

function fetchOne(source, code) {
  return fetch(source.url(code), { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    })
    .then(function (j) {
      var v = source.rate(j, code);
      if (typeof v !== 'number' || !isFinite(v) || v <= 0) throw new Error('bad rate');
      return { code: code, rate: v, date: source.date(j) };
    });
}

/* Try each source in turn; resolve with whatever succeeds first. */
function fetchAll(sourceIndex) {
  var source = FX.sources[sourceIndex];
  if (!source) return Promise.reject(new Error('no source succeeded'));

  var codes = ['GBP', 'AED', 'USD'];
  return Promise.all(codes.map(function (c) { return fetchOne(source, c); }))
    .then(function (results) {
      var rates = {}, date = '';
      results.forEach(function (r) { rates[r.code] = r.rate; date = r.date || date; });
      return { rates: rates, date: date };
    })
    .catch(function () { return fetchAll(sourceIndex + 1); });
}

function loadFX() {
  var cached = fxCacheRead();
  if (cached) {
    /* cached.ts is when the fetch actually happened, which is what the
       "checked" stamp should report — not now. */
    fx = { rates: cached.rates, date: cached.date, checkedAt: cached.ts, live: true };
    return Promise.resolve(fx);
  }
  if (typeof fetch !== 'function') return Promise.resolve(fx);

  return fetchAll(0).then(function (got) {
    var now = Date.now();
    fx = { rates: got.rates, date: got.date || FX.fallbackDate, checkedAt: now, live: true };
    fxCacheWrite(got.rates, fx.date, now);
    return fx;
  }).catch(function () {
    return fx; /* keep the fallback; the page still works */
  });
}

/* ---------------- corridors ---------------- */

/* margin      = how far below mid-market that provider quotes, in percent.
                 Wise converts at the true mid-market rate and charges its
                 margin openly as a fee, hence 0.
   fixed / pct = the fee, as a flat amount plus a percentage.
   waiveAbove  = amount at or above which the fee is dropped (null = never).
   A null method means the provider does not offer it on that corridor.

   THE MARGIN AND FEE NUMBERS BELOW ARE ESTIMATES AND NEED VERIFYING
   against each provider's live quote before you rely on them. */

var CORRIDORS = {
  uk: {
    label: 'United Kingdom', code: 'GBP', symbol: '£',
    presets: [100, 200, 500, 1000], start: 100,
    providers: [
      { id: 'wise', name: 'Wise', mark: 'W',
        bank:   { margin: 0,    fixed: 0.30, pct: 0.60, waiveAbove: null, speed: 'Within hours' },
        cash:   null,
        wallet: null },
      { id: 'remitly', name: 'Remitly', mark: 'R',
        bank:   { margin: 1.10, fixed: 2.99, pct: 0, waiveAbove: 100, speed: 'Minutes – 1 day' },
        cash:   { margin: 1.90, fixed: 3.99, pct: 0, waiveAbove: 300, speed: 'Minutes' },
        wallet: { margin: 1.30, fixed: 2.99, pct: 0, waiveAbove: 100, speed: 'Minutes' } },
      { id: 'worldremit', name: 'WorldRemit', mark: 'WR',
        bank:   { margin: 1.50, fixed: 1.99, pct: 0, waiveAbove: null, speed: 'Minutes – 1 day' },
        cash:   { margin: 2.20, fixed: 2.99, pct: 0, waiveAbove: null, speed: 'Minutes' },
        wallet: { margin: 1.65, fixed: 1.99, pct: 0, waiveAbove: null, speed: 'Minutes' } }
    ]
  },

  uae: {
    label: 'United Arab Emirates', code: 'AED', symbol: 'AED',
    presets: [500, 1000, 2000, 5000], start: 500,
    providers: [
      { id: 'wise', name: 'Wise', mark: 'W',
        bank:   { margin: 0,    fixed: 1.50, pct: 0.50, waiveAbove: null, speed: 'Within hours' },
        cash:   null,
        wallet: null },
      { id: 'remitly', name: 'Remitly', mark: 'R',
        bank:   { margin: 0.90, fixed: 12.99, pct: 0, waiveAbove: 500, speed: 'Minutes – 1 day' },
        cash:   { margin: 1.60, fixed: 15.00, pct: 0, waiveAbove: 1000, speed: 'Minutes' },
        wallet: { margin: 1.10, fixed: 12.99, pct: 0, waiveAbove: 500, speed: 'Minutes' } },
      { id: 'worldremit', name: 'WorldRemit', mark: 'WR',
        bank:   { margin: 0.75, fixed: 9.99, pct: 0, waiveAbove: null, speed: 'Minutes – 1 day' },
        cash:   { margin: 1.45, fixed: 14.99, pct: 0, waiveAbove: null, speed: 'Minutes' },
        wallet: { margin: 0.95, fixed: 9.99, pct: 0, waiveAbove: null, speed: 'Minutes' } }
    ]
  },

  us: {
    label: 'United States', code: 'USD', symbol: '$',
    presets: [100, 250, 500, 1000], start: 100,
    providers: [
      { id: 'wise', name: 'Wise', mark: 'W',
        bank:   { margin: 0,    fixed: 0.60, pct: 0.72, waiveAbove: null, speed: 'Within hours' },
        cash:   null,
        wallet: null },
      { id: 'remitly', name: 'Remitly', mark: 'R',
        bank:   { margin: 1.00, fixed: 3.99, pct: 0, waiveAbove: 100, speed: 'Minutes – 1 day' },
        cash:   { margin: 1.75, fixed: 4.99, pct: 0, waiveAbove: 300, speed: 'Minutes' },
        wallet: { margin: 1.25, fixed: 3.99, pct: 0, waiveAbove: 100, speed: 'Minutes' } },
      { id: 'worldremit', name: 'WorldRemit', mark: 'WR',
        bank:   { margin: 1.40, fixed: 3.99, pct: 0, waiveAbove: null, speed: 'Minutes – 1 day' },
        cash:   { margin: 2.10, fixed: 4.99, pct: 0, waiveAbove: null, speed: 'Minutes' },
        wallet: { margin: 1.55, fixed: 3.99, pct: 0, waiveAbove: null, speed: 'Minutes' } }
    ]
  }
};

var METHOD_LABEL = {
  bank:   'bank transfer',
  cash:   'cash pickup',
  wallet: 'Easypaisa / JazzCash'
};

var METHOD_HINT = {
  bank:   'Cheapest route in almost every case — no cash-handling cost to recover.',
  cash:   'Wise has no cash network in Pakistan, so it drops out of this comparison.',
  wallet: 'Money lands on the recipient’s phone — no bank account needed.'
};

/* ---------------- state ---------------- */

var state = { corridor: 'uk', method: 'bank', amount: 500 };

var REDUCED = window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- helpers ---------------- */

var groups = new Intl.NumberFormat('en-US');
var cents  = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
});

function pkr(n) { return 'Rs ' + groups.format(Math.round(n)); }

/* Whole amounts read cleanly (£500); anything with a fractional part is
   money and needs both decimal places (£3.30, not £3.3). */
function sent(n, corridor) {
  var c = CORRIDORS[corridor];
  var body = n % 1 === 0 ? groups.format(n) : cents.format(n);
  return c.symbol === 'AED' ? 'AED ' + body : c.symbol + body;
}

function midFor(corridor) {
  return fx.rates[CORRIDORS[corridor].code] || FX.fallback[CORRIDORS[corridor].code];
}

function feeFor(plan, amount) {
  if (plan.waiveAbove !== null && amount >= plan.waiveAbove) return 0;
  return plan.fixed + (amount * plan.pct / 100);
}

/* Build the ranked list for the current state. */
function quote() {
  var c = CORRIDORS[state.corridor];
  var amount = state.amount;
  var mid = midFor(state.corridor);

  var out = [];
  for (var i = 0; i < c.providers.length; i++) {
    var p = c.providers[i];
    var plan = p[state.method];
    if (!plan) continue;

    var rate = mid * (1 - plan.margin / 100);
    var fee = feeFor(plan, amount);
    var converted = Math.max(0, amount - fee);

    out.push({
      id: p.id,
      name: p.name,
      mark: p.mark,
      fee: fee,
      rate: rate,
      margin: plan.margin,
      speed: plan.speed,
      received: converted * rate
    });
  }

  out.sort(function (a, b) { return b.received - a.received; });
  return out;
}

/* ---------------- rendering ---------------- */

var el = {};

function cacheDom() {
  el.pills      = document.getElementById('corridorPills');
  el.seg        = document.getElementById('methodSeg');
  el.amount     = document.getElementById('amount');
  el.symbol     = document.getElementById('curSymbol');
  el.code       = document.getElementById('curCode');
  el.chips      = document.getElementById('presetChips');
  el.methodHint = document.getElementById('methodHint');
  el.rows       = document.getElementById('rows');
  el.resultsTitle = document.getElementById('resultsTitle');
  el.resultsSub = document.getElementById('resultsSub');
  el.fxNote     = document.getElementById('fxNote');
  el.fxStamp    = document.getElementById('fxStamp');
  el.vProvider  = document.getElementById('vProvider');
  el.vAmount    = document.getElementById('vAmount');
  el.vDelta     = document.getElementById('vDelta');
  el.insight    = document.getElementById('insight');
  el.insightKicker = document.getElementById('insightKicker');
  el.insightLine = document.getElementById('insightLine');
  el.insightFoot = document.getElementById('insightFoot');
}

function renderChips() {
  var c = CORRIDORS[state.corridor];
  el.chips.innerHTML = '';
  c.presets.forEach(function (v) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (v === state.amount ? ' is-on' : '');
    b.textContent = sent(v, state.corridor);
    b.setAttribute('data-value', v);
    el.chips.appendChild(b);
  });
}

function renderRows(list) {
  el.rows.innerHTML = '';
  if (!list.length) return;

  var best  = list[0].received;
  var worst = list[list.length - 1].received;
  var span  = best - worst;
  /* Differences between providers are ~1% of the total, so a raw
     proportional bar would look identical for all three. These bars
     show each provider's standing *relative to the others*, not an
     absolute share. */
  var floorRatio = 0.14;

  list.forEach(function (r, i) {
    var ratio = span > 0
      ? floorRatio + (1 - floorRatio) * ((r.received - worst) / span)
      : 1;

    var li = document.createElement('li');
    li.className = 'row' + (i === 0 ? ' is-best' : '');
    li.style.setProperty('--i', i);

    var deltaHtml = i === 0
      ? '<span class="row-delta best">Best value</span>'
      : '<span class="row-delta">−' + pkr(best - r.received) + '</span>';

    /* Always a number, always two decimals, so the column stays scannable.
       A zero margin also gets the words underneath, because "0.00%" alone
       does not tell a first-time reader that it means the true rate. */
    var marginLabel = r.margin.toFixed(2) + '%' +
      (r.margin === 0 ? '<em class="fact-tag">mid-market</em>' : '');
    var marginClass = r.margin === 0 ? ' is-zero' : '';

    li.innerHTML =
      '<div class="row-rank" aria-hidden="true">' + (i + 1) + '</div>' +

      '<div class="row-id">' +
        '<span class="row-mark mark-' + r.id + '">' + r.mark + '</span>' +
        '<span class="row-names">' +
          '<span class="row-name">' + r.name + '</span>' +
          '<span class="row-speed">' + r.speed + '</span>' +
        '</span>' +
      '</div>' +

      '<div class="row-facts">' +
        '<span class="fact"><span class="fact-k">Fee</span>' +
          '<span class="fact-v">' + (r.fee === 0 ? 'Free' : sent(r.fee, state.corridor)) + '</span></span>' +
        '<span class="fact"><span class="fact-k">Rate</span>' +
          '<span class="fact-v">' + r.rate.toFixed(2) + '</span></span>' +
        '<span class="fact"><span class="fact-k">Margin</span>' +
          '<span class="fact-v' + marginClass + '">' + marginLabel + '</span></span>' +
      '</div>' +

      '<div class="row-value">' +
        '<span class="row-received">' + pkr(r.received) + '</span>' +
        deltaHtml +
        '<span class="row-bar"><i style="--w:' + (ratio * 100).toFixed(1) + '%"></i></span>' +
      '</div>' +

      '<div class="row-cta">' +
        '<a class="btn" href="' + LINKS[r.id] + '" target="_blank" rel="sponsored nofollow noopener">' +
          'Send with ' + r.name + '<span aria-hidden="true"> →</span></a>' +
      '</div>';

    el.rows.appendChild(li);
  });
}

/* Animate the headline figure so a change is impossible to miss. */
var countTimer = null;
var countSnap = null;
function countTo(node, target) {
  if (countTimer) cancelAnimationFrame(countTimer);
  if (countSnap) clearTimeout(countSnap);

  /* Browsers pause requestAnimationFrame in background tabs, so an
     animated-only path would leave the headline stuck at Rs 0 for anyone
     who opens the page in a new tab. Skip straight to the value in that
     case, and keep a timer that snaps to it if the frames stall anyway. */
  if (REDUCED || document.hidden) { node.textContent = pkr(target); return; }

  var startVal = parseFloat((node.textContent || '').replace(/[^0-9.]/g, '')) || 0;
  var t0 = null;
  var dur = 520;

  function step(ts) {
    if (t0 === null) t0 = ts;
    var k = Math.min(1, (ts - t0) / dur);
    var eased = 1 - Math.pow(1 - k, 3);
    node.textContent = pkr(startVal + (target - startVal) * eased);
    if (k < 1) countTimer = requestAnimationFrame(step);
  }
  countTimer = requestAnimationFrame(step);
  countSnap = setTimeout(function () {
    if (countTimer) cancelAnimationFrame(countTimer);
    node.textContent = pkr(target);
  }, dur + 120);
}

function renderVerdict(list) {
  if (!list.length) {
    el.vProvider.textContent = 'No provider';
    el.vAmount.textContent = pkr(0);
    el.vDelta.innerHTML = '';
    return;
  }

  var best = list[0];
  el.vProvider.textContent = best.name;
  countTo(el.vAmount, best.received);

  if (list.length > 1) {
    var gap = best.received - list[list.length - 1].received;
    el.vDelta.innerHTML =
      '<span class="vd-num">' + pkr(gap) + '</span>' +
      '<span class="vd-lab">more than the worst option here</span>';
  } else {
    el.vDelta.innerHTML = '<span class="vd-lab">Only provider covering this payout method.</span>';
  }
}

function renderInsight(list) {
  if (list.length < 2) { el.insight.hidden = true; return; }

  var best = list[0];
  var worst = list[list.length - 1];
  var gap = best.received - worst.received;
  if (gap <= 0) { el.insight.hidden = true; return; }

  el.insight.hidden = false;

  var annual = gap * 12;
  var basis = 'Based on ' + sent(state.amount, state.corridor) + ' sent twelve times by ' +
              METHOD_LABEL[state.method] + ' — the same transfer you just priced.';

  /* A headline "worth Rs 380 a year" undersells the page. When the corridor
     is genuinely tight, say so plainly instead of dressing up a small number. */
  if (annual < 2000) {
    el.insight.classList.add('is-tight');
    el.insightKicker.textContent = 'Close call';
    el.insightLine.innerHTML =
      'Only <strong>' + pkr(gap) + '</strong> separates ' + best.name + ' from ' + worst.name +
      ' here. On this route, choose for <strong>speed and convenience</strong> rather than price.';
    el.insightFoot.textContent = basis;
    return;
  }

  el.insight.classList.remove('is-tight');
  el.insightKicker.textContent = 'If you send this every month';
  el.insightLine.innerHTML =
    'Choosing <strong>' + best.name + '</strong> over <strong>' + worst.name + '</strong> is worth ' +
    '<strong class="big">' + pkr(annual) + '</strong> a year.';
  el.insightFoot.textContent = basis;
}

/* The mid-market line doubles as the page's honesty statement: it names the
   true rate, where it came from, and that the margins are our own estimates. */
function renderFx() {
  var c = CORRIDORS[state.corridor];
  var mid = midFor(state.corridor);

  var published = fmtPublished(fx.date);
  var checked = fmtChecked(fx.checkedAt);

  if (el.fxNote) {
    var provenance;
    if (fx.live) {
      /* Two dates, because they answer different questions: when the rate
         was set, and when we last went and got it. */
      provenance = published ? 'Published ' + published : 'Fetched live';
      if (checked) provenance += ', checked ' + checked;
    } else {
      provenance = 'Last known value' + (published ? ' from ' + published : '') +
                   ' — the live rate feed could not be reached';
    }

    el.fxNote.innerHTML =
      '<strong>Mid-market rate: 1 ' + c.code + ' = ' + mid.toFixed(2) + ' PKR</strong> &middot; ' +
      provenance + '. Every provider quotes below this; the gap is their margin, ' +
      'and the margins shown are our own estimates.';
  }

  /* The eyebrow badge reports the check, not the publication — it is the
     thing that proves the page is pulling rates rather than shipping them. */
  if (el.fxStamp) {
    if (fx.checkedAt) {
      el.fxStamp.textContent = checked;
      el.fxStamp.setAttribute('datetime', new Date(fx.checkedAt).toISOString());
    } else {
      el.fxStamp.textContent = published || FX.fallbackDate;
      if (/^\d{4}-\d{2}-\d{2}$/.test(fx.date || '')) el.fxStamp.setAttribute('datetime', fx.date);
    }
  }
}

function render() {
  var c = CORRIDORS[state.corridor];
  var list = quote();

  el.symbol.textContent = c.symbol;
  el.code.textContent = c.code;
  el.methodHint.textContent = METHOD_HINT[state.method];

  /* The results heading names a currency on the corridor pages, so it has to
     follow the pills — otherwise switching to UAE on the UK page leaves a
     "GBP to PKR" heading sitting above a table of dirhams. Each page supplies
     its own wording via data-template; one without a {code} placeholder (the
     homepage) is currency-neutral and simply stays put. */
  if (el.resultsTitle) {
    var tpl = el.resultsTitle.getAttribute('data-template');
    if (tpl) el.resultsTitle.textContent = tpl.replace('{code}', c.code);
  }

  el.resultsSub.textContent =
    'Sending ' + sent(state.amount, state.corridor) + ' from ' + c.label +
    ' by ' + METHOD_LABEL[state.method] + ', ranked by what actually arrives in Pakistan.';

  Array.prototype.forEach.call(el.chips.children, function (chip) {
    var on = parseFloat(chip.getAttribute('data-value')) === state.amount;
    chip.classList.toggle('is-on', on);
  });

  renderFx();
  renderRows(list);
  renderVerdict(list);
  renderInsight(list);
}

/* ---------------- wiring ---------------- */

function setActive(container, node, attr) {
  Array.prototype.forEach.call(container.children, function (b) {
    var on = b === node;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  return node.getAttribute(attr);
}

/* Arrow-key movement inside a radio group, as expected of the role. */
function arrowNav(container, attr, apply) {
  container.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' &&
        e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    var items = Array.prototype.slice.call(container.children);
    var idx = items.indexOf(document.activeElement);
    if (idx === -1) return;
    e.preventDefault();
    var dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
    var next = items[(idx + dir + items.length) % items.length];
    next.focus();
    apply(setActive(container, next, attr));
  });
}

function applyCorridor(id) {
  state.corridor = id;
  state.amount = CORRIDORS[id].start;
  el.amount.value = state.amount;
  renderChips();
  render();
}

function init() {
  cacheDom();

  /* Corridor landing pages set <body data-corridor="uae"> so the calculator
     opens on the route that page is about. Falls back to UK on the homepage. */
  var wanted = document.body.getAttribute('data-corridor');
  if (wanted && CORRIDORS[wanted]) state.corridor = wanted;
  Array.prototype.forEach.call(el.pills.children, function (b) {
    var on = b.getAttribute('data-corridor') === state.corridor;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });

  state.amount = CORRIDORS[state.corridor].start;
  el.amount.value = state.amount;
  renderChips();

  /* Paint immediately on the fallback rate, then repaint once the live
     rate arrives. The page is never blank waiting on a network call. */
  render();
  loadFX().then(render);

  el.pills.addEventListener('click', function (e) {
    var btn = e.target.closest('.pill');
    if (!btn) return;
    applyCorridor(setActive(el.pills, btn, 'data-corridor'));
  });
  arrowNav(el.pills, 'data-corridor', applyCorridor);

  el.seg.addEventListener('click', function (e) {
    var btn = e.target.closest('.seg-btn');
    if (!btn) return;
    state.method = setActive(el.seg, btn, 'data-method');
    render();
  });
  arrowNav(el.seg, 'data-method', function (m) { state.method = m; render(); });

  el.chips.addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    state.amount = parseFloat(chip.getAttribute('data-value'));
    el.amount.value = state.amount;
    render();
  });

  el.amount.addEventListener('input', function () {
    var v = parseFloat(el.amount.value);
    state.amount = (isFinite(v) && v > 0) ? Math.min(v, 1000000) : 0;
    render();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
