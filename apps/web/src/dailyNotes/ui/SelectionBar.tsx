/**
 * Adapted from LodyAI/Lody (Apache License 2.0): packages/components/src/components/today/today-selection-bar.tsx.
 * Modified for Tianshu (Tailwind, Base UI).
 */
import {
  CopyIcon,
  MessageSquarePlusIcon,
  SquareCheckIcon,
  SquareIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { Button } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useUiText } from "~/i18n/useUiText";

import { topLevelSelection } from "../editor/block-selection";
import { useTodayEditor } from "../editor/today-editor-context";
import { TODAY_MENTION_CHAR, type TodayNodeId } from "../model/outline";
import type { TodayPageStore } from "../store/page-store";
import { modShortcut } from "./shortcutLabels";

const BAR_HEIGHT = 36;
const BAR_GAP = 6;

const noopSubscribe = () => () => {};
const noSnapshot = () => null;

/** Block-selection actions: to-do step, Convert to task, Copy, Delete. */
export function TodaySelectionBar(props: {
  onConvert: (store: TodayPageStore, nodeId: TodayNodeId) => void;
}) {
  const uiText = useUiText();
  const controller = useTodayEditor();
  const ref = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const [layout, setLayout] = useState(0);
  const selection =
    controller && !controller.isSelectingByPointer() ? controller.getBlockSelection() : null;
  const version = controller?.getVersion() ?? 0;
  const snapshot = useSyncExternalStore(
    selection?.store.subscribe ?? noopSubscribe,
    selection?.store.getSnapshot ?? noSnapshot,
  );
  const surface = controller?.getSurface() ?? null;

  useEffect(() => {
    if (!selection || !surface) return undefined;
    const bump = () => setLayout((value) => value + 1);
    surface.addEventListener("scroll", bump, { passive: true });
    const view = surface.ownerDocument.defaultView;
    view?.addEventListener("resize", bump);
    return () => {
      surface.removeEventListener("scroll", bump);
      view?.removeEventListener("resize", bump);
    };
  }, [selection, surface]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- places the bar from the selected rows' DOM geometry
  useLayoutEffect(() => {
    if (!selection || !surface) return setPlace(null);
    const ids = new Set<string>(selection.ids);
    const rows = [...surface.querySelectorAll<HTMLElement>("[data-today-node]")].filter((row) =>
      ids.has(row.dataset.todayNode ?? ""),
    );
    const first = rows[0];
    const last = rows.at(-1);
    if (!first || !last) return setPlace(null);
    const bounds = surface.getBoundingClientRect();
    const top = first.getBoundingClientRect().top - BAR_HEIGHT - BAR_GAP;
    const below = last.getBoundingClientRect().bottom + BAR_GAP;
    const bullet = first.querySelector("[data-today-bullet]") ?? first;
    const width = ref.current?.offsetWidth ?? 0;
    const left = Math.max(
      bounds.left + 4,
      Math.min(bullet.getBoundingClientRect().left, bounds.right - width - 4),
    );
    setPlace({
      top: top >= bounds.top ? top : Math.min(below, bounds.bottom - BAR_HEIGHT - 4),
      left,
    });
    return undefined;
  }, [selection, surface, version, layout, snapshot]);

  if (!controller || !selection) return null;
  const { store } = selection;
  const visible = snapshot?.visible ?? [];
  const roots = topLevelSelection(visible, selection.ids);
  const root = roots.length === 1 ? store.outline.getNode(roots[0]!) : undefined;
  const canConvert = !!root && root.text.replaceAll(TODAY_MENTION_CHAR, "").trim().length > 0;
  const state = visible.find((node) => node.id === selection.ids[0])?.todo;
  const todo =
    state === undefined
      ? { icon: <SquareIcon />, label: uiText("Turn into to-do") }
      : state === "todo"
        ? { icon: <SquareCheckIcon />, label: uiText("Mark as done") }
        : { icon: <TypeIcon />, label: uiText("Back to plain text") };

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={uiText("Selected nodes")}
      className="fixed z-45 box-border flex h-9 items-center gap-0.5 rounded-xl bg-popover p-1 shadow-[0_8px_24px_rgb(0_0_0/0.16)] ring-1 ring-border"
      style={place ? place : { visibility: "hidden", top: 0, left: 0 }}
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
    >
      <BarButton
        label={todo.label}
        shortcut={modShortcut("↵")}
        onClick={() => controller.cycleSelectionTodo()}
      >
        {todo.icon}
      </BarButton>
      <Button
        variant="ghost"
        size="xs"
        disabled={!canConvert}
        onClick={() => root && props.onConvert(store, root.id)}
      >
        <MessageSquarePlusIcon />
        {uiText("Convert to task")}
      </Button>
      <span className="mx-0.5 my-1 w-px self-stretch bg-border" />
      <BarButton
        label={uiText("Copy")}
        shortcut={modShortcut("C")}
        onClick={() => controller.copySelection()}
      >
        <CopyIcon />
      </BarButton>
      <BarButton label={uiText("Delete")} shortcut="⌫" onClick={() => controller.deleteSelection()}>
        <Trash2Icon />
      </BarButton>
    </div>
  );
}

function BarButton(props: {
  label: string;
  shortcut: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-xs" aria-label={props.label} onClick={props.onClick} />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="top">
        <span className="flex items-center gap-1">
          {props.label}
          <Kbd>{props.shortcut}</Kbd>
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}
