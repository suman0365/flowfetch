import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Read the single .env file at the repo root instead of frontend/.env,
  // so PORT/FRONTEND_URL/VITE_API_URL all live in one place.
  envDir: "../",
  server: {
    port: 5173,
  },
});
