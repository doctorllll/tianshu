/**
 * Adapted from LodyAI/Lody (Apache License 2.0): packages/components/src/components/today/today-mention-status-menu.tsx.
 * Modified for Tianshu (Base UI menu, the sidebar's thread actions).
 */
import { AlarmClockIcon, CheckIcon, CircleDotIcon, MailCheckIcon, MailIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { pickSnoozePreset, resolveSnoozePresets } from "~/components/Sidebar.snooze";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "~/components/ui/menu";
import { useClientSettings } from "~/hooks/useSettings";
import { useAcknowledgeThreadWoke, useThreadActions } from "~/hooks/useThreadActions";
import { useUiText } from "~/i18n/useUiText";

import { useTodayEditor } from "../editor/today-editor-context";
import { threadMentionRef, useThreadMentionDisplay } from "./threadMentionState";

/** The menu a mention's status icon opens; one host serves every mention. */
export function TodayMentionStatusMenuHost() {
  const controller = useTodayEditor();
  const [target, setTarget] = useState<{ mentionId: string; anchor: HTMLElement } | null>(null);
  useEffect(() => {
    if (!controller) return undefined;
    controller.onMentionMenu = (mentionId, anchor) => setTarget({ mentionId, anchor });
    return () => {
      controller.onMentionMenu = null;
    };
  }, [controller]);
  if (!target) return null;
  return <StatusMenu {...target} onClose={() => setTarget(null)} />;
}

function StatusMenu(props: { mentionId: string; anchor: HTMLElement; onClose: () => void }) {
  const uiText = useUiText();
  const display = useThreadMentionDisplay(props.mentionId);
  const ref = threadMentionRef(props.mentionId);
  const { markThreadUnread, settleThread, snoozeThread, unsettleThread, unsnoozeThread } =
    useThreadActions();
  const acknowledge = useAcknowledgeThreadWoke();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  if (!ref || display.state !== "ok") return null;
  // oxlint-disable-next-line react/purity -- presets are resolved while the menu is open, so each opening reads a fresh time
  const presets = resolveSnoozePresets(new Date(), timestampFormat, ref.environmentId);
  const close = props.onClose;
  const snooze = (presetId: string) => {
    const picked = pickSnoozePreset(presets, presetId, timestampFormat, ref.environmentId);
    if (picked) void snoozeThread(ref, picked.snoozedUntil);
    close();
  };
  return (
    <Menu open onOpenChange={(open) => !open && close()}>
      <MenuPopup anchor={props.anchor} side="bottom" align="start">
        {display.unread ? (
          <MenuItem
            onClick={() => {
              acknowledge(ref, new Date().toISOString());
              close();
            }}
          >
            <MailCheckIcon />
            {uiText("Mark as read")}
          </MenuItem>
        ) : (
          <MenuItem
            onClick={() => {
              markThreadUnread(ref);
              close();
            }}
          >
            <MailIcon />
            {uiText("Mark as unread")}
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuSub>
          <MenuSubTrigger>
            <AlarmClockIcon />
            {uiText("Later")}
          </MenuSubTrigger>
          <MenuSubPopup>
            {presets.map((preset) => (
              <MenuItem key={preset.id} onClick={() => snooze(preset.id)}>
                {uiText(preset.label)}
              </MenuItem>
            ))}
          </MenuSubPopup>
        </MenuSub>
        {display.status === "done" ? null : (
          <MenuItem
            onClick={() => {
              void settleThread(ref);
              close();
            }}
          >
            <CheckIcon />
            {uiText("Done")}
          </MenuItem>
        )}
        {display.parked ? (
          <MenuItem
            onClick={() => {
              void unsettleThread(ref);
              void unsnoozeThread(ref);
              close();
            }}
          >
            <CircleDotIcon />
            {uiText("Move to Focus")}
          </MenuItem>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
