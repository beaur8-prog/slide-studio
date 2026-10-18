import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import PresenterView from "./PresenterView";
import { installLocalFonts } from "./local-fonts";
import { installDesktopFonts } from "./desktop-fonts";
import "@fontsource/carlito/latin-400.css";
import "@fontsource/carlito/latin-400-italic.css";
import "@fontsource/carlito/latin-700.css";
import "@fontsource/carlito/latin-700-italic.css";
import "./fonts.css";
import "./styles.css";
import "./office-shell.css";
void Promise.allSettled([installDesktopFonts(), installLocalFonts()]).finally(
  () => {
    createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        {/^#presenter=[0-9a-f-]{36}$/i.test(location.hash) ? (
          <PresenterView token={location.hash.slice(11)} />
        ) : (
          <App />
        )}
      </React.StrictMode>,
    );
  },
);
