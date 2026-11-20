import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    VitePWA({
      // Our own worker for push and notification clicks, registered by the app itself
      strategies: "injectManifest",
      srcDir: "src/sw",
      filename: "sw.ts",
      injectRegister: false,
      injectManifest: {
        // No precaching yet, offline comes with the phase 7 PWA work
        injectionPoint: undefined,
        rollupFormat: "iife",
      },
      manifest: {
        name: "Doozly",
        short_name: "Doozly",
        description: "Your tasks, in your own cloud.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#0a7570",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  build: {
    rolldownOptions: {
      // Microsoft's sign-in popup comes back to its own small page
      input: { main: "index.html", redirect: "redirect.html" },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    css: true,
  },
});
