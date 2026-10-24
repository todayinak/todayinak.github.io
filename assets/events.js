/* Today in AK: event search + filters. Progressive enhancement: without this file the page is the full list,
   grouped by type, with jump links. No frameworks, no external requests, no tracking, nothing stored. */
(function () {
  var finder = document.getElementById('finder');
  if (!finder || !document.querySelector) return;
  var q = document.getElementById('evq'), day = document.getElementById('evday'), age = document.getElementById('evage'),
      free = document.getElementById('evfree'), count = document.getElementById('evcount'), none = document.getElementById('evnone'),
      chips = [].slice.call(finder.querySelectorAll('.chip')), secs = [].slice.call(document.querySelectorAll('.evsec')),
      items = [].slice.call(document.querySelectorAll('#events .card.ev, #events li.run')),
      running = document.getElementById('running'), jump = document.querySelector('.catnav'), cat = '';

  function norm(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, "'"); }
  // Search text: title, venue, town, note (+ category/when for convenience)
  items.forEach(function (el) {
    var parts = [].map.call(el.querySelectorAll('h4, .where, .note, .pill.cat, b, li.run > span'), function (n) { return n.textContent; });
    if (el.classList.contains('run')) parts.push(el.textContent);
    el._q = norm(parts.join(' '));
  });

  function apply() {
    var words = norm(q.value).trim().split(/\s+/).filter(Boolean), d = day.value, a = age.value, f = free.checked, shown = 0, total = items.length;
    items.forEach(function (el) {
      var ok = (!cat || el.getAttribute('data-sec') === cat) &&
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
    chips.forEach(function (c) { c.setAttribute('aria-pressed', String(c.getAttribute('data-sec') === cat)); });
    var active = cat || words.length || d || a || f;
    count.textContent = active ? (shown === 1 ? '1 listing matches' : shown + ' listings match') + ' (of ' + total + ')'
                               : 'Showing all ' + total + ' listings';
    none.hidden = shown !== 0;
  }
  function reset() { q.value = ''; day.value = ''; age.value = ''; free.checked = false; cat = ''; apply(); }

  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      var s = c.getAttribute('data-sec'); cat = (s === cat && s !== '') ? '' : s; apply();
    });
  });
  q.addEventListener('input', apply);
  q.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { q.value = ''; apply(); } });
  [day, age, free].forEach(function (el) { el.addEventListener('change', apply); });
  document.getElementById('evclear').addEventListener('click', function () { q.value = ''; apply(); q.focus(); });
  document.getElementById('evreset').addEventListener('click', function () { reset(); q.focus(); });

  // Links like todayinak.github.io/#cat-comedy open with that category selected
  function fromHash() {
    var m = /^#cat-([a-z]+)$/.exec(location.hash);
    if (m && chips.some(function (c) { return c.getAttribute('data-sec') === m[1]; })) { cat = m[1]; apply(); }
  }
  window.addEventListener('hashchange', fromHash);

  finder.hidden = false;
  if (jump) jump.hidden = true;
  apply(); fromHash();
})();
