import { useRef } from "react";

interface InlineRenameProps {
  value: string;
  label: string;
  className?: string;
  /** Called with the trimmed new name, only when it's not empty and changed */
  onSave: (value: string) => void;
  /** Always called when editing ends, saved or not */
  onDone: () => void;
}

/** A field that edits a name in place: Enter or leaving saves, Escape cancels */
export function InlineRename({
  value,
  label,
  className,
  onSave,
  onDone,
}: InlineRenameProps) {
  const cancelled = useRef(false);

  return (
    <input
      className={className}
      aria-label={label}
      defaultValue={value}
      maxLength={255}
      // biome-ignore lint/a11y/noAutofocus: the user just asked to rename, the field is the point
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => {
        const next = e.currentTarget.value.trim();
        if (!cancelled.current && next && next !== value) onSave(next);
        onDone();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          // Stop here, so Escape doesn't also close something around it
          e.stopPropagation();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
