import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "..", "");
  const target = `http://127.0.0.1:${process.env.WEB_PORT ?? env.WEB_PORT ?? "8050"}`;
  return {
    server: { proxy: { "/api": target, "/ws": { target, ws: true } } },
    build: { outDir: "dist" },
  };
});
