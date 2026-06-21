import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone maze studio, served by the Cloudflare Worker as static assets
// under /tattoos/build/maze/. The build outputs straight into that path so the
// site (which has no build step of its own) just serves the committed bundle.
export default defineConfig({
  base: "/tattoos/build/maze/",
  plugins: [react()],
  build: {
    outDir: "../../tattoos/build/maze",
    emptyOutDir: true
  },
  server: {
    port: 5174,
    strictPort: false
  }
});
