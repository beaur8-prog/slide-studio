import { useEffect, useRef } from "react";

/** Screen width and touch capability must never opt a desktop into Android UI. */
export function isAndroidEnvironment(environment: {
  desktopPlatform?: string;
  nativePlatform?: string;
  userAgentPlatform?: string;
  userAgent?: string;
}): boolean {
  if (environment.desktopPlatform)
    return environment.desktopPlatform === "android";
  if (environment.nativePlatform && environment.nativePlatform !== "web")
    return environment.nativePlatform === "android";
  return (
    environment.userAgentPlatform === "Android" ||
    /\bAndroid\b/i.test(environment.userAgent ?? "")
  );
}

const native = (
  window as Window & {
    Capacitor?: { getPlatform?: () => string };
  }
).Capacitor;
let nativePlatform: string | undefined;
if (!window.desktop?.platform) {
  try {
    nativePlatform = native?.getPlatform?.();
  } catch {
    /* The browser identity is still available. */
  }
}
export const androidRuntime = isAndroidEnvironment({
  desktopPlatform: window.desktop?.platform,
  nativePlatform,
  userAgentPlatform: (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform,
  userAgent: navigator.userAgent,
});

/** WebView back navigation, with a cancellable event for a future native host. */
export function useAndroidBack(handler: () => boolean) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!androidRuntime) return;
    const push = () =>
      history.pushState(
        { ...history.state, studioAndroidBack: true },
        "",
        location.href,
      );
    if (!history.state?.studioAndroidBack) push();
    let handling = false;
    const run = () => {
      if (handling) return false;
      handling = true;
      try {
        return latest.current();
      } finally {
        handling = false;
      }
    };
    const back = () => {
      if (run()) push();
      else history.back();
    };
    const nativeBack = (event: Event) => {
      if (run()) event.preventDefault();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing && run()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("popstate", back);
    window.addEventListener("slide-studio-android-back", nativeBack);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("popstate", back);
      window.removeEventListener("slide-studio-android-back", nativeBack);
      window.removeEventListener("keydown", escape, true);
    };
  }, []);
}
