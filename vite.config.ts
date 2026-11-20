import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";
import { pagesHeadersFile, securityHeaders } from "./scripts/headers.ts";

// The same headers in the build for Cloudflare Pages and from `vite preview`, so e2e runs under the CSP
function headers(relayUrl: string): Plugin {
  return {
    name: "doozly-headers",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: pagesHeadersFile(securityHeaders(relayUrl)),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const relayUrl = loadEnv(mode, process.cwd(), "VITE_").VITE_RELAY_URL ?? "";
  return {
    plugins: [
      headers(relayUrl),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      VitePWA({
        // Our own worker for push and notification clicks, registered by the app itself
        strategies: "injectManifest",
        srcDir: "src/sw",
        filename: "sw.ts",
        injectRegister: false,
        injectManifest: {
          rollupFormat: "iife",
          // Everything the app needs to open offline, icons included
          globPatterns: ["**/*.{js,css,html,svg,png,webmanifest,woff2}"],
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
    preview: { headers: securityHeaders(relayUrl) },
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
      // Tests run the same everywhere, whatever is in someone's .env.local
      env: {
        VITE_GOOGLE_CLIENT_ID: "",
        VITE_MICROSOFT_CLIENT_ID: "",
        VITE_RELAY_URL: "",
      },
    },
  };
});
