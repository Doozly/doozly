import { expect, test } from "vitest";
import { createMemoryProvider } from "./memoryProvider.ts";
import { ConflictError, ProviderError } from "./provider.ts";

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b);

test("write, read, list and delete, with a new ETag per write", async () => {
  const { provider } = createMemoryProvider();
  expect(await provider.read("a.json")).toBeNull();

  const one = await provider.write("a.json", bytes("one"));
  const two = await provider.write("a.json", bytes("two"));
  expect(one.etag).not.toBe(two.etag);
  const read = await provider.read("a.json");
  expect(text(read?.data)).toBe("two");
  expect(read?.etag).toBe(two.etag);

  await provider.write("lists/x.json", bytes("x"));
  expect((await provider.list()).map((f) => f.path)).toEqual([
    "a.json",
    "lists/x.json",
  ]);
  await provider.delete("a.json");
  await provider.delete("a.json");
  expect(await provider.read("a.json")).toBeNull();
});

test("If-Match: only writes over the version we saw", async () => {
  const { provider, external } = createMemoryProvider();
  const { etag } = await provider.write("a.json", bytes("mine"));
  external.write("a.json", bytes("theirs"));

  await expect(provider.write("a.json", bytes("again"), etag)).rejects.toThrow(
    ConflictError,
  );
  const now = await provider.read("a.json");
  expect(text(now?.data)).toBe("theirs");
  await provider.write("a.json", bytes("merged"), now?.etag);
  expect(text((await provider.read("a.json"))?.data)).toBe("merged");
});

test("null If-Match only creates, never overwrites", async () => {
  const { provider } = createMemoryProvider();
  await provider.write("new.json", bytes("first"), null);
  await expect(
    provider.write("new.json", bytes("second"), null),
  ).rejects.toThrow(ConflictError);
});

test("changesSince lists everything first, then just what changed, deletes too", async () => {
  const { provider, external } = createMemoryProvider();
  await provider.write("a.json", bytes("a"));
  await provider.write("b.json", bytes("b"));
  const first = await provider.changesSince();
  expect(first.changed).toEqual(["a.json", "b.json"]);

  const quiet = await provider.changesSince(first.token);
  expect(quiet.changed).toEqual([]);

  external.write("b.json", bytes("b2"));
  external.write("b.json", bytes("b3"));
  external.delete("a.json");
  const next = await provider.changesSince(quiet.token);
  expect(next.changed).toEqual(["a.json", "b.json"]);

  await expect(provider.changesSince("999")).rejects.toThrow(ProviderError);
});

test("failures and conflicts can be set up, and calls are counted", async () => {
  const fake = createMemoryProvider();
  const { provider } = fake;
  const { etag } = await provider.write("a.json", bytes("a"));

  fake.failNext("read");
  await expect(provider.read("a.json")).rejects.toThrow(ProviderError);
  expect(await provider.read("a.json")).not.toBeNull();

  fake.conflictNext("a.json");
  await expect(provider.write("a.json", bytes("b"), etag)).rejects.toThrow(
    ConflictError,
  );
  expect(fake.calls.read).toBe(2);
  expect(fake.calls.write).toBe(2);
});
