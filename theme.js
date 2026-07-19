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

  document.addEventListener('DOMContentLoaded', updateBtn);
})();
