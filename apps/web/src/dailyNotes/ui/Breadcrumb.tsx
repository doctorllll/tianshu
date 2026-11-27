/**
 * Adapted from LodyAI/Lody (Apache License 2.0): packages/components/src/components/today/today-breadcrumb.tsx.
 * Modified for Tianshu (Tailwind).
 */
import { ChevronRightIcon } from "lucide-react";
import { Fragment } from "react";

import { useUiText } from "~/i18n/useUiText";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

export type TodayCrumb = { key: string; label: string; onSelect?: () => void };

/**
 * Where the focus view is: "Daily notes › date › ancestors", each part a way back. Middle
 * ancestors fold into "…" so the first and the nearest two stay.
 */
export function TodayBreadcrumb(props: { crumbs: readonly TodayCrumb[] }) {
  const uiText = useUiText();
  const { crumbs } = props;
  const folded = crumbs.length > 5;
  const shown = folded ? [...crumbs.slice(0, 2), null, ...crumbs.slice(-2)] : crumbs;
  return (
    <nav
      aria-label={uiText("Location")}
      className="flex min-w-0 select-none items-center gap-0.5 text-ui-body leading-4.5"
    >
      {shown.map((crumb, index) => (
        <Fragment key={crumb?.key ?? "more"}>
          {index > 0 ? (
            <ChevronRightIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/60" />
          ) : null}
          {crumb === null ? (
            <span className="shrink-0 px-1 text-muted-foreground/60">…</span>
          ) : crumb.onSelect ? (
            <Tooltip>
              <TooltipTrigger
                render={<button type="button" onClick={crumb.onSelect} />}
                className={cn(
                  "min-w-0 max-w-45 shrink cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap rounded-sm border-0 bg-transparent px-1 py-0.5 text-muted-foreground hover:bg-accent",
                  index === 0 && "shrink-0",
                )}
              >
                {crumb.label}
              </TooltipTrigger>
              <TooltipPopup>{crumb.label}</TooltipPopup>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 text-foreground"
                    aria-current="page"
                  />
                }
              >
                {crumb.label}
              </TooltipTrigger>
              <TooltipPopup>{crumb.label}</TooltipPopup>
            </Tooltip>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
