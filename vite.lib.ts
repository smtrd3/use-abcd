import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import react from "@vitejs/plugin-react";

export default defineConfig({
  publicDir: false, // Disable public directory processing
  build: {
    sourcemap: true,
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        "runtime/client": resolve(__dirname, "src/runtime/index.ts"),
        "runtime/server": resolve(__dirname, "src/runtime/server.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: ["react", "react-dom"],
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
  plugins: [
    react(),
    dts({
      outDir: "dist",
      tsconfigPath: "./tsconfig.build.json",
      exclude: ["src/__tests__"],
    }),
  ],
});
