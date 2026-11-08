import { useEffect } from "react";
import { androidRuntime } from "./android-platform";

type SystemBars = { hide(): Promise<void>; show(): Promise<void> };
type LegacyStatusBar = SystemBars & {
  getInfo(): Promise<{ overlays?: boolean }>;
  setOverlaysWebView(options: { overlay: boolean }): Promise<void>;
};
type Orientation = {
  lock(options: { orientation: "landscape" | "portrait" }): Promise<void>;
  unlock(): Promise<void>;
};
type NativeRuntime = {
  getPlatform?(): string;
  isPluginAvailable?(name: string): boolean;
  registerPlugin?(name: string): unknown;
  Plugins?: Record<string, unknown>;
};
function plugin<T>(name: string): T | undefined {
  const native = (window as Window & { Capacitor?: NativeRuntime }).Capacitor;
  try {
    if (native?.getPlatform?.() !== "android") return;
    return (native.Plugins?.[name] ??
      (native.isPluginAvailable?.(name)
        ? native.registerPlugin?.(name)
        : undefined)) as T | undefined;
  } catch {
    return;
  }
}

// Serialize native calls: a slow Hide finishing after Exit must not hide the editor.
let barRequests = Promise.resolve();
let orientationRequests = Promise.resolve();
function requestBars(action: () => Promise<void>) {
  barRequests = barRequests.then(action).catch(() => {});
}
function requestOrientation(action: () => Promise<void> | void) {
  const request = orientationRequests.then(action);
  orientationRequests = request.catch(() => {});
  return request;
}

/** Browser Fullscreen is requested synchronously by the presentation button.
 * These optional native APIs hide both system bars in a Capacitor Android host.
 * No listeners, plugins or orientation changes are installed on desktop/iOS. */
export function useAndroidPresentation(active: boolean, landscape: boolean) {
  useEffect(() => {
    if (!androidRuntime || !active) return;
    const root = document.documentElement;
    root.dataset.studioPresenting = "true";
    // Capacitor 8 caches viewport-fit when the native page first becomes ready.
    // Re-read the now-mounted Android viewport before applying system insets.
    // The optional native interface is absent in ordinary browsers/other hosts.
    const edgeToEdge = () => {
      const viewport = document.querySelector<HTMLMetaElement>(
        'meta[name="viewport"]',
      );
      if (viewport && !viewport.content.includes("viewport-fit=cover"))
        viewport.content += ", viewport-fit=cover";
      try {
        (
          window as Window & {
            CapacitorSystemBarsAndroidInterface?: { onDOMReady?(): void };
          }
        ).CapacitorSystemBarsAndroidInterface?.onDOMReady?.();
      } catch {
        /* Fullscreen remains available if a host has no inset bridge. */
      }
    };
    const modernBars = plugin<SystemBars>("SystemBars");
    const legacy = modernBars
      ? undefined
      : plugin<LegacyStatusBar>("StatusBar");
    let previousOverlay: boolean | undefined,
      capturedOverlay = false;
    const bars: SystemBars | undefined =
      modernBars ??
      (legacy
        ? {
            async hide() {
              if (!capturedOverlay) {
                capturedOverlay = true;
                try {
                  previousOverlay = (await legacy.getInfo()).overlays;
                } catch {
                  /* Old hosts may not report it. */
                }
              }
              try {
                await legacy.setOverlaysWebView({ overlay: true });
              } catch {
                /* Modern Android enforces edge-to-edge itself. */
              }
              await legacy.hide();
            },
            async show() {
              try {
                await legacy.show();
              } finally {
                if (typeof previousOverlay === "boolean")
                  try {
                    await legacy.setOverlaysWebView({
                      overlay: previousOverlay,
                    });
                  } catch {
                    /* No override on Android 16+. */
                  }
              }
            },
          }
        : undefined);
    const nativeOrientation = plugin<Orientation>("ScreenOrientation");
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (orientation: "landscape" | "portrait") => Promise<void>;
    };
    let disposed = false,
      locked = false,
      locking = false;
    const unlock = () => {
      if (nativeOrientation) return nativeOrientation.unlock();
      orientation?.unlock?.();
    };
    const lock = () => {
      if (
        disposed ||
        locked ||
        locking ||
        (!nativeOrientation && !document.fullscreenElement)
      )
        return;
      if (!nativeOrientation && !orientation?.lock) return;
      locking = true;
      const direction = landscape ? "landscape" : "portrait";
      requestOrientation(async () => {
        if (disposed) return;
        if (nativeOrientation)
          await nativeOrientation.lock({ orientation: direction });
        else await orientation.lock!(direction);
        locked = true;
      })
        .catch(() => {})
        .finally(() => {
          locking = false;
        });
    };
    const enter = () => {
      if (document.hidden || disposed) return;
      edgeToEdge();
      if (bars) requestBars(() => (disposed ? Promise.resolve() : bars.hide()));
      lock();
    };
    const fullscreen = () => {
      if (document.fullscreenElement) lock();
    };
    enter();
    window.addEventListener("focus", enter);
    document.addEventListener("visibilitychange", enter);
    document.addEventListener("fullscreenchange", fullscreen);
    return () => {
      disposed = true;
      delete root.dataset.studioPresenting;
      window.removeEventListener("focus", enter);
      document.removeEventListener("visibilitychange", enter);
      document.removeEventListener("fullscreenchange", fullscreen);
      if (bars) requestBars(() => bars.show());
      if (locked || locking)
        void requestOrientation(() => {
          if (locked) return unlock();
        }).catch(() => {});
    };
  }, [active, landscape]);
}
