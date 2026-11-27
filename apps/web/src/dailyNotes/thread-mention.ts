/**
 * A note mentions a Tianshu thread by one marked character in the node text
 * (`{ kind: "session", id }`). The id packs the environment and thread ids so
 * the mention survives the thread moving between projects.
 */
export const THREAD_MENTION_KIND = "session";

export type ThreadMentionRef = { environmentId: string; threadId: string };

export function encodeThreadMentionId(ref: ThreadMentionRef): string {
  return `${encodeURIComponent(ref.environmentId)}/${encodeURIComponent(ref.threadId)}`;
}

export function decodeThreadMentionId(id: string): ThreadMentionRef | null {
  const parts = id.split("/");
  if (parts.length !== 2) return null;
  try {
    const environmentId = decodeURIComponent(parts[0]!);
    const threadId = decodeURIComponent(parts[1]!);
    return environmentId && threadId ? { environmentId, threadId } : null;
  } catch {
    return null;
  }
}

const THREAD_LINK_PATTERN = /^tianshu:\/\/thread\/([^/\s?#]+)\/([^/\s?#]+)$/u;

/** `tianshu://thread/<environmentId>/<threadId>`: the plain-text form of a thread mention. */
export function buildThreadLink(ref: ThreadMentionRef): string {
  return `tianshu://thread/${encodeURIComponent(ref.environmentId)}/${encodeURIComponent(ref.threadId)}`;
}

/** The mention id a pasted thread link points at, or null for any other text. */
export function readPastedThreadMentionId(raw: string): string | null {
  const match = THREAD_LINK_PATTERN.exec(raw.trim());
  if (!match) return null;
  try {
    return encodeThreadMentionId({
      environmentId: decodeURIComponent(match[1]!),
      threadId: decodeURIComponent(match[2]!),
    });
  } catch {
    return null;
  }
}
