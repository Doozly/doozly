// @vitest-environment node
import { expect, test, vi } from "vitest";
import { loadAll } from "../data/db.ts";
import { createTask, INBOX_ID } from "../data/model.ts";
import { testApp } from "../test/app.ts";

const task = (title: string) =>
  createTask({ listId: INBOX_ID, title, position: "a0" });

test("load fills the store from disk", async () => {
  const { state } = await testApp();
  expect(state().status).toBe("ready");
  expect(Object.keys(state().lists)).toEqual([INBOX_ID]);
});

test("a commit shows up at once, and on disk after", async () => {
  const { app, db, state } = await testApp();
  const t = task("Milk");
  app.commit({ tasks: [t] });
  expect(state().tasks[t.id]).toBe(t);
  await app.flush();
  expect((await loadAll(db)).tasks).toEqual([t]);
});

test("a failed save rolls back and says so", async () => {
  const { app, db, state } = await testApp();
  vi.spyOn(db, "transaction").mockImplementationOnce(() => {
    throw new DOMException("Disk is full", "QuotaExceededError");
  });
  const t = task("Milk");
  app.commit({ tasks: [t] });
  expect(state().tasks[t.id]).toBe(t);
  await app.flush();
  expect(state().tasks[t.id]).toBeUndefined();
  expect(state().saveError).toMatch(/Disk is full/);
});

test("a rollback leaves a newer change alone", async () => {
  const { app, db, state } = await testApp();
  const t = task("Milk");
  app.commit({ tasks: [t] });
  await app.flush();

  vi.spyOn(db, "transaction").mockImplementationOnce(() => {
    throw new Error("nope");
  });
  app.commit({ tasks: [{ ...t, title: "Fails" }] });
  const newer = { ...t, title: "Wins" };
  app.commit({ tasks: [newer] });
  await app.flush();
  expect(state().tasks[t.id]).toBe(newer);
});

test("undo restores the record before, with a newer stamp", async () => {
  const { app, state } = await testApp();
  const t = task("Milk");
  app.commit({ tasks: [t] });
  const undo = app.commit({ tasks: [{ ...t, title: "Oat milk" }] });
  undo();
  const back = state().tasks[t.id];
  expect(back?.title).toBe("Milk");
  expect(back && back.updatedAt > t.updatedAt).toBe(true);
});

test("undoing something new tombstones it", async () => {
  const { app, state } = await testApp();
  const t = task("Milk");
  app.commit({ tasks: [t] })();
  expect(state().tasks[t.id]?.deletedAt).not.toBeNull();
});

test("another tab sees the change once it's saved", async () => {
  const channel = crypto.randomUUID();
  const one = await testApp(channel);
  const two = await testApp(channel);
  const t = task("From tab one");
  one.app.commit({ tasks: [t] });
  await one.app.flush();
  await vi.waitFor(() => expect(two.state().tasks[t.id]).toEqual(t));
});

test("another tab's older copy doesn't replace our newer one", async () => {
  const channel = crypto.randomUUID();
  const one = await testApp(channel);
  const two = await testApp(channel);
  const t = task("Old");
  one.app.commit({ tasks: [t] });
  const mine = { ...t, title: "Mine", updatedAt: `${t.updatedAt}~` };
  two.app.commit({ tasks: [mine] });
  await one.app.flush();
  await two.app.flush();
  await new Promise((r) => setTimeout(r, 20));
  await two.app.flush();
  expect(two.state().tasks[t.id]?.title).toBe("Mine");
});

test("applyRemote takes only what's newer than ours, and saves it", async () => {
  const { app, db, state } = await testApp();
  const ours = createTask({ listId: INBOX_ID, title: "Ours", position: "a0" });
  app.commit({ tasks: [ours] });

  const older = {
    ...ours,
    title: "Old remote",
    updatedAt: "0000000000001:0000:zz",
  };
  const fresh = createTask({
    listId: INBOX_ID,
    title: "Theirs",
    position: "a1",
  });
  app.applyRemote({ tasks: [older, fresh] });
  await app.flush();

  expect(state().tasks[ours.id]?.title).toBe("Ours");
  expect(state().tasks[fresh.id]?.title).toBe("Theirs");
  const onDisk = (await loadAll(db)).tasks.map((t) => t.title).sort();
  expect(onDisk).toEqual(["Ours", "Theirs"]);
});
