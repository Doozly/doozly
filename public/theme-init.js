// Runs before the CSS paints, so a dark override doesn't flash light first.
// A file, not inline, so a strict CSP needs no hash for it.
(() => {
  try {
    const theme = localStorage.getItem("doozly:theme");
    if (theme === "light" || theme === "dark") {
      document.documentElement.dataset.theme = theme;
    }
  } catch {
    // Blocked storage: just follow the system until the app has loaded
  }
})();
