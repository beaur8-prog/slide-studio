import { useEffect, useState } from "react";
import { androidRuntime } from "./android-platform";

/** Android's smallest-screen-width tablet boundary, independent of orientation
 * and of the editor viewport (which may shrink for a keyboard or split screen).
 * Runtime identity remains mandatory so touch laptops and iPads stay unchanged. */
export function isAndroidTabletScreen(environment: {
  android: boolean;
  screenWidth: number;
  screenHeight: number;
  maxTouchPoints: number;
  coarsePointer: boolean;
}): boolean {
  return environment.android &&
    (environment.maxTouchPoints > 0 || environment.coarsePointer) &&
    Math.min(environment.screenWidth, environment.screenHeight) >= 600;
}

function tabletScreen(): boolean {
  return isAndroidTabletScreen({
    android: androidRuntime,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    maxTouchPoints: navigator.maxTouchPoints,
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
  });
}

export function useAndroidTabletEditor(): boolean {
  const [tablet, setTablet] = useState(tabletScreen);
  useEffect(() => {
    if (!androidRuntime) return;
    const update = () => setTablet(tabletScreen());
    const pointer = window.matchMedia("(pointer: coarse)");
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    pointer.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      pointer.removeEventListener("change", update);
    };
  }, []);
  return tablet;
}
