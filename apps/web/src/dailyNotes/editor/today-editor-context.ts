/**
 * Adapted from LodyAI/Lody (Apache License 2.0): packages/components/src/components/today/editor/today-editor-context.ts.
 * Modified for Tianshu (thread mentions, local storage, repo conventions).
 */
import { createContext, useContext, useSyncExternalStore } from "react";
import type { TodayEditorController } from "./today-editor-controller";

export const TodayEditorContext = createContext<TodayEditorController | null>(null);

/** The surface's editor controller; re-renders when the active node changes. */
export function useTodayEditor(): TodayEditorController | null {
  return useTodayEditorState().controller;
}

/** The controller plus its change counter, for render output derived from controller state. */
export function useTodayEditorState() {
  const controller = useContext(TodayEditorContext);
  const version = useSyncExternalStore(
    controller?.subscribe ?? noopSubscribe,
    controller?.getVersion ?? zeroVersion,
  );
  return { controller, version };
}

const noopSubscribe = () => () => {};
const zeroVersion = () => 0;
