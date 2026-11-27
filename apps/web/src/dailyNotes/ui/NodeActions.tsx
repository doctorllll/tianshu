/**
 * Adapted from LodyAI/Lody (Apache License 2.0): packages/components/src/components/today/today-view.tsx
 * (TodayNodeMenu, TodayNodeActions). Modified for Tianshu (Base UI menu).
 */
import {
  CopyIcon,
  Maximize2Icon,
  MessageSquarePlusIcon,
  SquareCheckIcon,
  SquareIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";

import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuShortcut } from "~/components/ui/menu";
import { useUiText } from "~/i18n/useUiText";

import { buildConvertPrompt } from "../editor/block-selection";
import { useTodayEditor } from "../editor/today-editor-context";
import type { TodayEditorController } from "../editor/today-editor-controller";
import {
  readTodayText,
  TODAY_MENTION_CHAR,
  type TodayNodeId,
  type TodayRichText,
} from "../model/outline";
import type { TodayPageStore } from "../store/page-store";
import { TodaySelectionBar } from "./SelectionBar";
import { altShortcut, modShortcut } from "./shortcutLabels";
import { TodayConvertDialog } from "./ConvertDialog";

export type TodayConvertDialogComponent = ComponentType<{
  open: boolean;
  prompt: string;
  promptWithAncestors?: string | null;
  /** The new thread's mention id (`encodeThreadMentionId`). */
  onAccepted: (mentionId: string) => void;
  onOpenChange: (open: boolean) => void;
}>;

function TodayNodeMenu(props: {
  store: TodayPageStore;
  nodeId: TodayNodeId;
  anchor: HTMLElement | { x: number; y: number };
  controller: TodayEditorController;
  onConvert: () => void;
  onClose: (keepSelection: boolean) => void;
}) {
  const uiText = useUiText();
  const { store, nodeId, controller, anchor } = props;
  const node = store.outline.getNode(nodeId);
  const positioned =
    "getBoundingClientRect" in anchor
      ? anchor
      : { getBoundingClientRect: () => new DOMRect(anchor.x, anchor.y, 0, 0) };
  if (!node) return null;
  const canConvert = node.text.replaceAll(TODAY_MENTION_CHAR, "").trim().length > 0;
  const todo =
    node.todo === undefined
      ? { icon: <SquareIcon />, label: uiText("Turn into to-do") }
      : node.todo === "todo"
        ? { icon: <SquareCheckIcon />, label: uiText("Mark as done") }
        : { icon: <TypeIcon />, label: uiText("Back to plain text") };
  return (
    <Menu open onOpenChange={(open) => !open && props.onClose(false)}>
      <MenuPopup anchor={positioned} side="bottom" align="start">
        <MenuItem
          onClick={() => {
            props.onClose(false);
            controller.onZoom?.(store, nodeId);
          }}
        >
          <Maximize2Icon />
          {uiText("Zoom in")}
          <MenuShortcut>{altShortcut("→")}</MenuShortcut>
        </MenuItem>
        <MenuItem
          onClick={() => {
            store.undo.structural(() => store.outline.cycleTodo([nodeId]));
            props.onClose(false);
          }}
        >
          {todo.icon}
          {todo.label}
          <MenuShortcut>{modShortcut("↵")}</MenuShortcut>
        </MenuItem>
        <MenuItem
          disabled={!canConvert}
          onClick={() => {
            props.onClose(true);
            props.onConvert();
          }}
        >
          <MessageSquarePlusIcon />
          {uiText("Convert to task")}
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          onClick={() => {
            controller.copySelection();
            props.onClose(false);
          }}
        >
          <CopyIcon />
          {uiText("Copy")}
          <MenuShortcut>{modShortcut("C")}</MenuShortcut>
        </MenuItem>
        <MenuItem
          variant="destructive"
          onClick={() => {
            controller.deleteSelection();
            props.onClose(true);
          }}
        >
          <Trash2Icon />
          {uiText("Delete")}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

/**
 * The selection bar and "Convert to task". Only an accepted thread changes the node: unchanged
 * since the dialog opened, the line becomes the mention (children stay, folded); edited
 * meanwhile, the mention is prefixed; a node deleted meanwhile gets a mention node appended.
 */
export function TodayNodeActions(props: {
  /** Also open the new thread beside the notes (the pinned column). */
  openAfterConvert: boolean;
  ConvertDialog?: TodayConvertDialogComponent;
}) {
  const controller = useTodayEditor();
  const ConvertDialog = props.ConvertDialog ?? TodayConvertDialog;
  const [converting, setConverting] = useState<{
    store: TodayPageStore;
    nodeId: TodayNodeId;
    prompt: string;
    promptWithAncestors: string | null;
    /** The node's text when the dialog opened: unchanged, the line becomes the mention. */
    snapshot: TodayRichText;
  } | null>(null);
  const [nodeMenu, setNodeMenu] = useState<{
    store: TodayPageStore;
    nodeId: TodayNodeId;
    anchor: HTMLElement | { x: number; y: number };
  } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the effect adopts state owned outside React (store, controller or DOM) into a React mirror
  useEffect(() => {
    if (!controller) return undefined;
    controller.setHooks({
      onNodeMenu: (store, nodeId, anchor) => {
        controller.selectBlocks(store, [nodeId]);
        setNodeMenu({ store, nodeId, anchor });
      },
    });
    return () => controller.setHooks({ onNodeMenu: null });
  }, [controller]);
  const convert = (store: TodayPageStore, nodeId: TodayNodeId) => {
    const [fragment] = store.outline.extract([nodeId]);
    const text = store.outline.getText(nodeId);
    if (!fragment || !text || !controller) return;
    const ancestors: TodayRichText[] = [];
    for (
      let parent = store.outline.getNode(nodeId)?.parentId ?? null;
      parent;
      parent = store.outline.getNode(parent)?.parentId ?? null
    ) {
      const node = store.outline.getNode(parent);
      if (!node) break;
      ancestors.unshift({ text: node.text, mentions: [...node.mentions] });
    }
    setConverting({
      store,
      nodeId,
      prompt: buildConvertPrompt(fragment, controller.mentionText),
      promptWithAncestors:
        ancestors.length > 0
          ? buildConvertPrompt(fragment, controller.mentionText, ancestors)
          : null,
      snapshot: readTodayText(text),
    });
  };
  return (
    <>
      {converting || nodeMenu ? null : <TodaySelectionBar onConvert={convert} />}
      {nodeMenu && controller ? (
        <TodayNodeMenu
          {...nodeMenu}
          controller={controller}
          onConvert={() => convert(nodeMenu.store, nodeMenu.nodeId)}
          onClose={(keepSelection) => {
            setNodeMenu(null);
            if (!keepSelection) controller.clearBlockSelection();
          }}
        />
      ) : null}
      <ConvertDialog
        open={converting !== null}
        prompt={converting?.prompt ?? ""}
        promptWithAncestors={converting?.promptWithAncestors ?? null}
        onOpenChange={(open) => {
          if (!open) {
            setConverting(null);
            controller?.clearBlockSelection();
          }
        }}
        onAccepted={(mentionId) => {
          const target = converting;
          if (!target) return;
          const { store, nodeId, snapshot } = target;
          const mention = { kind: "session", id: mentionId };
          const converted = store.undo.structural(() =>
            store.outline.convertToMention(nodeId, mention, snapshot),
          );
          if (!converted) {
            store.undo.structural(() =>
              store.outline.insertMentionNode(
                { parentId: null, index: Number.MAX_SAFE_INTEGER },
                mention,
              ),
            );
          }
          if (props.openAfterConvert) controller?.onOpenSession?.(mentionId);
        }}
      />
    </>
  );
}
