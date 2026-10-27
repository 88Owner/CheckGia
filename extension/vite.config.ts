import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

const localApiProxy = {
  target: "http://127.0.0.1:8787",
  changeOrigin: true,
  configure(proxy) {
    proxy.on("proxyReq", (proxyReq) => {
      proxyReq.removeHeader("origin");
    });
  },
} satisfies ProxyOptions;

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    proxy: {
      "/health": localApiProxy,
      "/api": localApiProxy,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(root, "popup.html"),
    },
  },
});
