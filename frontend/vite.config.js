import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src"),
        },
    },
    server: {
        host: "0.0.0.0",
        port: 5000,
        strictPort: true,
        allowedHosts: true,
        proxy: {
            "/api": {
                target: "http://127.0.0.1:8000",
                changeOrigin: true,
            },
            "/healthz": "http://127.0.0.1:8000",
        },
    },
    build: {
        outDir: "dist",
        sourcemap: true,
    },
});
