import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { InstallSection } from "./InstallSection.tsx";
import { install, listenForInstall, promptInstall } from "./install.ts";
import { updates, watchForUpdates } from "./serviceWorker.ts";
import { UpdateNotice } from "./UpdateNotice.tsx";

class FakeWorker extends EventTarget {
  state = "installing";
  postMessage = vi.fn();
  install() {
    this.state = "installed";
    this.dispatchEvent(new Event("statechange"));
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  update = vi.fn(async () => {});
  found(worker: FakeWorker) {
    this.installing = worker;
    this.dispatchEvent(new Event("updatefound"));
  }
}

const container = new EventTarget() as EventTarget & {
  controller: object | null;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval"] });
  container.controller = {};
  Object.defineProperty(navigator, "serviceWorker", {
    value: container,
    configurable: true,
  });
  updates.setState({ waiting: null });
  install.setState({ offer: null });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

const watch = (reg: FakeRegistration) =>
  watchForUpdates(reg as unknown as ServiceWorkerRegistration);

test("a new version that finishes installing is offered", () => {
  const reg = new FakeRegistration();
  watch(reg);
  expect(updates.getState().waiting).toBeNull();
  const worker = new FakeWorker();
  reg.found(worker);
  worker.install();
  expect(updates.getState().waiting).toBe(worker);
});

test("one already waiting from an earlier visit is offered at once", () => {
  const reg = new FakeRegistration();
  reg.waiting = new FakeWorker();
  watch(reg);
  expect(updates.getState().waiting).toBe(reg.waiting);
});

test("the very first install isn't an update", () => {
  container.controller = null;
  const reg = new FakeRegistration();
  watch(reg);
  const worker = new FakeWorker();
  reg.found(worker);
  worker.install();
  expect(updates.getState().waiting).toBeNull();
});

test("it looks for a new version every hour", () => {
  const reg = new FakeRegistration();
  watch(reg);
  vi.advanceTimersByTime(60 * 60 * 1000);
  expect(reg.update).toHaveBeenCalledOnce();
});

test("Reload lets the new version take over, then reloads", async () => {
  const reload = vi.fn();
  vi.spyOn(window, "location", "get").mockReturnValue({
    reload,
  } as unknown as Location);
  const worker = new FakeWorker();
  updates.setState({ waiting: worker as unknown as ServiceWorker });
  render(<UpdateNotice />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "A new version of Doozly is ready.",
  );
  await userEvent.click(screen.getByRole("button", { name: "Reload" }));
  expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  expect(reload).not.toHaveBeenCalled();
  container.dispatchEvent(new Event("controllerchange"));
  expect(reload).toHaveBeenCalledOnce();
});

test("Later hides it until the next version", async () => {
  const first = new FakeWorker() as unknown as ServiceWorker;
  updates.setState({ waiting: first });
  render(<UpdateNotice />);
  await userEvent.click(screen.getByRole("button", { name: "Later" }));
  expect(screen.queryByRole("status")).toBeNull();
  act(() => {
    updates.setState({ waiting: new FakeWorker() as unknown as ServiceWorker });
  });
  expect(screen.getByRole("status")).toBeVisible();
});

test("the browser's install offer shows a button that uses it once", async () => {
  const target = new EventTarget() as unknown as Window;
  listenForInstall(target);
  render(<InstallSection />);
  expect(screen.queryByRole("button", { name: "Install Doozly" })).toBeNull();

  const offer = Object.assign(new Event("beforeinstallprompt"), {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome: "accepted" as const }),
  });
  act(() => {
    target.dispatchEvent(offer);
  });
  await userEvent.click(screen.getByRole("button", { name: "Install Doozly" }));
  expect(offer.prompt).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Install Doozly" })).toBeNull();
  expect(await promptInstall()).toBe(false);
});

test("once installed the offer goes", () => {
  const target = new EventTarget() as unknown as Window;
  listenForInstall(target);
  target.dispatchEvent(new Event("beforeinstallprompt"));
  expect(install.getState().offer).not.toBeNull();
  target.dispatchEvent(new Event("appinstalled"));
  expect(install.getState().offer).toBeNull();
});

test("on an iPhone in Safari it explains Add to Home Screen", () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
  );
  render(<InstallSection />);
  expect(screen.getByText(/Add to Home Screen/)).toBeVisible();
});
