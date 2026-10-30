import { defineConfig } from "vite";

const ANNA_SDK = "/static/anna-apps/_sdk/latest/index.js";

export default defineConfig({
  base: "./",
  build: {
    outDir: "bundle",
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      external: [ANNA_SDK],
    },
  },
});
