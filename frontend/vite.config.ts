import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * 开发代理说明：
 * 控制台所有请求都走相对路径 `/api/...`，由 Vite 代理到本地后端。
 * 这样做的三个好处：
 * 1. 不需要后端开 CORS（生产环境同源部署时同样成立）；
 * 2. 前端代码里不出现 `http://127.0.0.1:8000`，避免把本地地址带进产物；
 * 3. 切换环境只需改代理目标（或用 VITE_API_BASE 覆盖）。
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
