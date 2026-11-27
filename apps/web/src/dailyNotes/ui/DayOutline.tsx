/**
 * Adapted from LodyAI/Lody (Apache License 2.0): packages/components/src/components/today/today-day-section.tsx.
 * Modified for Tianshu (Tailwind, one local author, no sync rooms).
 */
import { PlusIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "~/components/ui/button";
import { useUiText } from "~/i18n/useUiText";

import { useTodayEditor, useTodayEditorState } from "../editor/today-editor-context";
import type { TodayEditorController } from "../editor/today-editor-controller";
import { formatTodayHeading, type TodayDate } from "../model/dates";
import type { TodayNodeId, TodayNodeView } from "../model/outline";
import type { TodayPageStoreCache } from "../store/page-cache";
import type { TodayPageStore } from "../store/page-store";
import { FOLD_OVERHANG_PX, TodayRow } from "./OutlineRow";

/** One day of the stream: a date heading over the day's outline. */
export function TodayDaySection(props: {
  cache: TodayPageStoreCache;
  date: TodayDate;
  today: TodayDate;
  language: string | undefined;
  isTop: boolean;
  /** A day's saved page is empty (skipped from the stream), or holds content again. */
  onEmptyChange: (date: TodayDate, empty: boolean) => void;
  /** Shows only this node and its subtree, under its text as the title. */
  zoomRoot?: TodayNodeId | null;
  /** The date heading opens this day alone. */
  onOpenDay?: ((date: TodayDate) => void) | undefined;
}) {
  const uiText = useUiText();
  const ref = useRef<HTMLElement | null>(null);
  const page = useNearViewportPage(ref, props.cache, props.date, props.isTop);
  const heading = formatTodayHeading(props.date, props.today, props.language);
  const { onOpenDay, date } = props;
  const label = (
    <>
      {heading.isToday ? uiText("Today") : heading.date}
      <span className="font-normal text-muted-foreground">{heading.meta}</span>
    </>
  );
  return (
    <section ref={ref} className="flex flex-col gap-1 py-3" data-today-date={props.date}>
      {props.zoomRoot ? null : (
        <h2 className="flex items-baseline gap-2 text-base font-semibold leading-6 text-foreground">
          {onOpenDay ? (
            <button
              type="button"
              className="inline-flex cursor-pointer items-baseline gap-2 border-0 bg-transparent p-0 text-start text-inherit underline-offset-4 decoration-muted-foreground/60 hover:underline"
              aria-label={uiText("Open {date} alone", { date: heading.date })}
              onClick={() => onOpenDay(date)}
            >
              {label}
            </button>
          ) : (
            label
          )}
        </h2>
      )}
      {page.store ? (
        <TodayStaticOutline
          store={page.store}
          isTop={props.isTop}
          onEmptyChange={props.onEmptyChange}
          zoomRoot={props.zoomRoot ?? null}
        />
      ) : page.failed ? (
        <div className="flex min-h-7 items-center gap-2 text-sm text-muted-foreground" role="alert">
          {uiText("Couldn't open this day.")}
          <Button size="xs" variant="ghost" onClick={page.retry}>
            {uiText("Retry")}
          </Button>
        </div>
      ) : (
        <div className="flex min-h-7 flex-col" />
      )}
    </section>
  );
}

function TodayStaticOutline(props: {
  store: TodayPageStore;
  zoomRoot: TodayNodeId | null;
  isTop: boolean;
  onEmptyChange: (date: TodayDate, empty: boolean) => void;
}) {
  const { store, isTop, onEmptyChange } = props;
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { controller, version } = useTodayEditorState();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the effect adopts state owned outside React (store, controller or DOM) into a React mirror
  useEffect(() => controller?.registerDay(store.date, store), [controller, store]);
  // A day found empty is skipped from the stream until it is written again.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the effect adopts state owned outside React (store, controller or DOM) into a React mirror
  useEffect(() => {
    if (!isTop) onEmptyChange(store.date, snapshot.isEmpty);
  }, [isTop, onEmptyChange, snapshot.isEmpty, store.date]);

  if (props.zoomRoot) return <TodayZoomedOutline store={store} root={props.zoomRoot} />;
  if (snapshot.visible.length === 0) {
    return (
      <div className="flex min-h-7 flex-col">
        <TodayRow node={null} store={store} active={false} selected={false} />
      </div>
    );
  }
  return (
    <div className="flex min-h-7 flex-col" role="tree">
      {snapshot.visible.map((node, index) => (
        <TodayRow
          key={node.id}
          store={store}
          {...rowState(version, controller, store, snapshot.visible, index)}
        />
      ))}
    </div>
  );
}

/** A node zoomed into: its text as the title, then its subtree from depth 0. */
function TodayZoomedOutline(props: { store: TodayPageStore; root: TodayNodeId }) {
  const uiText = useUiText();
  const { store, root } = props;
  const { controller, version } = useTodayEditorState();
  const subtree = useSyncExternalStore(store.subscribe, () => store.outline.getSubtree(root));
  const view = subtree ? store.outline.getNode(root) : undefined;
  const node = view && { ...view, depth: 0 };
  if (!subtree || !node) {
    return (
      <div className="flex min-h-7 items-center gap-2 text-sm text-muted-foreground" role="alert">
        {uiText("This node was deleted.")}
        <Button size="xs" variant="ghost" onClick={() => controller?.onZoomOut?.()}>
          {uiText("Back to the parent")}
        </Button>
      </div>
    );
  }
  const rootState = rowState(version, controller, store, [node], 0);
  return (
    <div className="flex min-h-7 flex-col" role="tree">
      <TodayRow
        node={node}
        store={store}
        title
        active={rootState.active}
        selected={rootState.selected}
      />
      {subtree.visible.length === 0 ? (
        <TodayAddChild store={store} parentId={root} />
      ) : (
        subtree.visible.map((row, index) => (
          <TodayRow
            key={row.id}
            store={store}
            {...rowState(version, controller, store, subtree.visible, index)}
          />
        ))
      )}
    </div>
  );
}

/** A zoomed node without children: a "+" where its first child's bullet would be. */
function TodayAddChild(props: { store: TodayPageStore; parentId: TodayNodeId }) {
  const uiText = useUiText();
  const controller = useTodayEditor();
  return (
    <button
      type="button"
      className="group/add relative flex min-h-7 w-full cursor-text items-start gap-1 border-0 bg-transparent p-0 text-start"
      style={{ marginInlineStart: -FOLD_OVERHANG_PX }}
      aria-label={uiText("Add a child")}
      tabIndex={-1}
      data-today-add-child=""
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => controller?.startPage(props.store, props.parentId)}
    >
      <span className="-me-1 w-3 shrink-0" />
      <span className="pointer-events-none relative inline-flex h-7 w-4 shrink-0 items-center justify-center">
        <span className="pointer-events-auto relative inline-flex size-4 items-center justify-center rounded-full text-muted-foreground/60 opacity-0 transition-[opacity,background-color] hover:bg-accent hover:text-muted-foreground group-hover/surface:opacity-100 pointer-coarse:opacity-100">
          <PlusIcon className="size-3" strokeWidth={2.5} />
        </span>
      </span>
    </button>
  );
}

/** What a memoized row compares: its node and its editing and selection state. */
function rowState(
  _version: number,
  controller: TodayEditorController | null,
  store: TodayPageStore,
  visible: readonly TodayNodeView[],
  index: number,
) {
  const node = visible[index]!;
  const isSelected = (at: number) => {
    const other = visible[at];
    return !!other && !!controller?.isBlockSelected(store, other.id);
  };
  const selected = isSelected(index);
  return {
    node,
    active: !!controller?.isActive(store, node.id),
    selected,
    // A run of selected rows reads as one block: only its ends are rounded.
    joinsPrevious: selected && isSelected(index - 1),
    joinsNext: selected && isSelected(index + 1),
  };
}

/** Acquire the page while its section is within ~1.5 screens of the viewport. */
function useNearViewportPage(
  ref: React.RefObject<HTMLElement | null>,
  cache: TodayPageStoreCache,
  docId: string,
  eager: boolean,
): { store: TodayPageStore | undefined; failed: boolean; retry: () => void } {
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  const shouldAcquire = eager || near;
  const [store, setStore] = useState<TodayPageStore | undefined>(() => cache.peek(docId));
  const [failed, setFailed] = useState(false);
  // Bumped by Retry: a failed open is not cached, so acquiring again starts over.
  const [attempt, setAttempt] = useState(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the effect adopts state owned outside React (store, controller or DOM) into a React mirror
  useEffect(() => {
    const element = ref.current;
    if (eager || !element || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => setNear(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: "150% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [eager, ref]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds a reference-counted page in the cache while mounted
  useEffect(() => {
    if (!shouldAcquire) return undefined;
    let cancelled = false;
    let held = false;
    // oxlint-disable-next-line react/set-state-in-effect -- the effect adopts state owned outside React (store, controller or DOM) into a React mirror
    setFailed(false);
    cache.acquire(docId).then(
      (acquired) => {
        if (cancelled) {
          cache.releaseRef(docId);
          return;
        }
        held = true;
        setStore(acquired);
      },
      (error: unknown) => {
        console.warn("Daily note failed to open", { docId, error });
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
      setStore(undefined);
      if (held) cache.releaseRef(docId);
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- the extra dependency marks when the external controller state changed
  }, [attempt, cache, docId, shouldAcquire]);
  const retry = () => setAttempt((value) => value + 1);
  return { store, failed, retry };
}
