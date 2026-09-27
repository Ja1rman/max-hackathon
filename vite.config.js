import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);

/** Publish openapi.yaml and a self-hosted Swagger UI (no CDN, CSP 'self') next to the app. */
function apiDocs() {
  let outDir;
  return {
    name: "api-docs",
    apply: "build",
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    closeBundle() {
      const swaggerDist = dirname(require.resolve("swagger-ui-dist/package.json"));
      mkdirSync(resolve(outDir, "swagger"), { recursive: true });
      copyFileSync("openapi.yaml", resolve(outDir, "openapi.yaml"));
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
