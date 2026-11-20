import { generateNKeysBetween } from "fractional-indexing";

const words = [
  "milk",
  "bread",
  "call",
  "email",
  "report",
  "garden",
  "bike",
  "dentist",
  "invoice",
  "train",
  "book",
  "gift",
  "plan",
  "review",
  "clean",
  "fix",
  "pay",
  "order",
  "check",
  "send",
];

/** A Doozly export with `lists` lists of `perList` tasks, as an import would see it */
export function bigExport(lists = 50, perList = 100, stepsEvery = 5) {
  const now = Date.now();
  let n = 0;
  const stamp = () =>
    `${String(now).padStart(13, "0")}:${(n++).toString(36).padStart(4, "0")}:perfseed`;
  const base = (id: string) => ({
    id,
    createdAt: now - n * 1000,
    updatedAt: stamp(),
    deletedAt: null,
  });
  const listPos = generateNKeysBetween(null, null, lists);
  const out = {
    doozly: "export",
    schema: 1,
    exportedAt: new Date().toISOString(),
    lists: [] as unknown[],
    groups: [] as unknown[],
    tasks: [] as unknown[],
    steps: [] as unknown[],
    settings: [] as unknown[],
  };
  out.lists.push({
    ...base("inbox"),
    title: "Tasks",
    accent: "teal",
    background: null,
    groupId: null,
    position: "a0",
    sort: null,
    group: null,
    showCompleted: true,
  });
  const today = new Date().toISOString().slice(0, 10);
  for (let l = 0; l < lists; l++) {
    const listId = `list-${l}`;
    out.lists.push({
      ...base(listId),
      title: `List ${l} ${words[l % words.length]}`,
      accent: "blue",
      background: null,
      groupId: null,
      position: `b${listPos[l]}`,
      sort: null,
      group: null,
      showCompleted: true,
    });
    const pos = generateNKeysBetween(null, null, perList);
    for (let t = 0; t < perList; t++) {
      const id = `task-${l}-${t}`;
      const i = l * perList + t;
      out.tasks.push({
        ...base(id),
        listId,
        title: `${words[i % 20]} ${words[(i * 7) % 20]} number ${i}`,
        completedAt: t % 3 === 0 ? now - i : null,
        important: t % 7 === 0,
        myDay: t % 11 === 0 ? today : null,
        dueDate: t % 4 === 0 ? today : null,
        reminderAt: null,
        repeat: null,
        note:
          t % 2
            ? `A note about ${words[i % 20]} with some more words in it, like a real one.`
            : "",
        position: pos[t],
      });
      if (t % stepsEvery === 0) {
        for (let s = 0; s < 3; s++)
          out.steps.push({
            ...base(`step-${i}-${s}`),
            taskId: id,
            title: `step ${s} ${words[(i + s) % 20]}`,
            completedAt: null,
            position: `a${s}`,
          });
      }
    }
  }
  return out;
}
