import { uiText } from "./i18n";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import type { BoardData } from "./taskBoard.logic";
/** Shown wherever the board would be: Tianshu connects no external task board. */
export const NO_TASK_BOARD = "No task board is connected.";
interface BoardState {
  reveal: { folder: string | null; revision: number } | null;
  data: BoardData | null;
  error: string | null;
  cwd: string | null;
  loading: boolean;
  dataCwd: string | null;
  entry: { threadKey: string; revision: number } | null;
  /** The inbox item being answered; survives the switch to its source conversation. */
  focus: { folder: string; returnTo: ScopedThreadRef | null } | null;
  /** Conversation-level requests (approvals, questions, failures) published by the sidebar. */
  threadRequests: readonly InboxThreadRequest[];
}
export interface InboxThreadRequest {
  readonly key: string;
  readonly ref: ScopedThreadRef;
  readonly title: string;
  readonly reason: string;
  readonly place: string;
  readonly dismissLabel: string | null;
  readonly dismiss: (() => void) | null;
}
export const useTaskBoard = create<BoardState>(() => ({
  reveal: null,
  data: null,
  error: null,
  cwd: null,
  loading: true,
  dataCwd: null,
  entry: null,
  focus: null,
  threadRequests: [],
}));
export function focusTaskBoardItem(folder: string | null, returnTo: ScopedThreadRef | null = null) {
  useTaskBoard.setState({ focus: folder === null ? null : { folder, returnTo } });
}
export function refreshTaskBoard(): Promise<void> {
  const state = useTaskBoard.getState();
  if (state.loading || state.error !== uiText(NO_TASK_BOARD))
    useTaskBoard.setState({ data: null, error: uiText(NO_TASK_BOARD), loading: false });
  return Promise.resolve();
}
export async function setTaskBoardCwd(cwd: string | null) {
  if (useTaskBoard.getState().cwd === cwd) return;
  useTaskBoard.setState({ cwd });
  await refreshTaskBoard();
}
export function startTaskBoardPolling() {
  void refreshTaskBoard();
  return () => {};
}
export async function mutateTaskBoard(
  action: "toggle" | "snooze" | "review" | "link",
  body: {
    folder: string;
    session?: string;
    action?: "link" | "unlink";
    source?: "manual" | "auto" | "agent";
    title?: string;
    step?: string;
    until?: string;
    decision?: "approve" | "reject";
    reason?: string;
    target?: string;
  },
) {
  void action;
  void body;
  throw new Error(uiText(NO_TASK_BOARD));
}

export function requestTaskBoardCurrent(ref: ScopedThreadRef) {
  useTaskBoard.setState((state) => ({
    entry: { threadKey: scopedThreadKey(ref), revision: (state.entry?.revision ?? 0) + 1 },
  }));
}

export function requestTaskBoardCard(folder: string | null = null) {
  useTaskBoard.setState((state) => ({
    reveal: { folder, revision: (state.reveal?.revision ?? 0) + 1 },
  }));
}

export async function autoLinkBoardTask(_folder: string, _session: string, _title: string) {
  /* No board to link to. */
}
