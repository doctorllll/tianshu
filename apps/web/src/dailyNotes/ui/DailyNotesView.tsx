/**
 * Adapted from LodyAI/Lody (Apache License 2.0): packages/components/src/components/today/today-view.tsx.
 * Modified for Tianshu (Tailwind, Base UI, one local author, no members or windows).
 */
import { useLocale } from "gt-react";
import { MoreHorizontalIcon, PinIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Button } from "~/components/ui/button";
import { Menu, MenuCheckboxItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Toggle } from "~/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import { useUiText } from "~/i18n/useUiText";
import { readThreadShell } from "~/state/entities";
import { cn } from "~/lib/utils";

import { TodayEditorContext, useTodayEditor } from "../editor/today-editor-context";
import { todayMentionMarkdown } from "../editor/block-selection";
import { TodayEditorController } from "../editor/today-editor-controller";
import {
  buildDayStream,
  parseTodayDate,
  toIntlLocale,
  type TodayDate,
  type TodaySearch,
} from "../model/dates";
import { TODAY_MENTION_CHAR, type TodayNodeId } from "../model/outline";
import { THREAD_MENTION_KIND } from "../thread-mention";
import { useDailyNotesCache } from "../state/useDailyNotesCache";
import { useDailyNotesPrefs } from "../state/dailyNotesPrefs";
import { useTodayClock } from "../state/useTodayClock";
import type { TodayPageStore } from "../store/page-store";
import { TodayBreadcrumb, type TodayCrumb } from "./Breadcrumb";
import { TodayCalendar } from "./DateCalendar";
import { DailyNotesToolbar, type DailyNotesSurface } from "./DailyNotesToolbar";
import { TodayDaySection } from "./DayOutline";
import { TodayLiveThreadPicker } from "./MentionPicker";
import { TodayMentionStatusMenuHost } from "./MentionStatusMenu";
import { TodayNodeActions } from "./NodeActions";
import { TodayOutlineSurface } from "./OutlineSurface";
import { threadMentionRef } from "./threadMentionState";

export type TodayViewTarget = TodaySearch;

/** Where the stream was: the top visible row and its offset (plus the raw scroll, as a fallback). */
type TodayScrollAnchor = { nodeId: string | null; offset: number; scrollTop: number };

function captureScrollAnchor(surface: HTMLElement | null): TodayScrollAnchor | null {
  if (!surface) return null;
  const top = surface.getBoundingClientRect().top;
  for (const row of surface.querySelectorAll<HTMLElement>("[data-today-node]")) {
    const rect = row.getBoundingClientRect();
    if (rect.bottom > top) {
      return {
        nodeId: row.dataset.todayNode ?? null,
        offset: rect.top - top,
        scrollTop: surface.scrollTop,
      };
    }
  }
  return { nodeId: null, offset: 0, scrollTop: surface.scrollTop };
}

/**
 * Put the stream back where it was. Days above may have grown or shrunk meanwhile, so after the
 * raw offset the anchor row is lined up again once it mounts.
 */
function restoreScrollAnchor(surface: HTMLElement | null, anchor: TodayScrollAnchor | null) {
  if (!surface || !anchor) return undefined;
  surface.scrollTop = anchor.scrollTop;
  let frames = 0;
  let handle = 0;
  const align = () => {
    const row = anchor.nodeId
      ? surface.querySelector<HTMLElement>(`[data-today-node="${CSS.escape(anchor.nodeId)}"]`)
      : null;
    if (row) {
      surface.scrollTop +=
        row.getBoundingClientRect().top - surface.getBoundingClientRect().top - anchor.offset;
      return;
    }
    frames += 1;
    if (frames < 30) handle = requestAnimationFrame(align);
  };
  align();
  return () => cancelAnimationFrame(handle);
}

const noopSubscribe = () => () => {};
const noSnapshot = () => null;

/** The focus view's breadcrumb: back to the stream, the day, and the zoomed node's ancestors. */
function TodayFocusCrumbs(props: {
  page: () => TodayPageStore | undefined;
  date: TodayDate;
  zoomRoot: TodayNodeId | null;
  rootLabel: string;
  onStream: () => void;
  onFocus: (focus: string) => void;
}) {
  const uiText = useUiText();
  const { zoomRoot } = props;
  useTodayEditor();
  const page = props.page();
  useSyncExternalStore(page?.subscribe ?? noopSubscribe, page?.getSnapshot ?? noSnapshot);
  const label = (nodeId: TodayNodeId) => {
    const text = page?.outline.getNode(nodeId)?.text.replaceAll(TODAY_MENTION_CHAR, "").trim();
    return text || uiText("Untitled");
  };
  const ancestors: TodayNodeId[] = [];
  for (
    let parent = zoomRoot ? (page?.outline.getNode(zoomRoot)?.parentId ?? null) : null;
    parent;
    parent = page?.outline.getNode(parent)?.parentId ?? null
  ) {
    ancestors.unshift(parent);
  }
  const crumbs: TodayCrumb[] = [
    { key: "stream", label: props.rootLabel, onSelect: props.onStream },
    {
      key: "day",
      label: props.date,
      ...(zoomRoot ? { onSelect: () => props.onFocus("day") } : {}),
    },
    ...ancestors.map((id) => ({ key: id, label: label(id), onSelect: () => props.onFocus(id) })),
    ...(zoomRoot ? [{ key: zoomRoot, label: label(zoomRoot) }] : []),
  ];
  return <TodayBreadcrumb crumbs={crumbs} />;
}

/**
 * The daily notes: a stream of days around `target.date`, or with `target.focus` only that day
 * or one node of it. Navigation is the host's: the full page writes the route search, the pinned
 * column keeps its own state.
 */
export function TodayView(props: {
  target: TodayViewTarget;
  onNavigate: (target: TodayViewTarget) => void;
  surface: DailyNotesSurface;
  onTogglePin?: () => void;
  /** Opens the thread a mention points at; the host decides where it shows. */
  onOpenThread: (mentionId: string) => void;
}) {
  const uiText = useUiText();
  const locale = toIntlLocale(useLocale());
  const cache = useDailyNotesCache();
  const today = useTodayClock();
  const anchor = props.target.date ? (parseTodayDate(props.target.date) ?? undefined) : undefined;
  const [registered, setRegistered] = useState<readonly TodayDate[]>([]);
  const [savedEmpty, setSavedEmpty] = useState<ReadonlySet<TodayDate>>(new Set());
  const [empty, setEmpty] = useState<ReadonlySet<TodayDate>>(new Set());
  const fullWidth = useDailyNotesPrefs((prefs) => prefs.fullWidth);
  const setFullWidth = useDailyNotesPrefs((prefs) => prefs.setFullWidth);
  const [moreOpen, setMoreOpen] = useState(false);
  const pinnedColumn = props.surface === "pinned";

  useEffect(() => {
    if (!cache) return undefined;
    return cache.observeDates((entries) => {
      setRegistered(entries.map((entry) => entry.date));
      setSavedEmpty(new Set(entries.filter((entry) => entry.empty).map((entry) => entry.date)));
    });
  }, [cache]);

  const onEmptyChange = useCallback((date: TodayDate, isEmpty: boolean) => {
    setEmpty((previous) => {
      if (previous.has(date) === isEmpty) return previous;
      const next = new Set(previous);
      if (isEmpty) next.add(date);
      else next.delete(date);
      return next;
    });
  }, []);
  const focus = props.target.focus;
  const focusDate = focus ? (anchor ?? today) : null;
  const zoomRoot = focus && focus !== "day" ? (focus as TodayNodeId) : null;
  const days = useMemo(() => {
    if (focusDate) return [focusDate];
    // Open pages are the better witness of emptiness; a day's saved flag covers the rest.
    const skipped = new Set([...savedEmpty].filter((date) => !empty.has(date) || true));
    for (const date of empty) skipped.add(date);
    return buildDayStream({ today, ...(anchor ? { anchor } : {}), registered, empty: skipped });
  }, [anchor, empty, focusDate, registered, savedEmpty, today]);

  const [controller, setController] = useState<TodayEditorController | null>(null);
  const latest = useRef({ onOpenThread: props.onOpenThread });
  useEffect(() => {
    latest.current = { onOpenThread: props.onOpenThread };
  }, [props.onOpenThread]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the editor controller owns a Lexical editor and listeners, released on unmount
  useEffect(() => {
    if (!cache) return undefined;
    const created = new TodayEditorController(cache);
    created.mentionText = (mention) =>
      todayMentionMarkdown(mention, { title: threadMentionTitle(mention) });
    created.onOpenSession = (mentionId) => latest.current.onOpenThread(mentionId);
    setController(created);
    return () => {
      created.dispose();
      setController(null);
    };
  }, [cache]);
  useEffect(
    () => controller?.setFocus(focusDate ? { date: focusDate, rootId: zoomRoot } : null),
    [controller, focusDate, zoomRoot],
  );

  const streamReturn = useRef<{ target: TodayViewTarget; anchor: TodayScrollAnchor | null } | null>(
    null,
  );
  const dateParam = (date: TodayDate) => (date === today ? undefined : date);
  const enterFocus = (next: TodayViewTarget) => {
    if (!props.target.focus) {
      streamReturn.current = {
        target: props.target,
        anchor: captureScrollAnchor(controller?.getSurface() ?? null),
      };
    }
    props.onNavigate(next);
  };
  const leaveFocus = () => props.onNavigate(streamReturn.current?.target ?? {});
  const focusPage = () => (focusDate ? cache?.peek(focusDate) : undefined);
  const nav = {
    zoom: (store: TodayPageStore, nodeId: TodayNodeId) => {
      const date = dateParam(store.date);
      enterFocus({ ...(date ? { date } : {}), focus: nodeId });
    },
    zoomOut: () => {
      if (!focusDate) return;
      if (!zoomRoot) return leaveFocus();
      const parent = focusPage()?.outline.getNode(zoomRoot)?.parentId;
      props.onNavigate({ ...props.target, focus: parent ?? "day" });
    },
    openDay: (date: TodayDate) => {
      const param = dateParam(date);
      enterFocus({ ...(param ? { date: param } : {}), focus: "day" });
    },
  };
  const navRef = useRef(nav);
  useEffect(() => {
    navRef.current = nav;
  });
  useEffect(() => {
    if (!controller) return undefined;
    controller.onZoom = (store, nodeId) => navRef.current.zoom(store, nodeId);
    controller.onZoomOut = () => navRef.current.zoomOut();
    return () => {
      controller.onZoom = null;
      controller.onZoomOut = null;
    };
  }, [controller]);
  useLayoutEffect(() => {
    if (focusDate || !streamReturn.current) return undefined;
    const { anchor: saved } = streamReturn.current;
    streamReturn.current = null;
    return restoreScrollAnchor(controller?.getSurface() ?? null, saved);
  }, [controller, focusDate]);

  if (!cache) return null;
  const pinControlLabel = uiText("Pin to sidebar");
  const pinTooltip = pinnedColumn ? uiText("Unpin") : pinControlLabel;
  const moreLabel = uiText("More");
  const rootLabel = uiText("Daily notes");
  return (
    <TodayEditorContext.Provider value={controller}>
      <div className="relative flex h-full min-h-0 flex-col" data-testid="daily-notes-view">
        <DailyNotesToolbar
          surface={props.surface}
          title={
            focusDate ? (
              <TodayFocusCrumbs
                page={focusPage}
                date={focusDate}
                zoomRoot={zoomRoot}
                rootLabel={rootLabel}
                onStream={leaveFocus}
                onFocus={(next) => props.onNavigate({ ...props.target, focus: next })}
              />
            ) : null
          }
          interactiveTitle={!!focusDate}
        >
          <TooltipProvider delay={400}>
            <TodayCalendar
              today={today}
              selected={anchor ?? today}
              registered={registered}
              language={locale}
              onPick={(date) => {
                const { focus: _focus, ...rest } = props.target;
                props.onNavigate({ ...rest, ...(date === today ? { date: undefined } : { date }) });
              }}
            />
            {props.onTogglePin ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Toggle
                      size="sm"
                      variant="ghost"
                      pressed={pinnedColumn}
                      aria-label={pinControlLabel}
                      onPressedChange={() => props.onTogglePin?.()}
                    />
                  }
                >
                  <PinIcon
                    className={cn(
                      "size-4 transition-transform duration-100 motion-reduce:transition-none",
                      !pinnedColumn && "rotate-45",
                    )}
                  />
                </TooltipTrigger>
                <TooltipPopup side="bottom">{pinTooltip}</TooltipPopup>
              </Tooltip>
            ) : null}
            {pinnedColumn ? null : (
              <Menu open={moreOpen} onOpenChange={setMoreOpen}>
                <Tooltip disabled={moreOpen}>
                  <TooltipTrigger
                    render={
                      <MenuTrigger
                        render={<Button variant="ghost" size="icon-sm" aria-label={moreLabel} />}
                      />
                    }
                  >
                    <MoreHorizontalIcon className="size-4" />
                  </TooltipTrigger>
                  <TooltipPopup side="bottom">{moreLabel}</TooltipPopup>
                </Tooltip>
                <MenuPopup align="end">
                  <MenuCheckboxItem checked={fullWidth} onCheckedChange={setFullWidth}>
                    {uiText("Full width")}
                  </MenuCheckboxItem>
                </MenuPopup>
              </Menu>
            )}
          </TooltipProvider>
        </DailyNotesToolbar>
        <TodayOutlineSurface
          controller={controller}
          fullWidth={pinnedColumn || fullWidth}
          placement={pinnedColumn ? "pinned" : "page"}
        >
          {days.map((date, index) => (
            <TodayDaySection
              key={date}
              cache={cache}
              date={date}
              today={today}
              language={locale}
              isTop={index === 0}
              onEmptyChange={onEmptyChange}
              zoomRoot={zoomRoot}
              onOpenDay={focusDate ? undefined : nav.openDay}
            />
          ))}
        </TodayOutlineSurface>
        <TodayLiveThreadPicker />
        <TodayNodeActions openAfterConvert={pinnedColumn} />
        <TodayMentionStatusMenuHost />
        {anchor && anchor !== today && !focusDate ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
            <span className="pointer-events-auto">
              <Button
                variant="secondary"
                size="sm-pill"
                onClick={() => props.onNavigate({ ...props.target, date: undefined })}
              >
                {uiText("Back to today")}
              </Button>
            </span>
          </div>
        ) : null}
      </div>
    </TodayEditorContext.Provider>
  );
}

/** The title a mention's thread has now, for the plain-text form of a copy. */
function threadMentionTitle(mention: { kind: string; id: string }): string | null {
  const ref = mention.kind === THREAD_MENTION_KIND ? threadMentionRef(mention.id) : null;
  return ref ? (readThreadShell(ref)?.title ?? null) : null;
}
