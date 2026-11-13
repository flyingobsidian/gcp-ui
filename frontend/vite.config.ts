import { defineConfig } from "vite";

// The Go server owns index.html (it injects the API token), so Vite only
// bundles the script and stylesheet, with fixed names, into the directory the
// Go binary embeds.
export default defineConfig({
  oxc: {
    jsx: { runtime: "automatic", importSource: "preact" },
  },
  build: {
    outDir: "../internal/web/dist",
    emptyOutDir: false,
    target: "es2022",
    modulePreload: false,
    cssCodeSplit: false,
    rolldownOptions: {
      input: "src/main.tsx",
      output: {
        entryFileNames: "app.js",
        chunkFileNames: "[name].js",
        assetFileNames: "app[extname]",
      },
    },
  },
});
