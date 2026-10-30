'use strict';

// macOS can resize a window before its fullscreen transition event arrives.
// Serialize our requests by those events, keeping the latest presentation intent.
function createPresentationWindowController(window, { onEntered = () => {}, onEnded = () => {} } = {}) {
  let active = false;
  let restore = null;
  let restoring = null;
  let desired = window.isFullScreen();
  let transition = null;
  let disposed = false;
  let previousMinimum = null;

  const restoreMinimum = () => {
    if (previousMinimum && !active && !window.isFullScreen()) {
      const minimum = previousMinimum;
      previousMinimum = null;
      window.setMinimumSize?.(...minimum);
    }
  };

  const reconcile = () => {
    if (disposed || window.isDestroyed() || transition !== null) return;
    if (window.isFullScreen() === desired) {
      if (!active) {
        restoring = null;
        restoreMinimum();
      }
      return;
    }
    transition = desired;
    window.setFullScreen(desired);
  };
  const restoreChrome = previous => {
    window.setMenuBarVisibility(previous.menuBarVisible);
    window.webContents.setBackgroundThrottling(true);
  };
  const entered = () => {
    const expected = transition === true;
    if (expected) transition = null;
    if (!expected && transition === null && !active) {
      // The user entered fullscreen outside a presentation.
      desired = true;
      restoring = null;
      return;
    }
    if (active) onEntered();
    // Windows can emit this event before isFullScreen() reflects the new state.
    // Re-entering setFullScreen in that callback can leave a phantom transition.
    setImmediate(reconcile);
  };
  const left = () => {
    if (transition === false) {
      transition = null;
      // An old requested exit must not end a show restarted during its animation.
      setImmediate(reconcile);
      return;
    }
    // A native fullscreen shortcut overrides the current presentation intent.
    transition = null;
    desired = false;
    restoring = null;
    if (active) {
      const previous = restore;
      active = false;
      restore = null;
      restoreChrome(previous);
      onEnded();
    }
    setImmediate(restoreMinimum);
  };
  window.on('enter-full-screen', entered);
  window.on('leave-full-screen', left);
  return {
    get isPresenting() { return active; },
    set(enabled) {
      if (disposed || window.isDestroyed()) return;
      if (enabled) {
        if (!active) {
          // If the previous show is still leaving fullscreen, retain its original
          // editor state rather than mistaking the animating window for that state.
          restore = restoring ?? {
            fullScreen: window.isFullScreen(),
            menuBarVisible: window.isMenuBarVisible(),
          };
          restoring = null;
          active = true;
          // Editor size constraints must not enlarge a slideshow beyond a
          // smaller display (e.g. 1024px Windows). Restore only after leaving
          // fullscreen; restoring while fullscreen can resize it again.
          if (!previousMinimum && window.getMinimumSize && window.setMinimumSize)
            previousMinimum = window.getMinimumSize();
        }
        if (previousMinimum) window.setMinimumSize(0, 0);
        desired = true;
        window.setMenuBarVisibility(false);
        window.webContents.setBackgroundThrottling(false);
        reconcile();
      } else if (active) {
        active = false;
        restoring = restore;
        restore = null;
        desired = restoring.fullScreen;
        restoreChrome(restoring);
        reconcile();
      }
    },
    dispose() {
      disposed = true;
      active = false;
      window.off('enter-full-screen', entered);
      window.off('leave-full-screen', left);
    },
  };
}

module.exports = { createPresentationWindowController };
