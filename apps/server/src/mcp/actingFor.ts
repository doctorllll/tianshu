/**
 * `T3-Acting-For` names the T3 thread whose agent runs a local `t3` command, so the command acts as
 * that agent. Kept apart from `ActingThreads.ts` so the CLI can send it without loading the server.
 */
export const ACTING_FOR_HEADER = "t3-acting-for";

export type ActingFor =
  | { readonly kind: "thread"; readonly threadId: string }
  | { readonly kind: "fastctx"; readonly resident: string; readonly machine: string };

/** T3 sets `T3CODE_THREAD_ID` in its agents' shells; fastctx sets `FASTCTX_RESIDENT` in its own. */
export const actingForFromEnvironment = (
  env: Readonly<Record<string, string | undefined>>,
): string | undefined => {
  const threadId = env.T3CODE_THREAD_ID?.trim();
  if (threadId) return `thread=${encodeURIComponent(threadId)}`;
  const resident = env.FASTCTX_RESIDENT?.trim();
  if (resident && resident.lastIndexOf("@") > 0) return `fastctx=${encodeURIComponent(resident)}`;
  return undefined;
};

export const parseActingFor = (header: string): ActingFor | undefined => {
  const separator = header.indexOf("=");
  if (separator <= 0) return undefined;
  let value: string;
  try {
    value = decodeURIComponent(header.slice(separator + 1).trim());
  } catch {
    return undefined;
  }
  if (value.length === 0) return undefined;
  switch (header.slice(0, separator).trim()) {
    case "thread":
      return { kind: "thread", threadId: value };
    case "fastctx": {
      const at = value.lastIndexOf("@");
      return at > 0 && at < value.length - 1
        ? { kind: "fastctx", resident: value.slice(0, at), machine: value.slice(at + 1) }
        : undefined;
    }
    default:
      return undefined;
  }
};
