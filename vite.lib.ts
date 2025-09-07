import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import react from "@vitejs/plugin-react";

export default defineConfig({
  publicDir: false, // Disable public directory processing
  build: {
    lib: {
      entry: resolve(__dirname, "src/useCrud.ts"),
      name: "useCrud",
      formats: ["es"],
      fileName: "useCrud",
    },
    rollupOptions: {
      external: ["react", "react-dom"],
    },
  },
  plugins: [
    react(),
    dts({
      outDir: "dist",
      tsconfigPath: "./tsconfig.build.json",
      exclude: ["src/__tests__"],
      rollupTypes: true,
    }),
  ],
});
