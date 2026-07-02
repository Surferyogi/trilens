import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served at https://surferyogi.github.io/trilens/
export default defineConfig({
  plugins: [react()],
  base: "/trilens/",
});
