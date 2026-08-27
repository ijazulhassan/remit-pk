/* ============================================================
   RemitPK — comparison engine
   ------------------------------------------------------------
   TO UPDATE RATES: edit the CORRIDORS object below. Nothing else
   in this file needs touching — the table, ranking, verdict and
   annual-saving figure all recalculate from it.

   TO ADD YOUR AFFILIATE LINKS: replace the values in LINKS below
   with your tracking URLs once each program approves you. Until
   then they point at the providers' public sites, so every
   button on the page still works.
   ============================================================ */

var LINKS = {
  wise:       'https://wise.com/',
  remitly:    'https://www.remitly.com/',
  worldremit: 'https://www.worldremit.com/'
};

/* Fee model: fee = fixed + (amount * pct / 100), unless the amount
   reaches waiveAbove, in which case the provider charges nothing.
   Set a method to null when the provider does not offer it. */

var CORRIDORS = {
  uk: {
    label: 'United Kingdom', code: 'GBP', symbol: '£',
    presets: [100, 200, 500, 1000], start: 100,
    providers: [
      { id: 'wise', name: 'Wise', mark: 'W',
        bank:   { rate: 397.4, fixed: 0.30, pct: 0.60, waiveAbove: null, speed: 'Within hours' },
        cash:   null,
        wallet: null },
      { id: 'remitly', name: 'Remitly', mark: 'R',
        bank:   { rate: 393.1, fixed: 2.99, pct: 0, waiveAbove: 100, speed: 'Minutes – 1 day' },
        cash:   { rate: 390.2, fixed: 3.99, pct: 0, waiveAbove: 300, speed: 'Minutes' },
        wallet: { rate: 392.4, fixed: 2.99, pct: 0, waiveAbove: 100, speed: 'Minutes' } },
      { id: 'worldremit', name: 'WorldRemit', mark: 'WR',
        bank:   { rate: 391.8, fixed: 1.99, pct: 0, waiveAbove: null, speed: 'Minutes – 1 day' },
        cash:   { rate: 389.5, fixed: 2.99, pct: 0, waiveAbove: null, speed: 'Minutes' },
        wallet: { rate: 391.2, fixed: 1.99, pct: 0, waiveAbove: null, speed: 'Minutes' } }
    ]
  },

  uae: {
    label: 'United Arab Emirates', code: 'AED', symbol: 'AED',
    presets: [500, 1000, 2000, 5000], start: 500,
    providers: [
      { id: 'wise', name: 'Wise', mark: 'W',
        bank:   { rate: 77.9, fixed: 1.50, pct: 0.50, waiveAbove: null, speed: 'Within hours' },
        cash:   null,
        wallet: null },
      { id: 'remitly', name: 'Remitly', mark: 'R',
        bank:   { rate: 76.8, fixed: 12.99, pct: 0, waiveAbove: 500, speed: 'Minutes – 1 day' },
        cash:   { rate: 76.0, fixed: 15.00, pct: 0, waiveAbove: 1000, speed: 'Minutes' },
        wallet: { rate: 76.5, fixed: 12.99, pct: 0, waiveAbove: 500, speed: 'Minutes' } },
      { id: 'worldremit', name: 'WorldRemit', mark: 'WR',
        bank:   { rate: 77.1, fixed: 9.99, pct: 0, waiveAbove: null, speed: 'Minutes – 1 day' },
        cash:   { rate: 76.3, fixed: 14.99, pct: 0, waiveAbove: null, speed: 'Minutes' },
        wallet: { rate: 76.9, fixed: 9.99, pct: 0, waiveAbove: null, speed: 'Minutes' } }
    ]
  },

  us: {
    label: 'United States', code: 'USD', symbol: '$',
    presets: [100, 250, 500, 1000], start: 100,
    providers: [
      { id: 'wise', name: 'Wise', mark: 'W',
        bank:   { rate: 281.6, fixed: 0.60, pct: 0.72, waiveAbove: null, speed: 'Within hours' },
        cash:   null,
        wallet: null },
      { id: 'remitly', name: 'Remitly', mark: 'R',
        bank:   { rate: 278.9, fixed: 3.99, pct: 0, waiveAbove: 100, speed: 'Minutes – 1 day' },
        cash:   { rate: 276.8, fixed: 4.99, pct: 0, waiveAbove: 300, speed: 'Minutes' },
        wallet: { rate: 278.2, fixed: 3.99, pct: 0, waiveAbove: 100, speed: 'Minutes' } },
      { id: 'worldremit', name: 'WorldRemit', mark: 'WR',
        bank:   { rate: 277.5, fixed: 3.99, pct: 0, waiveAbove: null, speed: 'Minutes – 1 day' },
        cash:   { rate: 275.4, fixed: 4.99, pct: 0, waiveAbove: null, speed: 'Minutes' },
        wallet: { rate: 277.0, fixed: 3.99, pct: 0, waiveAbove: null, speed: 'Minutes' } }
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

function feeFor(plan, amount) {
  if (plan.waiveAbove !== null && amount >= plan.waiveAbove) return 0;
  return plan.fixed + (amount * plan.pct / 100);
}

/* Build the ranked list for the current state. */
function quote() {
  var c = CORRIDORS[state.corridor];
  var amount = state.amount;

  var out = [];
  for (var i = 0; i < c.providers.length; i++) {
    var p = c.providers[i];
    var plan = p[state.method];
    if (!plan) continue;

    var fee = feeFor(plan, amount);
    var converted = Math.max(0, amount - fee);
    out.push({
      id: p.id,
      name: p.name,
      mark: p.mark,
      fee: fee,
      rate: plan.rate,
      speed: plan.speed,
      received: converted * plan.rate
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
  el.resultsSub = document.getElementById('resultsSub');
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
      : '<span class="row-delta">−' + pkr(best - r.received).replace('Rs ', 'Rs ') + '</span>';

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
          '<span class="fact-v">' + r.rate.toFixed(1) + '</span></span>' +
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

function render() {
  var c = CORRIDORS[state.corridor];
  var list = quote();

  el.symbol.textContent = c.symbol;
  el.code.textContent = c.code;
  el.methodHint.textContent = METHOD_HINT[state.method];
  el.resultsSub.textContent =
    'Sending ' + sent(state.amount, state.corridor) + ' from ' + c.label +
    ' by ' + METHOD_LABEL[state.method] + ', ranked by what actually arrives in Pakistan.';

  Array.prototype.forEach.call(el.chips.children, function (chip) {
    var on = parseFloat(chip.getAttribute('data-value')) === state.amount;
    chip.classList.toggle('is-on', on);
  });

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

function init() {
  cacheDom();
  state.amount = CORRIDORS[state.corridor].start;
  el.amount.value = state.amount;
  renderChips();
  render();

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

function applyCorridor(id) {
  state.corridor = id;
  state.amount = CORRIDORS[id].start;
  el.amount.value = state.amount;
  renderChips();
  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
