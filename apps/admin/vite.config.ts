import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Default to the local POS server (single-café mode). For cloud deployments set
// ADMIN_API_TARGET=https://your-cloud-api and VITE_API_URL accordingly.
const apiTarget = process.env.ADMIN_API_TARGET ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/v1": { target: apiTarget, changeOrigin: true },
    },
  },
});
