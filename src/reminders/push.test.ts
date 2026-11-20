import { expect, test } from "vitest";
import { pushSupport } from "./push.ts";

function env({
  ua = "Mozilla/5.0 (X11; Linux x86_64)",
  platform = "Linux x86_64",
  touch = 0,
  push = true,
  standalone = false,
} = {}) {
  const navigator = {
    userAgent: ua,
    platform,
    maxTouchPoints: touch,
    ...(push ? { serviceWorker: {} } : {}),
  } as unknown as Navigator;
  const window = {
    ...(push ? { PushManager: {}, Notification: {} } : {}),
    matchMedia: () => ({ matches: standalone }),
  } as unknown as Window;
  return { navigator, window };
}

test("a browser with push can have it", () => {
  expect(pushSupport(env())).toBe("ok");
});

test("an iPhone in Safari has to add Doozly to the Home Screen first", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";
  expect(pushSupport(env({ ua: iphone, push: false }))).toBe("install");
  // Installed, push is there
  expect(pushSupport(env({ ua: iphone, standalone: true }))).toBe("ok");
  // Installed on an old iOS, still no push: nothing to tell them to do
  expect(pushSupport(env({ ua: iphone, push: false, standalone: true }))).toBe(
    "unsupported",
  );
});

test("an iPad pretends to be a Mac, its touch screen says otherwise", () => {
  const ipad = env({
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    platform: "MacIntel",
    touch: 5,
    push: false,
  });
  expect(pushSupport(ipad)).toBe("install");
});

test("anything else without push just doesn't have it", () => {
  expect(pushSupport(env({ push: false }))).toBe("unsupported");
});
