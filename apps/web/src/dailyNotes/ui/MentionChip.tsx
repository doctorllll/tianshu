/** Placeholder; the thread mention chip lands with the mention support. */
export function TodayMention(props: { mention: { kind: string; id: string }; selected?: boolean }) {
  return (
    <span data-today-mention="" data-selected={props.selected ? "" : undefined}>
      {props.mention.id}
    </span>
  );
}
