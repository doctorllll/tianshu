import { isMacPlatform } from "~/lib/utils";

/** The label of a Mod-based shortcut: `⌘C` on macOS, `Ctrl+C` elsewhere. */
export function modShortcut(key: string): string {
  return isMacPlatform(navigator.platform) ? `⌘${key}` : `Ctrl+${key}`;
}

/** `⌥→` on macOS, `Alt+→` elsewhere. */
export function altShortcut(key: string): string {
  return isMacPlatform(navigator.platform) ? `⌥${key}` : `Alt+${key}`;
}
