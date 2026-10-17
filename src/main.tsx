import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installDesktopFonts } from "./desktop-fonts";
import "@fontsource/carlito/latin-400.css";
import "@fontsource/carlito/latin-400-italic.css";
import "@fontsource/carlito/latin-700.css";
import "@fontsource/carlito/latin-700-italic.css";
import "./fonts.css";
import "./styles.css";
import "./office-shell.css";
void installDesktopFonts().finally(() => {
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
