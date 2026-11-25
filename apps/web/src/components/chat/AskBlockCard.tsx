import { CheckIcon, MessageCircleQuestionIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useUiText } from "~/i18n/useUiText";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { answeredOptionIndex, askReplyText, type AskBlock } from "./askBlock";
import { OptionRadio } from "./OptionRadio";

const OWN_ANSWER = -1;

interface AskBlockCardProps {
  readonly block: AskBlock;
  /** How many `ask` blocks the message holds; with more than one, a reply names its question. */
  readonly askCount: number;
  /** Your next message after this one, once you sent one: the question is settled. */
  readonly reply: string | null;
  /** Sends the answer as your message; absent where the thread can't be answered from here. */
  readonly onAnswer: ((text: string) => Promise<void>) | undefined;
}

/** An agent's `ask` block as a choice: pick an option or write your own, then reply. */
export function AskBlockCard({ block, askCount, reply, onAnswer }: AskBlockCardProps) {
  const uiText = useUiText();
  const ownAnswerRef = useRef<HTMLTextAreaElement>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [ownAnswer, setOwnAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answered = reply ?? sent;
  const answeredIndex = answered === null ? -1 : answeredOptionIndex(block, answered);
  const answerable = onAnswer !== undefined && answered === null;
  const answer =
    choice === OWN_ANSWER
      ? ownAnswer.trim()
      : choice === null
        ? ""
        : (block.options[choice]?.text ?? "");
  const canSend = answerable && !sending && answer.length > 0;

  const send = () => {
    if (!canSend || onAnswer === undefined) return;
    const text = askReplyText(block, answer, askCount);
    setSending(true);
    setError(null);
    void onAnswer(text).then(
      () => {
        setSent(text);
        setSending(false);
      },
      (cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        setSending(false);
      },
    );
  };

  return (
    <div
      data-ask-card={answered === null ? "open" : "answered"}
      className="my-3 rounded-xl border border-border bg-card/50 px-3.5 py-3"
    >
      <div className="flex items-start gap-2">
        <MessageCircleQuestionIcon
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{block.question}</div>
          {block.details.map((line, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- detail lines have no other identity
            <div key={index} className="mt-0.5 text-xs text-secondary-label">
              {line}
            </div>
          ))}
        </div>
        {answered !== null ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <CheckIcon aria-hidden className="size-3.5" />
            {uiText("Answered")}
          </span>
        ) : null}
      </div>
      <div role="radiogroup" aria-label={block.question} className="-ms-1.5 mt-2">
        {block.options.map((option, index) => {
          const checked = answered === null ? choice === index : index === answeredIndex;
          return (
            <button
              // oxlint-disable-next-line react/no-array-index-key -- options can repeat their text
              key={index}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={!answerable || sending}
              onClick={() => setChoice(index)}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-md py-1.5 ps-1.5 pe-2 text-start outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/25",
                checked ? "text-foreground" : "text-foreground/75",
                answerable && !sending ? "cursor-pointer hover:bg-muted/40" : "cursor-default",
                answered !== null && !checked && "opacity-55",
              )}
            >
              <span className="flex h-5 shrink-0 items-center">
                <OptionRadio checked={checked} />
              </span>
              <span className="min-w-0 flex-1 text-sm">{option.text}</span>
              {option.recommended ? (
                <Badge variant="info" size="sm" className="mt-0.5 shrink-0">
                  {uiText("Recommended")}
                </Badge>
              ) : null}
            </button>
          );
        })}
        {answerable ? (
          <div className="flex items-start gap-2.5 py-1.5 ps-1.5 pe-2">
            <button
              type="button"
              role="radio"
              aria-checked={choice === OWN_ANSWER}
              aria-label={uiText("Other answer")}
              disabled={sending}
              onClick={() => {
                setChoice(OWN_ANSWER);
                ownAnswerRef.current?.focus();
              }}
              className="flex h-8 shrink-0 cursor-pointer items-center rounded-full outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/25"
            >
              <OptionRadio checked={choice === OWN_ANSWER} />
            </button>
            <Textarea
              ref={ownAnswerRef}
              size="sm"
              rows={1}
              value={ownAnswer}
              disabled={sending}
              aria-label={uiText("Other answer")}
              placeholder={uiText("Write your own answer…")}
              onFocus={() => setChoice(OWN_ANSWER)}
              onChange={(event) => {
                setOwnAnswer(event.target.value);
                setChoice(OWN_ANSWER);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing)
                  return;
                event.preventDefault();
                send();
              }}
            />
          </div>
        ) : null}
      </div>
      {answered !== null && answeredIndex === -1 ? (
        <div className="mt-1.5 text-xs text-secondary-label whitespace-pre-wrap">
          {uiText("Your reply: {reply}", { reply: answered })}
        </div>
      ) : null}
      {answerable ? (
        <div className="mt-2 flex items-center justify-end gap-3">
          {error ? (
            <span className="min-w-0 flex-1 text-xs text-destructive">
              {uiText("Could not send the reply: {reason}", { reason: error })}
            </span>
          ) : null}
          <Button size="sm" disabled={!canSend} onClick={send}>
            {sending ? uiText("Sending…") : uiText("Reply")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
