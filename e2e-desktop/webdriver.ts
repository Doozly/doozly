import { type ChildProcess, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

// Just the bits of W3C WebDriver the smoke tests need. tauri-driver passes them on
// to WebKitWebDriver on Linux and msedgedriver on Windows.
const PORT = 4444;
const BASE = `http://127.0.0.1:${PORT}`;
const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";

export const KEYS = { enter: "", alt: "", down: "" };

type Element = { [ELEMENT]: string };

async function call<T>(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as { value: T & { message?: string } };
  if (!res.ok) throw new Error(`${method} ${path}: ${json.value.message}`);
  return json.value;
}

export async function startDriver(): Promise<ChildProcess> {
  const args = process.env.NATIVE_DRIVER
    ? ["--native-driver", process.env.NATIVE_DRIVER]
    : [];
  const driver = spawn("tauri-driver", args, { stdio: "inherit" });
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${BASE}/status`);
      return driver;
    } catch {
      await sleep(100);
    }
  }
  driver.kill();
  throw new Error("tauri-driver didn't start");
}

export class Session {
  private readonly id: string;

  private constructor(id: string) {
    this.id = id;
  }

  static async launch(application: string) {
    const { sessionId } = await call<{ sessionId: string }>(
      "POST",
      "/session",
      {
        capabilities: {
          alwaysMatch: { browserName: "wry", "tauri:options": { application } },
        },
      },
    );
    return new Session(sessionId);
  }

  private at<T>(method: string, path: string, body?: unknown) {
    return call<T>(method, `/session/${this.id}${path}`, body);
  }

  close() {
    return this.at("DELETE", "");
  }

  title() {
    return this.at<string>("GET", "/title");
  }

  refresh() {
    return this.at("POST", "/refresh", {});
  }

  /** Runs in the page. A promise it gives back is waited for. */
  run<T>(script: string, ...args: unknown[]) {
    return this.at<T>("POST", "/execute/sync", { script, args });
  }

  /** Polls until the element is there, like Playwright's locators */
  async find(using: "css selector" | "xpath", value: string, timeout = 10_000) {
    const end = Date.now() + timeout;
    for (;;) {
      try {
        return await this.at<Element>("POST", "/element", { using, value });
      } catch (err) {
        if (Date.now() > end) throw err;
        await sleep(100);
      }
    }
  }

  /** The element with exactly this text, by tag */
  byText(tag: string, text: string, timeout?: number) {
    return this.find("xpath", `//${tag}[normalize-space()="${text}"]`, timeout);
  }

  async gone(using: "css selector" | "xpath", value: string) {
    const found = await this.at<Element[]>("POST", "/elements", {
      using,
      value,
    });
    return found.length === 0;
  }

  click(el: Element) {
    return this.at("POST", `/element/${el[ELEMENT]}/click`, {});
  }

  type(el: Element, text: string) {
    return this.at("POST", `/element/${el[ELEMENT]}/value`, { text });
  }

  /** Presses the mouse on one element and lets go on another, in steps like a hand */
  drag(from: Element, to: Element, dy = 0) {
    const move = (origin: Element, y: number, duration: number) => ({
      type: "pointerMove",
      origin,
      x: 0,
      y,
      duration,
    });
    return this.at("POST", "/actions", {
      actions: [
        {
          type: "pointer",
          id: "mouse",
          parameters: { pointerType: "mouse" },
          actions: [
            move(from, 0, 0),
            { type: "pointerDown", button: 0 },
            move(from, 10, 100),
            move(to, dy, 300),
            { type: "pointerUp", button: 0 },
          ],
        },
      ],
    });
  }

  text(el: Element) {
    return this.at<string>("GET", `/element/${el[ELEMENT]}/text`);
  }

  /** Waits for `check` to come out true, polling */
  async until(check: () => Promise<boolean>, what: string, timeout = 10_000) {
    const end = Date.now() + timeout;
    while (!(await check())) {
      if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
      await sleep(100);
    }
  }
}
