import * as Schema from "effect/Schema";
import { ModelSelection } from "./modelSelection.ts";

const Title = Schema.String.check(Schema.isMaxLength(500));
const Category = Schema.String.check(Schema.isMaxLength(120));
/** Where a title lives, so a terse title such as "Commit the changes" still finds its category. */
export const SidebarCategorySuggestionContext = Schema.Struct({
  project: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(120))),
  agent: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(60))),
});
export const SidebarCategorySuggestionInput = Schema.Struct({
  titles: Schema.Array(Title).check(Schema.isMinLength(1), Schema.isMaxLength(30)),
  categories: Schema.Array(Category).check(Schema.isMinLength(1), Schema.isMaxLength(40)),
  modelSelection: Schema.NullOr(ModelSelection),
  language: Schema.Literals(["en", "zh"]),
  /** By title index. */
  contexts: Schema.optionalKey(
    Schema.Array(SidebarCategorySuggestionContext).check(Schema.isMaxLength(30)),
  ),
  /** What belongs in each category, by category index. */
  descriptions: Schema.optionalKey(
    Schema.Array(Schema.String.check(Schema.isMaxLength(240))).check(Schema.isMaxLength(40)),
  ),
  /** Also propose new categories for titles that fit none. */
  proposeNew: Schema.optionalKey(Schema.Boolean),
});
export type SidebarCategorySuggestionInput = typeof SidebarCategorySuggestionInput.Type;

export const SidebarCategorySuggestionRow = Schema.Struct({
  titleIndex: Schema.Int,
  categoryIndex: Schema.Int,
  reason: Schema.String.check(Schema.isMaxLength(240)),
});
/** A category the titles that fit none have in common, with the titles it would hold. */
export const SidebarCategoryProposal = Schema.Struct({
  label: Schema.String.check(Schema.isMaxLength(40)),
  description: Schema.String.check(Schema.isMaxLength(240)),
  keywords: Schema.Array(Schema.String.check(Schema.isMaxLength(40))).check(Schema.isMaxLength(8)),
  titleIndexes: Schema.Array(Schema.Int).check(Schema.isMinLength(2), Schema.isMaxLength(30)),
});
export type SidebarCategoryProposal = typeof SidebarCategoryProposal.Type;
export const SidebarCategorySuggestionOutput = Schema.Struct({
  model: Schema.String,
  suggestions: Schema.Array(SidebarCategorySuggestionRow),
  proposals: Schema.optionalKey(Schema.Array(SidebarCategoryProposal).check(Schema.isMaxLength(3))),
});
export class SidebarCategorySuggestionError extends Schema.TaggedError<SidebarCategorySuggestionError>()(
  "SidebarCategorySuggestionError",
  { reason: Schema.Literals(["noModel", "noPrice", "generationFailed"]) },
) {}
