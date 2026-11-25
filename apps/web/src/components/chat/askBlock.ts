/**
 * A question an agent asks in a fenced `ask` block: the question on its first line, then one
 * option per line, `*` before the one it suggests and `-` before the others.
 */
export interface AskBlock {
  readonly question: string;
  /** Lines between the question and the first option. */
  readonly details: ReadonlyArray<string>;
  readonly options: ReadonlyArray<AskOption>;
}

export interface AskOption {
  readonly text: string;
  readonly recommended: boolean;
}

const OPTION_LINE = /^\s*([*-])\s+(\S.*?)\s*$/;
const ASK_FENCE = /^ {0,3}(?:`{3,}|~{3,})ask[ \t]*$/gm;

export function parseAskBlock(code: string): AskBlock | null {
  let question: string | null = null;
  const details: string[] = [];
  const options: Array<{ text: string; recommended: boolean }> = [];
  for (const line of code.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const option = OPTION_LINE.exec(line);
    if (question === null) {
      if (option) return null;
      question = line.trim();
    } else if (option) {
      options.push({ text: option[2]!, recommended: option[1] === "*" });
    } else if (options.length === 0) {
      details.push(line.trim());
    } else {
      // A wrapped option continues on the next line.
      const last = options.at(-1)!;
      last.text = `${last.text} ${line.trim()}`;
    }
  }
  return question === null ? null : { question, details, options };
}

export function hasAskFence(markdown: string): boolean {
  return countAskFences(markdown) > 0;
}

export function countAskFences(markdown: string): number {
  return markdown.match(ASK_FENCE)?.length ?? 0;
}

/** The reply a choice sends: the answer alone, or under its question when the message asks several. */
export function askReplyText(block: AskBlock, answer: string, askCount: number): string {
  const trimmed = answer.trim();
  return askCount > 1 ? `${block.question}\n${trimmed}` : trimmed;
}

/** Which option a reply chose, or -1 when it chose none of them. */
export function answeredOptionIndex(block: AskBlock, reply: string): number {
  const whole = normalize(reply);
  const lastLine = normalize(reply.trim().split(/\r?\n/).at(-1) ?? "");
  return block.options.findIndex((option) => {
    const text = normalize(option.text);
    return text === whole || text === lastLine;
  });
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}
