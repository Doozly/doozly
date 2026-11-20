// @vitest-environment node
import { expect, test } from "vitest";
import {
  fromBase64,
  importReminderKey,
  newReminderKey,
  open,
  seal,
  toBase64,
} from "./crypto.ts";

const content = {
  title: "Call the dentist",
  list: "Tasks",
  taskId: "t1",
  listId: "inbox",
};

test("base64 goes both ways, also for every byte value", () => {
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  expect(fromBase64(toBase64(all))).toEqual(all);
  expect(fromBase64(newReminderKey())).toHaveLength(32);
});

test("sealed content opens with the same key and id only", async () => {
  const key = await importReminderKey(newReminderKey());
  const other = await importReminderKey(newReminderKey());
  const sealed = await seal(key, "t1@1000", content);

  expect(new TextDecoder().decode(sealed)).not.toContain("dentist");
  expect(await open(key, "t1@1000", sealed)).toEqual(content);
  expect(await open(other, "t1@1000", sealed)).toBeNull();
  expect(await open(key, "t2@1000", sealed)).toBeNull();
});

test("each seal looks different, and the worst case still fits a push", async () => {
  const key = await importReminderKey(newReminderKey());
  const a = await seal(key, "r", content);
  const b = await seal(key, "r", content);
  expect(toBase64(a)).not.toBe(toBase64(b));

  // 255 four-byte emoji in both title and list name
  const huge = "😀".repeat(255);
  const sealed = await seal(key, "r", { ...content, title: huge, list: huge });
  expect(sealed.length).toBeLessThanOrEqual(2048);
  expect((await open(key, "r", sealed))?.title.endsWith("…")).toBe(true);
});
