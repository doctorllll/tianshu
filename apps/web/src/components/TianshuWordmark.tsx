import { useUiText } from "~/i18n/useUiText";
import { cn } from "~/lib/utils";

/**
 * 天枢 as the brand mark: slender stencil-cut glyphs on an orbit, the Tianshu star at the pivot
 * of 枢; starlight on dark grounds, ink on light ones. `onDark` keeps the starlight version.
 */
export function TianshuWordmark({
  className,
  onDark = false,
}: {
  readonly className?: string;
  readonly onDark?: boolean;
}) {
  const uiText = useUiText();
  return (
    <span
      className={cn("inline-flex shrink-0", className)}
      role="img"
      aria-label={uiText("Tianshu")}
    >
      <img
        alt=""
        draggable={false}
        src="/brand/tianshu-mark-dark.svg"
        className={cn("h-full w-auto select-none", !onDark && "hidden dark:block")}
      />
      {onDark ? null : (
        <img
          alt=""
          draggable={false}
          src="/brand/tianshu-mark-light.svg"
          className="h-full w-auto select-none dark:hidden"
        />
      )}
    </span>
  );
}
