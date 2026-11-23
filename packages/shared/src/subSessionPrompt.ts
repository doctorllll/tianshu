/**
 * The message the New sub-session form sends: it asks the thread's own agent to start the
 * sub-session with delegate_task, so the child is a real sub-session of the thread and its
 * completion wakes the thread. The user chose everything in it, so the server starts a
 * matching delegate_task without asking the user again.
 */
export interface SubSessionOptionSelection {
  readonly id: string;
  readonly value: string | boolean;
}

export interface SubSessionRequest {
  readonly instanceId: string;
  readonly model: string | null;
  readonly options?: ReadonlyArray<SubSessionOptionSelection>;
  readonly title: string;
  readonly task: string;
}

const HEAD =
  "New sub-session: start it with delegate_task as below. Pass the task verbatim; do not do it yourself or rewrite it. Then end your turn; its completion wakes you with its reply.";

export function subSessionPrompt(request: SubSessionRequest): string {
  const target = {
    providerInstanceId: request.instanceId,
    ...(request.model ? { model: request.model } : {}),
    ...(request.options && request.options.length > 0 ? { options: request.options } : {}),
  };
  const title = request.title.trim();
  return [
    HEAD,
    `- target: ${JSON.stringify(target)}`,
    ...(title ? [`- title: ${title}`] : []),
    // A blank line ends the list, so the task does not render as part of its last item.
    "",
    "<task>",
    request.task.trim(),
    "</task>",
  ].join("\n");
}

export interface ParsedSubSessionPrompt {
  readonly providerInstanceId: string | null;
  readonly task: string;
}

export function parseSubSessionPrompt(text: string): ParsedSubSessionPrompt | undefined {
  if (!text.includes(HEAD)) return undefined;
  const task = /<task>\n([\s\S]*?)\n<\/task>/.exec(text)?.[1]?.trim();
  if (!task) return undefined;
  let providerInstanceId: string | null = null;
  const target = /^- target: (\{.*\})$/m.exec(text)?.[1];
  if (target !== undefined) {
    try {
      const parsed: unknown = JSON.parse(target);
      if (typeof parsed === "object" && parsed !== null && "providerInstanceId" in parsed) {
        const id = parsed.providerInstanceId;
        if (typeof id === "string") providerInstanceId = id;
      }
    } catch {
      return undefined;
    }
  }
  return { providerInstanceId, task };
}

/** Whether `text` is the form's message for this delegate_task call: the same task and agent. */
export function subSessionPromptApproves(
  text: string,
  request: { readonly providerInstanceId: string | undefined; readonly task: string },
): boolean {
  const parsed = parseSubSessionPrompt(text);
  if (parsed === undefined || parsed.task !== request.task.trim()) return false;
  return (
    parsed.providerInstanceId === null || parsed.providerInstanceId === request.providerInstanceId
  );
}
