/* boot.js: loaded last. Starts every registered module once the DOM is parsed. */
(function () {
  "use strict";
  if (!window.LP) return;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", window.LP.boot, { once: true });
  else window.LP.boot();
})();
