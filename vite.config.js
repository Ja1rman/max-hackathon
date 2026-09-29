import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);

function apiDocs() {
  let outDir;
  return {
    name: "api-docs",
    apply: "build",
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    closeBundle() {
      const swaggerDist = dirname(require.resolve("swagger-ui-dist/package.json"));
      mkdirSync(resolve(outDir, "swagger"), { recursive: true });
      mkdirSync(resolve(outDir, "fixtures"), { recursive: true });
      mkdirSync(resolve(outDir, "docs"), { recursive: true });
      copyFileSync("openapi.yaml", resolve(outDir, "openapi.yaml"));
      copyFileSync("DATA-API.yaml", resolve(outDir, "DATA-API.yaml"));
      copyFileSync("fixtures/api-checks.json", resolve(outDir, "fixtures", "api-checks.json"));
      copyFileSync("docs/TESTING.md", resolve(outDir, "docs", "TESTING.md"));
      for (const file of ["swagger-ui.css", "swagger-ui-bundle.js", "favicon-32x32.png"]) copyFileSync(resolve(swaggerDist, file), resolve(outDir, "swagger", file));
      for (const file of ["index.html", "init.js"]) copyFileSync(resolve("docs/swagger", file), resolve(outDir, "swagger", file));
    },
  };
}

export default defineConfig({
  plugins: [react(), apiDocs()],
  base: process.env.VITE_BASE_PATH || "/",
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/healthz": "http://127.0.0.1:3000",
      "/openapi.yaml": "http://127.0.0.1:3000",
      "/swagger": "http://127.0.0.1:3000",
    },
  },
});
