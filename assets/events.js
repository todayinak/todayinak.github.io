/* Today in AK: event search + filters, plus live "Today" labels and hiding of past listings.
   Progressive enhancement: without this file the page is the full list, grouped by type, with plain weekday + date
   labels and jump links. No frameworks, no tracking, no accounts.
   One outside request: the current Anchorage temperature from Open-Meteo (no key, nothing about the visitor is sent).
   Saved events (hearts) live only in this browser's localStorage, as event ids + last date; never sent anywhere.
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
    pruneSaved(today);
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

  // ---------- saved events (hearts): ids in localStorage on this device only, no account, nothing sent ----------
  var SKEY = 'tia-saved-v1', savedView = false, saved = loadSaved(),
      savedBtn = document.getElementById('evsaved'), savedN = document.getElementById('evsavedn'),
      nosaved = document.getElementById('evnosaved'), savedLink = document.getElementById('savedlink'),
      savedLinkN = document.getElementById('savedlinkn');
  function loadSaved() {   // { "<event id>": "<last date YYYY-MM-DD>" }
    try { var o = JSON.parse(localStorage.getItem(SKEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }
    catch (err) { return {}; }
  }
  function storeSaved() { try { localStorage.setItem(SKEY, JSON.stringify(saved)); } catch (err) { /* private mode: keep it for this visit */ } }
  function savedCount() { return Object.keys(saved).length; }
  var byId = {};
  cards.forEach(function (el) { el._id = el.getAttribute('data-id') || ''; if (el._id) byId[el._id] = el; });
  // Past saved events drop off quietly: when their card is over, or (card gone from this week's page) after their last date.
  function pruneSaved(today) {
    var changed = false;
    Object.keys(saved).forEach(function (id) {
      var el = byId[id], last = typeof saved[id] === 'string' ? saved[id] : '';
      if (el ? el._past : (!last || last < today)) { delete saved[id]; changed = true; }
    });
    if (changed) storeSaved();
  }
  function updateSavedUI() {
    var n = savedCount();
    cards.forEach(function (el) {
      var h = el._heart; if (!h) return;
      var on = saved.hasOwnProperty(el._id);
      h.setAttribute('aria-pressed', String(on));
      h.setAttribute('aria-label', (on ? 'Saved: ' : 'Save: ') + el._title);
      h.title = on ? 'Saved (tap to remove)' : 'Save this event';
    });
    if (savedN) savedN.textContent = n;
    if (savedLinkN) savedLinkN.textContent = n;
    if (savedLink) savedLink.hidden = !hasFinder || n === 0;
  }
  function toggleSaved(el) {
    if (saved.hasOwnProperty(el._id)) { delete saved[el._id]; toast('Removed from saved'); }
    else { saved[el._id] = el._days[el._days.length - 1] || el._next; toast('Saved to My saved events'); }
    storeSaved(); updateSavedUI();
    if (savedView) apply();
  }
  function setSavedView(on) { savedView = !!on; apply(); }
  window.addEventListener('storage', function (ev) { if (ev.key === SKEY) { saved = loadSaved(); updateSavedUI(); apply(); } });

  // ---------- small toast ("Link copied", "Saved") ----------
  var toastEl = document.getElementById('toast'), toastT = 0;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg; toastEl.hidden = false; toastEl.classList.remove('show');
    void toastEl.offsetWidth; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('show'); toastT = setTimeout(function () { toastEl.hidden = true; }, 250); }, 2200);
  }

  // ---------- invite a friend: native share sheet on phones, copy link + toast elsewhere ----------
  var canon = document.querySelector('link[rel="canonical"]'), SITE = canon ? canon.href : location.href.split('#')[0];
  var MSG = 'Found this — free & fun things happening around Anchorage today 👉';
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
    return new Promise(function (ok, no) {
      var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? ok() : no(); } catch (err) { no(err); }
      document.body.removeChild(ta);
    });
  }
  var coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  function share(title, text, url) {
    if (navigator.share && coarse) {
      navigator.share({ title: title, text: text, url: url }).catch(function () { /* closed the sheet: nothing to do */ });
      return;
    }
    copyText(text + ' ' + url).then(function () { toast('Link copied'); },
                                    function () { window.prompt('Copy this link:', url); });
  }
  var invite = document.getElementById('invite');
  if (invite) { invite.hidden = false; invite.addEventListener('click', function () { share('Today in AK', MSG, SITE); }); }

  // ---------- add to calendar: .ics built in the browser, Alaska time ----------
  function icsEsc(t) { return String(t).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1'); }
  function icsDT(iso, hhmm) { return iso.replace(/-/g, '') + 'T' + hhmm.replace(':', '') + '00'; }
  function plusMin(iso, hhmm, mins) {   // local wall-clock math, returns [iso, "HH:MM"]
    var t = hhmm.split(':'), m = +t[0] * 60 + +t[1] + mins, dd = Math.floor(m / 1440); m -= dd * 1440;
    return [addDays(iso, dd), pad(Math.floor(m / 60)) + ':' + pad(m % 60)];
  }
  var VTZ = ['BEGIN:VTIMEZONE', 'TZID:America/Anchorage',
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0900', 'TZOFFSETTO:-0800', 'TZNAME:AKDT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:-0800', 'TZOFFSETTO:-0900', 'TZNAME:AKST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
    'END:VTIMEZONE'];
  function fold(line) { var out = []; while (line.length > 73) { out.push(line.slice(0, 73)); line = ' ' + line.slice(73); } out.push(line); return out.join('\r\n'); }
  function ics(el) {
    var day = el._next || el._days[0], st = el._start, en = el._end, L = [];
    var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    L.push('BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Today in AK//Events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH');
    if (st) L = L.concat(VTZ);
    L.push('BEGIN:VEVENT', 'UID:' + el._id + '-' + day + '-todayinak.github.io', 'DTSTAMP:' + stamp);
    if (st) {
      var e2 = en ? [en <= st ? addDays(day, 1) : day, en] : plusMin(day, st, 120);   // no listed end: hold 2 hours
      L.push('DTSTART;TZID=America/Anchorage:' + icsDT(day, st), 'DTEND;TZID=America/Anchorage:' + icsDT(e2[0], e2[1]));
    } else {
      L.push('DTSTART;VALUE=DATE:' + day.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + addDays(day, 1).replace(/-/g, ''));
    }
    L.push('SUMMARY:' + icsEsc(el._title), 'LOCATION:' + icsEsc(el._where + ', Alaska'),
      'DESCRIPTION:' + icsEsc(el._time + (en ? '' : ' (end time not listed)') + '. ' + el._price + '. Details: ' + el._url + ' · Found on Today in AK ' + SITE),
      'URL:' + el._url, 'END:VEVENT', 'END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }
  function download(el) {
    var blob = new Blob([ics(el)], { type: 'text/calendar;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = el._id + '.ics'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    toast('Calendar file downloaded');
  }

  // ---------- per-card buttons (added by JS, so the no-JS page stays one link per card) ----------
  var ICON = {
    heart: '<path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.4 2.5h1.8c.8-1.3 2.3-2.5 4.4-2.5 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z"/>',
    share: '<path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/>'
  };
  function btn(cls, icon, label) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'act ' + cls; b.setAttribute('aria-label', label); b.title = label;
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[icon] + '</svg>'; return b;
  }
  function enhanceCards() {
    cards.forEach(function (el) {
      if (!el._id) return;
      var h4 = el.querySelector('h4'), wh = el.querySelector('.where'), more = el.querySelector('a.more'), pr = el.querySelector('.meta .pill');
      el._title = h4 ? h4.textContent : ''; el._where = wh ? wh.textContent.replace(' · ', ', ') : '';
      el._url = more ? more.href : SITE; el._price = pr ? pr.textContent : '';
      var w = el.querySelector('.pill.when'); el._time = w ? w.textContent.replace(el._wdText, '').replace(/^\s*·\s*/, '') : '';
      var box = document.createElement('div'); box.className = 'acts';
      var sb = btn('share', 'share', 'Share: ' + el._title), cb = btn('cal', 'cal', 'Add to calendar: ' + el._title), hb = btn('heart', 'heart', 'Save: ' + el._title);
      hb.setAttribute('aria-pressed', 'false'); el._heart = hb;
      sb.addEventListener('click', function () {
        var when = (el._next ? label(el._next) : el._wdText) + (el._time ? ' · ' + el._time : '');
        share(el._title, 'Found this — ' + el._title + ', ' + when + ' at ' + el._where + ' 👉', SITE + '#ev-' + el._id);
      });
      cb.addEventListener('click', function () { download(el); });
      hb.addEventListener('click', function () { toggleSaved(el); });
      box.appendChild(sb); box.appendChild(cb); box.appendChild(hb);
      var top = el.querySelector('.pills'); if (top) top.classList.add('toprow');
      el.appendChild(box); el.classList.add('has-acts');   // after the details link in tab order; placed top-right by CSS
    });
  }
  // Shared event links (todayinak.github.io/#ev-<id>) scroll to that card and give it a short glow
  function evFromHash() {
    var m = /^#ev-([a-z0-9-]+)$/.exec(location.hash), el = m && byId[m[1]];
    if (!el || el.hidden) return;
    el.scrollIntoView({ block: 'center' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  // ---------- header dial: live Anchorage temperature (Open-Meteo, no key) + tonight's moon phase ----------
  var dialEl = document.getElementById('dial'), dTemp = document.getElementById('dialtemp'), dSep = document.getElementById('dialsep'),
      dMoon = document.getElementById('dialmoon'), lastMoon = '';
  var PHASES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  function moonSvg(p) {   // p: 0 new … .5 full … 1 new; lit side drawn as seen from the northern hemisphere
    var r = 9, c = Math.cos(2 * Math.PI * p), rx = Math.abs(c) * r, wax = p < 0.5, k = (1 - c) / 2;
    var lit = k < 0.03 ? '' : k > 0.97 ? '<circle cx="12" cy="12" r="9" class="lit"/>' :
      '<path class="lit" d="M12 3A9 9 0 0 ' + (wax ? 1 : 0) + ' 12 21A' + rx.toFixed(2) + ' 9 0 0 ' + (wax ? (c > 0 ? 0 : 1) : (c < 0 ? 0 : 1)) + ' 12 3Z"/>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" class="dark"/>' + lit + '</svg>';
  }
  function moon() {
    if (!dialEl) return;
    var t = typeof window.__tiaTestNow === 'number' ? window.__tiaTestNow : Date.now(), now = akNow(), today = now.slice(0, 10);
    var off = Date.parse(now + ':00Z') - Math.floor(t / 60000) * 60000;          // Alaska offset from UTC, in ms
    var when = now.slice(11) >= '22:00' ? t : Date.parse(today + 'T22:00:00Z') - off;   // "tonight" = 10 PM Alaska (or now if later)
    var SYN = 29.530588853, age = ((when - Date.UTC(2000, 0, 6, 18, 14)) / 864e5) % SYN; if (age < 0) age += SYN;
    var p = age / SYN, idx = Math.floor(p * 8 + 0.5) % 8, key = idx + ':' + Math.round(p * 100);
    if (key === lastMoon) return; lastMoon = key;
    dMoon.innerHTML = moonSvg(p) + '<span>' + PHASES[idx] + ' tonight</span>';
    dMoon.title = PHASES[idx] + ', about ' + Math.round((1 - Math.cos(2 * Math.PI * p)) * 50) + '% lit';
    dialEl.hidden = false;
  }
  function dial() {
    moon();
    if (!dialEl || !window.fetch || window.__tiaNoWeather) return;
    var ctl = window.AbortController ? new AbortController() : null, to = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
    fetch('https://api.open-meteo.com/v1/forecast?latitude=61.2181&longitude=-149.9003&current=temperature_2m&temperature_unit=fahrenheit&timezone=America%2FAnchorage',
          { signal: ctl ? ctl.signal : undefined, credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) {
        var v = j && j.current && j.current.temperature_2m; if (typeof v !== 'number' || !isFinite(v)) throw 0;
        dTemp.textContent = 'Anchorage ' + Math.round(v) + '°F'; dTemp.hidden = dSep.hidden = false;
      })
      .catch(function () { dTemp.hidden = dSep.hidden = true; })   // quietly hide the temperature; the moon stays
      .then(function () { clearTimeout(to); });
  }

  // ---------- search + filters ----------
  function apply() {
    var words = hasFinder ? norm(q.value).trim().split(/\s+/).filter(Boolean) : [], d = hasFinder ? day.value : '', a = hasFinder ? age.value : '',
        f = hasFinder && free.checked, sv = savedView, shown = 0, total = 0;
    items.forEach(function (el) {
      if (!el._past) total++;
      var ok = !el._past && (!cat || el.getAttribute('data-sec') === cat) &&
               (!d || (' ' + el.getAttribute('data-days') + ' ').indexOf(' ' + d + ' ') > -1) &&
               (!a || el.getAttribute('data-age') === a) &&
               (!f || el.hasAttribute('data-free')) &&
               (!sv || (!!el._id && saved.hasOwnProperty(el._id))) &&
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
    var active = cat || words.length || d || a || f || sv;
    count.textContent = sv && !(cat || words.length || d || a || f) ? (shown === 1 ? '1 saved event' : shown + ' saved events')
                      : active ? (shown === 1 ? '1 listing matches' : shown + ' listings match') + ' (of ' + total + ')'
                               : (total === 0 ? '' : total === 1 ? 'Showing 1 upcoming listing' : 'Showing all ' + total + ' upcoming listings');
    if (done) done.hidden = total !== 0;
    var noSaved = sv && savedCount() === 0;
    none.hidden = shown !== 0 || total === 0 || noSaved;
    if (nosaved) nosaved.hidden = !noSaved;
    if (savedBtn) savedBtn.setAttribute('aria-pressed', String(sv));
  }
  function refresh() { timePass(); apply(); updateSavedUI(); moon(); }
  function tick() { if (akNow() !== lastKey) refresh(); }

  if (hasFinder) {
    var reset = function () { q.value = ''; day.value = ''; age.value = ''; free.checked = false; cat = ''; savedView = false; apply(); };
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
      if (location.hash === '#saved') { setSavedView(true); finder.scrollIntoView(); }
    };
    window.addEventListener('hashchange', fromHash);
    finder.hidden = false;
    if (jump) jump.hidden = true;
  }
  if (hasFinder) {
    if (savedBtn) savedBtn.addEventListener('click', function () { setSavedView(!savedView); });
    var off = document.getElementById('evsavedoff'); if (off) off.addEventListener('click', function () { setSavedView(false); });
    if (savedLink) savedLink.addEventListener('click', function (ev) { ev.preventDefault(); setSavedView(true); finder.scrollIntoView({ behavior: 'smooth' }); });
  }
  enhanceCards();
  refresh();
  if (hasFinder) fromHash();
  evFromHash(); window.addEventListener('hashchange', evFromHash);
  dial(); setInterval(function () { if (!document.hidden) dial(); }, 15 * 60000);
  // Keep it current on a page left open: look again every minute (cheap: only re-renders when the Alaska minute changed),
  // and right away when the tab comes back or the page is restored from the back/forward cache.
  setInterval(tick, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  window.addEventListener('pageshow', tick);
  window.addEventListener('focus', tick);
  window.__tiaRefresh = refresh;   // headless tests only
})();
