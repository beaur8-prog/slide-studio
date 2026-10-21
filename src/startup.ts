// A native editor window gets a new ID on every launch/reopen. Reloading that
// same window can recover its current edit buffer without reopening an old file
// when the application starts again. This decision is shared across StrictMode.
export const restoreWindowBuffer = (() => {
  try {
    const key = "slide-studio-window-session";
    const session = window.desktop?.windowSessionId || "browser-tab";
    const restore = sessionStorage.getItem(key) === session;
    sessionStorage.setItem(key, session);
    return restore;
  } catch {
    return false;
  }
})();
