/**
 * Adapted from LodyAI/Lody (Apache License 2.0): packages/components/src/components/today/today-view.tsx
 * (TodayCalendar). Modified for Tianshu (Tailwind, Base UI popover).
 */
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useUiText } from "~/i18n/useUiText";
import { cn } from "~/lib/utils";

import { localTodayDate, todayDateToLocalDate, toIntlLocale, type TodayDate } from "../model/dates";

/** Six Monday-first weeks covering `month`. */
function monthCells(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from(
    { length: 42 },
    (_, index) => new Date(first.getFullYear(), first.getMonth(), 1 - offset + index),
  );
}

export function TodayCalendar(props: {
  today: TodayDate;
  selected: TodayDate;
  registered: readonly TodayDate[];
  language: string | undefined;
  onPick: (date: TodayDate) => void;
}) {
  const uiText = useUiText();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => todayDateToLocalDate(props.selected));
  const marked = new Set(props.registered);
  const cells = monthCells(month);
  const locale = toIntlLocale(props.language);
  const weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  const monthFormat = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" });
  const calendarLabel = uiText("Pick a date");
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setMonth(todayDateToLocalDate(props.selected));
      }}
    >
      <Tooltip disabled={open}>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={calendarLabel}
                  className="[-webkit-app-region:no-drag]"
                />
              }
            />
          }
        >
          <CalendarDaysIcon className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">{calendarLabel}</TooltipPopup>
      </Tooltip>
      <PopoverPopup align="end" side="bottom">
        <div className="flex w-[252px] flex-col gap-2 p-2">
          <div className="flex items-center justify-between text-ui-body">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={uiText("Previous month")}
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            >
              <ChevronLeftIcon className="size-3.5" />
            </Button>
            <span>{monthFormat.format(month)}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={uiText("Next month")}
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            >
              <ChevronRightIcon className="size-3.5" />
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.slice(0, 7).map((cell) => (
              <span
                key={`w${cell.getDay()}`}
                className="text-center text-2xs text-muted-foreground/60"
              >
                {weekdayFormat.format(cell)}
              </span>
            ))}
            {cells.map((cell) => {
              const date = localTodayDate(cell);
              return (
                <button
                  type="button"
                  key={date}
                  className={cn(
                    "relative h-[30px] cursor-pointer rounded-lg border-0 bg-transparent text-xs text-foreground hover:bg-accent",
                    cell.getMonth() !== month.getMonth() && "text-muted-foreground/60",
                    date === props.today && "font-semibold text-info",
                    date === props.selected && "bg-accent",
                  )}
                  aria-pressed={date === props.selected}
                  onClick={() => {
                    setOpen(false);
                    props.onPick(date);
                  }}
                >
                  {cell.getDate()}
                  {marked.has(date) ? (
                    <span className="absolute bottom-[3px] left-1/2 -ml-0.5 size-1 rounded-full bg-muted-foreground" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
