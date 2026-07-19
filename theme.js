/* Dark-mode toggle. Runs immediately (included in <head>) to avoid a flash.
   Persists the choice in localStorage; defaults to the system preference. */
(function () {
  var root = document.documentElement;

  function systemDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function current() {
    var s = localStorage.getItem('theme');
    return (s === 'dark' || s === 'light') ? s : (systemDark() ? 'dark' : 'light');
  }
  function apply(t) { root.setAttribute('data-theme', t); }
  function updateBtn() {
    var b = document.getElementById('theme-toggle');
    if (b) {
      var dark = current() === 'dark';
      b.textContent = dark ? '\u2600\uFE0F' : '\uD83C\uDF19'; // ☀️ / 🌙
      b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    }
  }

  apply(current()); // set before first paint

  window.toggleTheme = function () {
    var t = current() === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', t);
    apply(t);
    updateBtn();
  };

  /* ---- accent color theme ---- */
  function currentAccent() { return localStorage.getItem('accent') || 'default'; }
  function applyAccent(a) {
    if (a && a !== 'default') root.setAttribute('data-accent', a);
    else root.removeAttribute('data-accent');
  }
  function updateSwatches() {
    var a = currentAccent();
    var els = document.querySelectorAll('.swatch');
    for (var i = 0; i < els.length; i++) {
      els[i].classList.toggle('active', els[i].getAttribute('data-accent') === a);
    }
  }
  window.setAccent = function (a) {
    localStorage.setItem('accent', a);
    applyAccent(a);
    updateSwatches();
  };

  applyAccent(currentAccent()); // set before first paint

  document.addEventListener('DOMContentLoaded', function () {
    updateBtn();
    updateSwatches();
    var els = document.querySelectorAll('.swatch');
    for (var i = 0; i < els.length; i++) {
      els[i].addEventListener('click', function () {
        window.setAccent(this.getAttribute('data-accent'));
      });
    }
  });
})();
