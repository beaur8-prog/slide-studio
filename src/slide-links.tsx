import { createContext } from "react";
export const SlideLinks = createContext<{
  interactive: boolean;
  onSlideLink?: (id: string) => void;
}>({ interactive: false });
