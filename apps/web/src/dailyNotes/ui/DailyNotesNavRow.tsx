import { useAtomValue } from "@effect/atom-react";
import { useLocation, useRouter } from "@tanstack/react-router";
import { NotebookPenIcon } from "lucide-react";

import { Kbd } from "~/components/ui/kbd";
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "~/components/ui/sidebar";
import { useUiText } from "~/i18n/useUiText";
import { shortcutLabelForCommand } from "~/keybindings";
import { primaryServerKeybindingsAtom } from "~/state/server";

import { useDailyNotesPrefs } from "../state/dailyNotesPrefs";
import { openDailyNotes } from "./openDailyNotes";

/** The sidebar's "Daily notes" row, under search; absent while the experiment is off. */
export function DailyNotesNavRow() {
  const uiText = useUiText();
  const router = useRouter();
  const enabled = useDailyNotesPrefs((prefs) => prefs.enabled);
  const pinned = useDailyNotesPrefs((prefs) => prefs.pinned);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { isMobile, setOpenMobile } = useSidebar();
  const onPage = useLocation({ select: (location) => location.pathname === "/daily-notes" });
  if (!enabled) return null;
  const shortcutLabel = shortcutLabelForCommand(keybindings, "dailyNotes.open");
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        data-testid="daily-notes-entry"
        isActive={onPage || pinned}
        onClick={() => {
          if (isMobile) setOpenMobile(false);
          openDailyNotes(router);
        }}
      >
        <NotebookPenIcon />
        <span className="flex-1 truncate">{uiText("Daily notes")}</span>
        {shortcutLabel ? <Kbd>{shortcutLabel}</Kbd> : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
