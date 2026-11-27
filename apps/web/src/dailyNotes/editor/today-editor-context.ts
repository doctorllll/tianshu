/**
 * Adapted from LodyAI/Lody (Apache License 2.0): packages/components/src/components/today/editor/today-editor-context.ts.
 * Modified for Tianshu (thread mentions, local storage, repo conventions).
 */
import { createContext, useContext, useSyncExternalStore } from "react";
import type { TodayEditorController } from "./today-editor-controller";

export const TodayEditorContext = createContext<TodayEditorController | null>(null);

/** The surface's editor controller; re-renders when the active node changes. */
export function useTodayEditor(): TodayEditorController | null {
  const controller = useContext(TodayEditorContext);
  useSyncExternalStore(
    controller?.subscribe ?? noopSubscribe,
    controller?.getVersion ?? zeroVersion,
  );
  return controller;
}

const noopSubscribe = () => () => {};
const zeroVersion = () => 0;
