import { useState } from "react";
import { Button, FileTrigger } from "react-aria-components";
import { today } from "../../data/localDate.ts";
import { useActions, useApp } from "../../state/AppContext.tsx";
import {
  decodeExport,
  encodeExport,
  NewerSchemaError,
} from "../../sync/files.ts";
import { Icon } from "../../ui/Icon.tsx";
import styles from "./DataSection.module.css";

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** Export everything to a file and take one back in: a backup, and the way to move to another provider */
export function DataSection() {
  const app = useApp();
  const { importSnapshot } = useActions();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const exportAll = () => {
    const s = app.store.getState();
    const data = encodeExport({
      lists: Object.values(s.lists),
      groups: Object.values(s.groups),
      tasks: Object.values(s.tasks),
      steps: Object.values(s.steps),
      settings: Object.values(s.settings),
    });
    const url = URL.createObjectURL(
      new Blob([data], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `doozly-${today()}.json`;
    link.click();
    // Give the download a moment to start before the link goes
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setResult(null);
  };

  const importFile = async (file: File) => {
    try {
      const snapshot = decodeExport(
        file.name,
        new Uint8Array(await file.arrayBuffer()),
      );
      const done = importSnapshot(snapshot);
      setResult({
        ok: true,
        text: done
          ? `Imported ${plural(done.lists, "list", "lists")} and ${plural(done.tasks, "task", "tasks")}.`
          : "Everything in that file is already here.",
      });
    } catch (err) {
      setResult({
        ok: false,
        text:
          err instanceof NewerSchemaError
            ? "That file is from a newer version of Doozly. Update Doozly, then try again."
            : "That file isn't a Doozly export.",
      });
    }
  };

  return (
    <section className={styles.section} aria-labelledby="data-title">
      <h3 id="data-title" className={styles.title}>
        Your data
      </h3>
      <p className={styles.text}>
        Export saves all your lists and tasks to a file. Importing one adds it
        to what's here, keeping the newest version of each task.
      </p>
      <div className={styles.buttons}>
        <Button className={styles.button} onPress={exportAll}>
          <Icon name="export" size={16} />
          Export
        </Button>
        <FileTrigger
          acceptedFileTypes={["application/json", ".json"]}
          onSelect={(files) => {
            const file = files?.[0];
            if (file) void importFile(file);
          }}
        >
          <Button className={styles.button}>
            <Icon name="import" size={16} />
            Import
          </Button>
        </FileTrigger>
      </div>
      {result && (
        <p
          className={result.ok ? styles.text : styles.error}
          role={result.ok ? "status" : "alert"}
        >
          {result.text}
        </p>
      )}
    </section>
  );
}
