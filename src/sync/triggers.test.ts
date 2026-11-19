import { afterEach, expect, test } from "vitest";
import { testApp } from "../test/app.ts";
import { createSyncEngine, type SyncEngine } from "./engine.ts";
import { createMemoryProvider } from "./memoryProvider.ts";

let engine: SyncEngine | undefined;
afterEach(() => engine?.stop());

async function started(pollMs = 60_000) {
  const { app } = await testApp();
  const cloud = createMemoryProvider();
  engine = createSyncEngine({ app, provider: cloud.provider, pollMs });
  await engine.start();
  await engine.settled();
  return { cloud, engine };
}

const visibility = (state: "visible" | "hidden") =>
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });

afterEach(() => visibility("visible"));

test("focus, coming back online and becoming visible each pull", async () => {
  const { cloud, engine } = await started();
  expect(cloud.calls.changesSince).toBe(1);

  window.dispatchEvent(new Event("focus"));
  await engine.settled();
  window.dispatchEvent(new Event("online"));
  await engine.settled();
  visibility("visible");
  document.dispatchEvent(new Event("visibilitychange"));
  await engine.settled();
  expect(cloud.calls.changesSince).toBe(4);

  visibility("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  await engine.settled();
  expect(cloud.calls.changesSince).toBe(4);
});

test("it polls while visible, and stops polling when hidden or stopped", async () => {
  const { cloud, engine } = await started(10);
  await new Promise((r) => setTimeout(r, 60));
  await engine.settled();
  const polled = cloud.calls.changesSince;
  expect(polled).toBeGreaterThan(1);

  visibility("hidden");
  await new Promise((r) => setTimeout(r, 40));
  await engine.settled();
  expect(cloud.calls.changesSince).toBe(polled);

  visibility("visible");
  engine.stop();
  await new Promise((r) => setTimeout(r, 40));
  expect(cloud.calls.changesSince).toBe(polled);
  expect(engine.status.getState().phase).toBe("off");
});
