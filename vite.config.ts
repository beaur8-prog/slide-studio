import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  // Converters are loaded lazily by imports/worker code. Prebundle them before
  // a test or editing session starts, avoiding an optimizer-triggered reload.
  optimizeDeps: { entries: ["index.html"], include: ["react", "react-dom/client", "react-dom/server", "emf-converter", "utif"] },
  server: { host: "127.0.0.1", port: 5190, strictPort: true,
    watch: { ignored: ["**/qa/**", "**/test-results/**", "**/playwright-report/**", "**/release/**"] },
  },
});
