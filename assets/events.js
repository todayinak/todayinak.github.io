/* Today in AK: event search + filters, plus live "Today" labels and hiding of past listings.
   Progressive enhancement: without this file the page is the full list, grouped by type, with plain weekday + date
   labels and jump links. No frameworks, no external requests, no tracking, nothing stored.
   All date math is Alaska time (America/Anchorage), whatever time zone the visitor's device is set to. */
(function () {
  if (!document.querySelector) return;
  var TZ = 'America/Anchorage', WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---------- Alaska clock ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  var fmt = null;
  try {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    if (!fmt.formatToParts) fmt = null;
  } catch (err) { fmt = null; }
  // Fallback when the browser has no time zone data: US rules, AKDT (UTC-8) from the 2nd Sunday of March 2 AM
  // to the 1st Sunday of November 2 AM, AKST (UTC-9) otherwise.
  function nthSunday(y, m, n) { var d = new Date(Date.UTC(y, m, 1)); return 1 + (7 - d.getUTCDay()) % 7 + 7 * (n - 1); }
  function akFallback(t) {
    var y = new Date(t).getUTCFullYear(),
        start = Date.UTC(y, 2, nthSunday(y, 2, 2), 2 + 9),     // 2 AM AKST = 11:00 UTC
        end = Date.UTC(y, 10, nthSunday(y, 10, 1), 2 + 8);     // 2 AM AKDT = 10:00 UTC
    var off = (t >= start && t < end) ? -8 : -9, a = new Date(t + off * 3600e3);
    return a.getUTCFullYear() + '-' + pad(a.getUTCMonth() + 1) + '-' + pad(a.getUTCDate()) + 'T' + pad(a.getUTCHours()) + ':' + pad(a.getUTCMinutes());
  }
  function akNow() {   // "YYYY-MM-DDTHH:MM" in Alaska time
    var t = Date.now();
    if (typeof window.__tiaTestNow === 'number') t = window.__tiaTestNow;   // headless tests only (set before load), never from the URL
    if (!fmt || window.__tiaTestNoIntl) return akFallback(t);
    var p = {}; fmt.formatToParts(new Date(t)).forEach(function (x) { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day + 'T' + (p.hour === '24' ? '00' : p.hour) + ':' + p.minute;
  }
  function addDays(iso, n) { var a = iso.split('-'), d = new Date(Date.UTC(+a[0], a[1] - 1, +a[2] + n)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function label(iso) { var a = iso.split('-'), d = new Date(Date.UTC(+a[0], a[1] - 1, +a[2])); return WD[d.getUTCDay()] + ' ' + MO[d.getUTCMonth()] + ' ' + d.getUTCDate(); }
  // When a listing on day `iso` is over: its end time if listed (an end earlier than the start runs past midnight),
  // otherwise the end of that Alaska day, so start-time-only listings stay up all day.
  function endsAt(iso, start, end) {
    if (!end) return addDays(iso, 1) + 'T00:00';
    return (start && end <= start ? addDays(iso, 1) : iso) + 'T' + end;
  }

  // ---------- elements ----------
  var finder = document.getElementById('finder'), hasFinder = !!finder;
  var q = document.getElementById('evq'), day = document.getElementById('evday'), age = document.getElementById('evage'),
      free = document.getElementById('evfree'), count = document.getElementById('evcount'), none = document.getElementById('evnone'),
      done = document.getElementById('evdone'), from = document.getElementById('evfrom'),
      chips = hasFinder ? [].slice.call(finder.querySelectorAll('.chip')) : [], secs = [].slice.call(document.querySelectorAll('.evsec')),
      cards = [].slice.call(document.querySelectorAll('#events .card.ev')), runs = [].slice.call(document.querySelectorAll('#events li.run')),
      items = cards.concat(runs), running = document.getElementById('running'), jump = document.querySelector('.catnav'), cat = '';
  var dayOpts = day ? [].slice.call(day.options).filter(function (o) { return o.value; }) : [];
  dayOpts.forEach(function (o) { o._label = o.textContent; });
  cards.forEach(function (el, i) {
    el._i = i; el._days = (el.getAttribute('data-days') || '').split(' ').filter(Boolean).sort();
    el._start = el.getAttribute('data-start') || ''; el._end = el.getAttribute('data-end') || '';
    var wd = el.querySelector('.pill.when .wd'); el._wd = wd; el._wdText = wd ? wd.textContent : '';
  });
  runs.forEach(function (el) { el._days = (el.getAttribute('data-days') || '').split(' ').filter(Boolean).sort(); });

  function norm(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, "'"); }
  items.forEach(function (el) {   // search text: title, venue, town, note (+ category/when for convenience)
    var parts = [].map.call(el.querySelectorAll('h4, .where, .note, .pill.cat, b, li.run > span'), function (n) { return n.textContent; });
    if (el.classList.contains('run')) parts.push(el.textContent);
    el._q = norm(parts.join(' '));
  });

  // ---------- time pass: Today/Tomorrow labels, hide what's over, keep date order ----------
  var lastKey = '';
  function timePass() {
    var now = akNow(), today = now.slice(0, 10), tomorrow = addDays(today, 1), yesterday = addDays(today, -1);
    cards.forEach(function (el) {
      var next = null;   // the listing's next date that isn't over yet
      for (var i = 0; i < el._days.length; i++) if (endsAt(el._days[i], el._start, el._end) > now) { next = el._days[i]; break; }
      el._past = !next; el._next = next || '';
      el.classList.toggle('is-today', next === today || next === yesterday);
      if (!el._wd) return;
      if (!next) { el._wd.textContent = el._wdText; el._wd.removeAttribute('title'); return; }
      var rel = next === today ? 'Today' : next === tomorrow ? 'Tomorrow' : next === yesterday ? 'Still on' : '';
      el._wd.textContent = rel ? rel + ' · ' + label(next) : label(next);   // e.g. "Today · Sun Oct 25"
      el._wd.setAttribute('title', label(next));
      el._wd.classList.toggle('rel', !!rel);
    });
    runs.forEach(function (el) { el._past = !el._days.length || el._days[el._days.length - 1] < today; });
    // date order within each section: next upcoming date, then start time, then the original order
    secs.forEach(function (s) {
      var grid = s.querySelector('.evgrid'); if (!grid) return;
      var list = [].slice.call(grid.querySelectorAll('.card.ev'));
      list.sort(function (a, b) { return a._next < b._next ? -1 : a._next > b._next ? 1 : a._start < b._start ? -1 : a._start > b._start ? 1 : a._i - b._i; });
      list.forEach(function (c) { grid.appendChild(c); });
    });
    // day filter: drop past days, name today/tomorrow
    dayOpts.forEach(function (o) {
      var past = o.value < today;
      if (past && day.value === o.value) day.value = '';
      o.hidden = o.disabled = past;
      o.textContent = o.value === today ? 'Today (' + o._label + ')' : o.value === tomorrow ? 'Tomorrow (' + o._label + ')' : o._label;
    });
    // category counts (chips + jump links) only count what's still coming up
    var live = cards.filter(function (c) { return !c._past; });
    chips.forEach(function (c) {
      var s = c.getAttribute('data-sec'), n = live.filter(function (x) { return !s || x.getAttribute('data-sec') === s; }).length, sp = c.querySelector('span');
      if (sp) sp.textContent = n;
      c.hidden = !!s && n === 0;
      if (s && n === 0 && cat === s) cat = '';
    });
    if (jump) [].forEach.call(jump.querySelectorAll('a'), function (a) {
      var s = (a.getAttribute('href') || '').replace('#cat-', ''), n = live.filter(function (x) { return x.getAttribute('data-sec') === s; }).length, sp = a.querySelector('span');
      if (sp) sp.textContent = n; a.hidden = n === 0;
    });
    if (from) {
      var firstLive = live.map(function (c) { return c._next; }).sort()[0];
      if (firstLive) from.textContent = label(firstLive);
    }
    trucks(now, today, tomorrow);
    lastKey = now;
  }

  // ---------- food trucks: Today/Tomorrow day headers, hide stops that are over ----------
  function trucks(now, today, tomorrow) {
    [].forEach.call(document.querySelectorAll('#trucks details.area'), function (area) {
      var shown = 0, firstVis = true;
      [].forEach.call(area.querySelectorAll('li.stop'), function (li) {
        var d = li.getAttribute('data-day');
        li.hidden = !d || endsAt(d, li.getAttribute('data-start'), li.getAttribute('data-end')) <= now;
        if (!li.hidden) shown++;
      });
      [].forEach.call(area.querySelectorAll('li.tday'), function (h) {
        var d = h.getAttribute('data-day'), n = h.nextElementSibling, any = false;
        while (n && n.classList.contains('stop')) { if (!n.hidden) any = true; n = n.nextElementSibling; }
        if (!h._label) h._label = h.textContent;
        h.hidden = !any;
        h.textContent = d === today ? 'Today · ' + h._label : d === tomorrow ? 'Tomorrow · ' + h._label : h._label;
        h.classList.toggle('firstvis', any && firstVis); if (any) firstVis = false;
      });
      var c = area.querySelector('summary .n'); if (c) c.textContent = shown === 0 ? 'none left' : shown === 1 ? '1 stop' : shown + ' stops';
      var msg = area.querySelector('.tdone'); if (msg) msg.hidden = shown > 0;
    });
  }

  // ---------- search + filters ----------
  function apply() {
    var words = hasFinder ? norm(q.value).trim().split(/\s+/).filter(Boolean) : [], d = hasFinder ? day.value : '', a = hasFinder ? age.value : '',
        f = hasFinder && free.checked, shown = 0, total = 0;
    items.forEach(function (el) {
      if (!el._past) total++;
      var ok = !el._past && (!cat || el.getAttribute('data-sec') === cat) &&
               (!d || (' ' + el.getAttribute('data-days') + ' ').indexOf(' ' + d + ' ') > -1) &&
               (!a || el.getAttribute('data-age') === a) &&
               (!f || el.hasAttribute('data-free')) &&
               words.every(function (w) { return el._q.indexOf(w) > -1; });
      el.hidden = !ok; if (ok) shown++;
    });
    secs.forEach(function (s) {
      var n = s.querySelectorAll('.card.ev:not([hidden])').length;
      s.hidden = n === 0;
      var c = s.querySelector('.sech .n'); if (c) c.textContent = n;
    });
    if (running) running.hidden = !running.querySelector('li.run:not([hidden])');
    if (!hasFinder) { if (done) done.hidden = total !== 0; return; }
    chips.forEach(function (c) { c.setAttribute('aria-pressed', String(c.getAttribute('data-sec') === cat)); });
    var active = cat || words.length || d || a || f;
    count.textContent = active ? (shown === 1 ? '1 listing matches' : shown + ' listings match') + ' (of ' + total + ')'
                               : (total === 0 ? '' : total === 1 ? 'Showing 1 upcoming listing' : 'Showing all ' + total + ' upcoming listings');
    if (done) done.hidden = total !== 0;
    none.hidden = shown !== 0 || total === 0;
  }
  function refresh() { timePass(); apply(); }
  function tick() { if (akNow() !== lastKey) refresh(); }

  if (hasFinder) {
    var reset = function () { q.value = ''; day.value = ''; age.value = ''; free.checked = false; cat = ''; apply(); };
    chips.forEach(function (c) {
      c.addEventListener('click', function () { var s = c.getAttribute('data-sec'); cat = (s === cat && s !== '') ? '' : s; apply(); });
    });
    q.addEventListener('input', apply);
    q.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { q.value = ''; apply(); } });
    [day, age, free].forEach(function (el) { el.addEventListener('change', apply); });
    document.getElementById('evclear').addEventListener('click', function () { q.value = ''; apply(); q.focus(); });
    document.getElementById('evreset').addEventListener('click', function () { reset(); q.focus(); });
    // Links like todayinak.github.io/#cat-comedy open with that category selected
    var fromHash = function () {
      var m = /^#cat-([a-z]+)$/.exec(location.hash);
      if (m && chips.some(function (c) { return c.getAttribute('data-sec') === m[1] && !c.hidden; })) { cat = m[1]; apply(); }
    };
    window.addEventListener('hashchange', fromHash);
    finder.hidden = false;
    if (jump) jump.hidden = true;
  }
  refresh();
  if (hasFinder) fromHash();
  // Keep it current on a page left open: look again every minute (cheap: only re-renders when the Alaska minute changed),
  // and right away when the tab comes back or the page is restored from the back/forward cache.
  setInterval(tick, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  window.addEventListener('pageshow', tick);
  window.addEventListener('focus', tick);
  window.__tiaRefresh = refresh;   // headless tests only
})();
