/**
 * Adapted from LodyAI/Lody (Apache License 2.0): packages/components/src/components/today/editor/mention-keys.ts.
 * Modified for Tianshu (thread mentions, local storage, repo conventions).
 */
import { isImeKey, type OutlineKeyEvent } from "./outline-keys";

/**
 * Keys around a mention (one character in the node text): ← / → select it, then collapse past
 * it; Backspace / Delete select it, then delete it; Enter opens it, Alt+Enter opens its status
 * menu. Returns null when the key is the editor's.
 */
export type MentionKeyIntent =
  | { type: "select"; anchor: number; focus: number }
  | { type: "collapse"; offset: number }
  | { type: "open"; start: number }
  | { type: "menu"; start: number };

/** The only keys `resolveMentionKey` acts on; callers skip document reads for the rest. */
export const MENTION_KEYS: ReadonlySet<string> = new Set([
  "ArrowLeft",
  "ArrowRight",
  "Backspace",
  "Delete",
  "Enter",
]);

export function resolveMentionKey(
  event: OutlineKeyEvent,
  caret: { anchor: number; focus: number },
  mentionStarts: readonly number[],
): MentionKeyIntent | null {
  if (isImeKey(event)) return null;
  const starts = new Set(mentionStarts);
  const start = Math.min(caret.anchor, caret.focus);
  const end = Math.max(caret.anchor, caret.focus);
  const collapsed = start === end;
  const selected = end - start === 1 && starts.has(start) ? start : null;
  const plain = !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;
  switch (event.key) {
    case "ArrowLeft":
    case "Backspace":
      if (!plain) return null;
      if (collapsed && starts.has(start - 1)) {
        // Backward, so a following Shift+← keeps extending to the left.
        return { type: "select", anchor: start, focus: start - 1 };
      }
      if (selected !== null && event.key === "ArrowLeft")
        return { type: "collapse", offset: start };
      return null;
    case "ArrowRight":
    case "Delete":
      if (!plain) return null;
      if (collapsed && starts.has(start))
        return { type: "select", anchor: start, focus: start + 1 };
      if (selected !== null && event.key === "ArrowRight") return { type: "collapse", offset: end };
      return null;
    case "Enter":
      if (selected === null || event.shiftKey) return null;
      if (event.altKey) return { type: "menu", start: selected };
      return { type: "open", start: selected };
    default:
      return null;
  }
}
