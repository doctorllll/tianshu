/**
 * Adapted from LodyAI/Lody (Apache License 2.0): packages/shared/src/today-types.ts and
 * packages/components/src/components/today/today-stream.ts. Modified for Tianshu: single local
 * author, so pages are identified by their date alone; routing and member helpers removed.
 */

/** A real calendar date in `YYYY-MM-DD` form. */
export type TodayDate = string & { readonly __todayDate: unique symbol };

const TODAY_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in `YYYY-MM-DD` form, or null. */
export function parseTodayDate(value: string): TodayDate | null {
  const match = TODAY_DATE_PATTERN.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return value as TodayDate;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The viewer's local calendar day. */
export function localTodayDate(now: Date): TodayDate {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` as TodayDate;
}

export function msUntilNextLocalMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function todayDateToLocalDate(date: TodayDate): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

/**
 * Which days the stream shows, top to bottom. The top day is the calendar anchor, or today; it
 * always shows, even when empty or unregistered. Below it come earlier registered days, newest
 * first; a registered day found empty after loading is skipped.
 */
export function buildDayStream(input: {
  today: TodayDate;
  anchor?: TodayDate;
  registered: readonly TodayDate[];
  empty: ReadonlySet<TodayDate>;
}): TodayDate[] {
  const top = input.anchor ?? input.today;
  const earlier = [...new Set(input.registered)]
    .filter((date) => date < top && !input.empty.has(date))
    .toSorted()
    .toReversed();
  return [top, ...earlier];
}

/** An Intl locale from an app language code such as `zh_CN`; undefined (the system's) when unusable. */
export function toIntlLocale(language: string | null | undefined): string | undefined {
  if (!language) return undefined;
  try {
    return Intl.getCanonicalLocales(language.replaceAll("_", "-"))[0];
  } catch {
    return undefined;
  }
}

/**
 * A day heading in the product language. Today reads "Today" with the full date beside it; other
 * days read the date with the weekday beside it.
 */
export function formatTodayHeading(
  date: TodayDate,
  today: TodayDate,
  language: string | null | undefined,
): { date: string; meta: string; isToday: boolean } {
  const locale = toIntlLocale(language);
  const value = todayDateToLocalDate(date);
  const isToday = date === today;
  const day = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric" }).format(value);
  const meta = isToday
    ? new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }).format(
        value,
      )
    : new Intl.DateTimeFormat(locale, { weekday: "long" }).format(value);
  return { date: day, meta, isToday };
}

/**
 * What the full-page route does. While the notes are pinned beside the sidebar the route hands
 * its date to the column instead of showing the notes twice; where the column cannot appear
 * (compact layout) the page shows as usual.
 */
export function todayRouteOutcome(input: {
  enabled: boolean;
  pinned: boolean;
  compact: boolean;
}): "redirect" | "to-column" | "page" {
  if (!input.enabled) return "redirect";
  return input.pinned && !input.compact ? "to-column" : "page";
}

/** `focus`: `"day"` for the day alone, or a node id to zoom into. */
export type TodaySearch = { date?: string; focus?: string };

const FOCUS_PATTERN = /^(day|\d+@\d+)$/;

/** The date/focus search of the notes route. */
export function validateTodaySearch(search: Record<string, unknown>): TodaySearch {
  return {
    ...(typeof search.date === "string" && parseTodayDate(search.date)
      ? { date: search.date }
      : {}),
    ...(typeof search.focus === "string" && FOCUS_PATTERN.test(search.focus)
      ? { focus: search.focus }
      : {}),
  };
}
