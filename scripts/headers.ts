import { createHash } from "node:crypto";

// The <style> elements React Aria adds itself (usePress, and usePreventScroll on iOS). No nonce on
// static hosting, also they're allowed by hash. The e2e CSP check notices when an update changes them.
const reactAriaStyles = [
  "@layer {\n  [data-react-aria-pressable] {\n    touch-action: pan-x pan-y pinch-zoom;\n  }\n}",
  "@layer {\n  * {\n    overscroll-behavior: contain;\n  }\n}",
];

const hashOf = (text: string) =>
  `'sha256-${createHash("sha256").update(text).digest("base64")}'`;

// What the app may load and talk to. The dev server goes without, Vite's hot reload needs inline scripts.
export function cspDirectives(relayUrl?: string): Record<string, string[]> {
  const relay = relayUrl ? [new URL(relayUrl).origin] : [];
  return {
    "default-src": ["'self'"],
    // Google's sign-in script is the only one from elsewhere, and only loads when someone signs in with Google
    "script-src": ["'self'", "https://accounts.google.com/gsi/client"],
    "style-src": [
      "'self'",
      ...reactAriaStyles.map(hashOf),
      "https://accounts.google.com/gsi/style",
    ],
    "img-src": ["'self'"],
    "font-src": ["'self'"],
    "connect-src": [
      "'self'",
      ...relay,
      "https://accounts.google.com/gsi/",
      "https://openidconnect.googleapis.com",
      "https://www.googleapis.com",
      "https://login.microsoftonline.com",
      "https://graph.microsoft.com",
      // Where Graph's pre-signed download links point: personal OneDrive, then work and school
      "https://*.1drv.com",
      "https://*.microsoftpersonalcontent.com",
      "https://*.sharepoint.com",
      // Dropbox's token, account and file endpoints
      "https://api.dropboxapi.com",
      "https://content.dropboxapi.com",
    ],
    // GIS's own frames, and MSAL's hidden one for silent sign-in
    "frame-src": [
      "https://accounts.google.com/gsi/",
      "https://login.microsoftonline.com",
    ],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'none'"],
    "frame-ancestors": ["'none'"],
  };
}

export function contentSecurityPolicy(relayUrl?: string): string {
  return Object.entries(cspDirectives(relayUrl))
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

export function securityHeaders(relayUrl?: string): Record<string, string> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(relayUrl),
    // Both sign-in popups need to reach back to the app
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  };
}

// Cloudflare Pages reads this from the build's root
export function pagesHeadersFile(headers: Record<string, string>): string {
  const lines = Object.entries(headers).map(
    ([name, value]) => `  ${name}: ${value}`,
  );
  return `/*\n${lines.join("\n")}\n`;
}
