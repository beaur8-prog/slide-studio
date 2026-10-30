import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

/** Browser Ctrl+P and Electron's preparePrint both fire beforeprint. React
 * must commit synchronously before Chromium takes its print snapshot. Keeping
 * this tree out of normal editing avoids a duplicate DOM for every slide.
 */
export function usePrintRendering() {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const prepare = () => flushSync(() => setPrinting(true));
    const release = () => setPrinting(false);
    window.addEventListener("beforeprint", prepare);
    window.addEventListener("afterprint", release);
    return () => {
      window.removeEventListener("beforeprint", prepare);
      window.removeEventListener("afterprint", release);
    };
  }, []);
  return printing;
}
