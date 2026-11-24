import type { ModelSelection, SidebarCategorySuggestionInput } from "@t3tools/contracts";
import type { SidebarCategoryPreset, SidebarCategorySettings } from "@t3tools/contracts/settings";
import { uiText } from "./i18n";
import { useSyncExternalStore } from "react";

/**
 * Sidebar categories: a display-only relation layered over projects. Threads keep their
 * project, workspace and id; a category only decides which sidebar row lists them.
 */
export interface ThreadCategory {
  readonly id: string;
  readonly label: string;
  readonly group?: string;
  /** One line on what belongs here, for the model that files threads. */
  readonly description?: string;
  readonly keywords: readonly string[];
}
export type ThreadCategoryGroup = string;
export type EditableCategoryPreset = Exclude<SidebarCategoryPreset, "project">;
export const UNSORTED_CATEGORY_ID = "unsorted";
export const SIDEBAR_CATEGORY_PRESETS = {
  general: { label: "General preset", description: "A bit of everything" },
  developer: { label: "Developer", description: "Mostly code" },
  creator: { label: "Creator", description: "Writing, video, and publishing" },
  lawyer: { label: "Coding lawyer", description: "Cases, legal research, and the tools you build" },
  project: { label: "By project", description: "Organize by folder" },
} as const satisfies Record<SidebarCategoryPreset, { label: string; description: string }>;

function category(id: string, label: string, keywords: string): ThreadCategory {
  return { id, label, keywords: keywords.split("|") };
}
function grouped(group: string, entries: readonly (readonly [string, string, string, string])[]) {
  return entries.map(([id, label, description, keywords]) => ({
    ...category(id, label, keywords),
    group,
    description,
  }));
}
const PRESET_CATEGORIES: Record<SidebarCategoryPreset, readonly ThreadCategory[]> = {
  general: [
    category(
      "development",
      "Development",
      "代码|接口|开发|数据库|代码库|code|api|bug|refactor|database|test",
    ),
    category("content", "Writing & content", "文章|博客|文案|写作|article|blog|copywriting|readme"),
    category("research", "Research", "分析|对比|调研|研究|analyze|compare|research"),
    category("work", "Work admin", "周报|会议|邮件|报销|report|meeting|email|invoice"),
    category("systems", "Tools & system", "磁盘|模型|设置|系统|disk|model|settings|network"),
  ],
  developer: [
    category("fixes", "Bug fixes", "修复|报错|故障|bug|fix|error|debug"),
    category("features", "Features", "功能|接口|新增|feature|api|implement"),
    category("review", "Code review", "评审|审查|review"),
    category("docs", "Docs", "文档|说明|docs|readme"),
    category("deploy", "Deploy & ops", "部署|运维|监控|deploy|ops|infra"),
  ],
  creator: [
    category("scripts", "Ideas & scripts", "选题|脚本|分镜|idea|script|storyboard"),
    category("writing", "Writing", "文章|文案|博客|article|writing|blog"),
    category("media", "Video & audio", "视频|动画|音频|video|audio|animation"),
    category("publishing", "Publishing", "发布|运营|推广|publish|campaign|marketing"),
  ],
  lawyer: [
    ...grouped("Legal work", [
      [
        "cases",
        "Cases",
        "Litigation and arbitration: filing, hearings, evidence and enforcement",
        "案件|诉讼|仲裁|庭审|开庭|证据|强制执行|上诉|立案|保全|litigation|arbitration|hearing|evidence",
      ],
      [
        "legal-research",
        "Legal research",
        "Statutes, case law and judicial interpretations",
        "法条|法规|类案|案例检索|司法解释|判例|法律研究|检索报告|statute|precedent",
      ],
      [
        "drafting",
        "Drafting",
        "Complaints, briefs, contract review and legal opinions",
        "起诉状|答辩状|代理词|合同|法律意见书|律师函|文书|起草|brief|memorandum",
      ],
      [
        "practice",
        "Clients & practice",
        "Consultations, engagements, fees and scheduling",
        "咨询|委托|收费|律师费|会见|日程|当事人|所务|consultation|engagement|invoice",
      ],
    ]),
    ...grouped("Tools & tech", [
      [
        "automation",
        "Automation",
        "Scripts and small tools that take over repetitive work",
        "脚本|自动化|批处理|爬虫|小工具|script|automation|batch|scraper",
      ],
      [
        "ai-agents",
        "AI & agents",
        "Models, prompts, MCP and agent setup",
        "模型|提示词|智能体|agent|mcp|prompt|llm|claude|codex|gpt",
      ],
      [
        "ops",
        "Servers & ops",
        "Servers, networks, deployment and backups",
        "服务器|部署|运维|网络|备份|域名|server|deploy|backup|docker|nas|vps",
      ],
    ]),
    ...grouped("Other", [
      [
        "content",
        "Writing & content",
        "Articles, posts and other public writing",
        "文章|公众号|写作|博客|文案|演讲|article|blog|writing",
      ],
      [
        "life",
        "Life admin",
        "Family, travel, shopping and other errands",
        "生活|家庭|购物|旅行|出行|life|travel|shopping",
      ],
    ]),
  ],
  project: [],
};
const UNSORTED: ThreadCategory = { id: UNSORTED_CATEGORY_ID, label: "Unsorted", keywords: [] };

export function categoryDefinitions(settings: SidebarCategorySettings): readonly ThreadCategory[] {
  if (settings.preset === "project") return [];
  return [
    ...(settings.editedCategories[settings.preset] ?? PRESET_CATEGORIES[settings.preset]),
    UNSORTED,
  ];
}

/** Keep labels of individually filed threads when switching presets. */
export function visibleCategoryDefinitions(
  settings: SidebarCategorySettings,
  overrides: Readonly<Record<string, string>>,
): readonly ThreadCategory[] {
  const definitions = categoryDefinitions(settings);
  if (settings.preset === "project") return definitions;
  const included = new Set(definitions.map((entry) => entry.id));
  const assigned = new Set(Object.values(overrides));
  const extra = (["general", "developer", "creator", "lawyer"] as const).flatMap((preset) =>
    categoryDefinitions({ ...settings, preset }).filter((entry) => {
      if (!assigned.has(entry.id) || included.has(entry.id)) return false;
      included.add(entry.id);
      return true;
    }),
  );
  return [...definitions.slice(0, -1), ...extra, UNSORTED];
}
/** Whether a field still holds the built-in wording, which is translated; the user's own is not. */
function isBuiltInText(category: ThreadCategory, field: "label" | "group" | "description") {
  const value = category[field];
  return (
    value !== undefined &&
    Object.values(PRESET_CATEGORIES).some((entries) =>
      entries.some((entry) => entry.id === category.id && entry[field] === value),
    )
  );
}
export function categoryLabel(category: ThreadCategory, text = uiText) {
  if (category.id === UNSORTED_CATEGORY_ID) return text("Unsorted");
  return isBuiltInText(category, "label") ? text(category.label) : category.label;
}
/** A category as the user reads it: built-in name, group and description translated. */
export function localizedCategory(category: ThreadCategory, text = uiText): ThreadCategory {
  const group =
    category.group !== undefined && isBuiltInText(category, "group")
      ? text(category.group)
      : category.group;
  const description =
    category.description !== undefined && isBuiltInText(category, "description")
      ? text(category.description)
      : category.description;
  return {
    ...category,
    label: categoryLabel(category, text),
    ...(group !== undefined ? { group } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}
export function threadCategoryById(
  id: string,
  categories: readonly ThreadCategory[],
): ThreadCategory {
  return categories.find((category) => category.id === id) ?? UNSORTED;
}

type Rule = NonNullable<SidebarCategorySettings["legacyRules"]>["title"][number];
const compiledPatterns = new WeakMap<Rule, RegExp | null>();
export function matchLocalCategoryRule(rule: Rule, text: string): boolean {
  if (!compiledPatterns.has(rule)) {
    try {
      compiledPatterns.set(rule, new RegExp(rule.source, rule.flags.replace(/[gy]/g, "")));
    } catch {
      compiledPatterns.set(rule, null);
    }
  }
  return compiledPatterns.get(rule)?.test(text) ?? false;
}

function isUntitledThreadTitle(title: string) {
  const value = title.trim();
  return !value || /^(<image|\[external unsupported|Call your built-in)/.test(value);
}

export function classifyThread(
  input: {
    readonly title: string;
    /** The sidebar row's label, which can gather several projects; legacy rules match it. */
    readonly projectName?: string | null | undefined;
    /** The name of the project the thread runs in. */
    readonly folderName?: string | null | undefined;
  },
  settings: SidebarCategorySettings,
): string {
  if (!settings.automatic || settings.preset === "project" || isUntitledThreadTitle(input.title)) {
    return UNSORTED_CATEGORY_ID;
  }
  const categories = categoryDefinitions(settings);
  const legacy = settings.preset === "general" ? settings.legacyRules : undefined;
  const matched =
    legacy?.title.find((rule) => matchLocalCategoryRule(rule, input.title)) ??
    legacy?.project.find((rule) => matchLocalCategoryRule(rule, input.projectName ?? ""));
  if (matched && categories.some((entry) => entry.id === matched.categoryId))
    return matched.categoryId;
  // The title decides; a folder is usually named after what its threads work on.
  const category =
    categoryWithKeywordIn(categories, input.title) ??
    (input.folderName ? categoryWithKeywordIn(categories, input.folderName) : undefined);
  return category?.id ?? UNSORTED_CATEGORY_ID;
}

/** The first category with a keyword in the text: as a word for Latin keywords, else anywhere. */
function categoryWithKeywordIn(categories: readonly ThreadCategory[], text: string) {
  const value = text.normalize("NFKC").toLowerCase();
  const words = value.split(/[^a-z0-9]+/);
  return categories.find((entry) =>
    entry.keywords.some((keyword) => {
      const term = keyword.normalize("NFKC").toLowerCase().trim();
      if (!term) return false;
      return /^[a-z0-9]+$/.test(term) ? words.includes(term) : value.includes(term);
    }),
  );
}

/** A JSON value in local storage that components follow; a missing or broken value reads as `empty`. */
function localStore<T>(key: string, parse: (raw: string | null) => T, empty: T) {
  let cachedRaw: string | null | undefined;
  let cached = empty;
  const listeners = new Set<() => void>();
  const read = (): T => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      /* Storage unavailable: automatic categories still apply. */
    }
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cached = parse(raw);
    }
    return cached;
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    window.addEventListener("storage", listener);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", listener);
    };
  };
  const write = (value: T): boolean => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      return false;
    }
    listeners.forEach((listener) => listener());
    return true;
  };
  const use = () => useSyncExternalStore(subscribe, read, () => empty);
  return { read, write, use };
}

const parseJson = (raw: string | null): unknown => {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type Overrides = Readonly<Record<string, string>>;
const EMPTY: Overrides = {};

export function parseCategoryOverrides(raw: string | null): Overrides {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
      ),
    );
  } catch {
    return EMPTY;
  }
}
const overridesStore = localStore("t3code:thread-categories:v1", parseCategoryOverrides, EMPTY);
export function useThreadCategoryOverrides(): Overrides {
  return overridesStore.use();
}
/** A manual choice is final: automatic rules never move that thread again. */
export function setThreadCategories(changes: Readonly<Record<string, string | null>>): boolean {
  const next: Record<string, string> = { ...overridesStore.read() };
  for (const [key, categoryId] of Object.entries(changes)) {
    if (categoryId === null) delete next[key];
    else next[key] = categoryId;
  }
  return overridesStore.write(next);
}
export function setThreadCategory(threadKey: string, categoryId: string | null): boolean {
  return setThreadCategories({ [threadKey]: categoryId });
}

/**
 * What the model made of a thread no keyword matched: a category, or null for no fit. The
 * categories and title it saw tell whether a no-fit answer is still current.
 */
export interface AutoCategoryEntry {
  readonly category: string | null;
  readonly scheme: string;
  readonly title: string;
}
export type AutoCategoryAssignments = Readonly<Record<string, AutoCategoryEntry>>;
const EMPTY_AUTO: AutoCategoryAssignments = {};
const AUTO_ENTRY_LIMIT = 2000;
export function parseAutoAssignments(raw: string | null): AutoCategoryAssignments {
  const value = parseJson(raw);
  if (!isRecord(value)) return EMPTY_AUTO;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      isRecord(entry) &&
      (entry.category === null || (typeof entry.category === "string" && entry.category)) &&
      typeof entry.scheme === "string" &&
      typeof entry.title === "string"
        ? [[key, { category: entry.category, scheme: entry.scheme, title: entry.title }]]
        : [],
    ),
  );
}
const autoStore = localStore("t3code:thread-categories-auto:v1", parseAutoAssignments, EMPTY_AUTO);
export function useThreadCategoryAutoAssignments(): AutoCategoryAssignments {
  return autoStore.use();
}
/** Newest answers last; the oldest go once there are more than the limit. */
export function setAutoThreadCategories(changes: AutoCategoryAssignments): boolean {
  const next: Record<string, AutoCategoryEntry> = { ...autoStore.read() };
  for (const [key, entry] of Object.entries(changes)) {
    delete next[key];
    next[key] = entry;
  }
  const keys = Object.keys(next);
  for (const key of keys.slice(0, Math.max(0, keys.length - AUTO_ENTRY_LIMIT))) delete next[key];
  return autoStore.write(next);
}

/** Changes when a category is added, renamed or redescribed, so no-fit threads are tried again. */
export function categoryScheme(categories: readonly ThreadCategory[]): string {
  const text = JSON.stringify(
    categories
      .filter((category) => category.id !== UNSORTED_CATEGORY_ID)
      .map((category) => [category.id, category.label, category.description ?? ""]),
  );
  let hash = 5381;
  for (let index = 0; index < text.length; index++)
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  return (hash >>> 0).toString(36);
}

export interface AutoFileCandidate {
  readonly key: string;
  readonly title: string;
  readonly project?: string;
  readonly agent?: string;
}
/** Unsorted threads the model has not yet seen with these categories and this title. */
export function threadsToAutoFile(
  candidates: readonly AutoFileCandidate[],
  auto: AutoCategoryAssignments,
  categories: readonly ThreadCategory[],
): AutoFileCandidate[] {
  const scheme = categoryScheme(categories);
  const ids = new Set(categories.map((category) => category.id));
  return candidates.filter((candidate) => {
    if (isUntitledThreadTitle(candidate.title)) return false;
    const entry = auto[candidate.key];
    if (!entry) return true;
    if (entry.category) return !ids.has(entry.category);
    return entry.scheme !== scheme || entry.title !== candidate.title;
  });
}

/**
 * The model request for up to 30 threads, with the categories it may answer by index. Each
 * title goes with its folder and agent, and each category with the line on what belongs there.
 */
export function categorySuggestionRequest(input: {
  readonly candidates: readonly AutoFileCandidate[];
  readonly categories: readonly ThreadCategory[];
  readonly modelSelection: ModelSelection | null;
  readonly language: "en" | "zh";
  readonly proposeNew: boolean;
}): {
  readonly input: SidebarCategorySuggestionInput;
  readonly candidates: readonly AutoFileCandidate[];
  readonly categories: readonly ThreadCategory[];
} {
  const candidates = input.candidates.slice(0, 30);
  const categories = input.categories
    .filter((category) => category.id !== UNSORTED_CATEGORY_ID)
    .slice(0, 40);
  return {
    candidates,
    categories,
    input: {
      titles: candidates.map((candidate) => candidate.title.slice(0, 500)),
      categories: categories.map((category) => category.label.slice(0, 120)),
      modelSelection: input.modelSelection,
      language: input.language,
      contexts: candidates.map((candidate) => ({
        ...(candidate.project ? { project: candidate.project.slice(0, 120) } : {}),
        ...(candidate.agent ? { agent: candidate.agent.slice(0, 60) } : {}),
      })),
      descriptions: categories.map((category) => (category.description ?? "").slice(0, 240)),
      ...(input.proposeNew ? { proposeNew: true } : {}),
    },
  };
}

/** Manual choice first, then keywords, then what the model made of the thread. */
export function resolveThreadCategory(
  overrides: Overrides,
  threadKey: string,
  input: Parameters<typeof classifyThread>[0],
  settings: SidebarCategorySettings,
  categories = visibleCategoryDefinitions(settings, overrides),
  auto: AutoCategoryAssignments = EMPTY_AUTO,
): string {
  const manual = overrides[threadKey];
  if (manual && categories.some((category) => category.id === manual)) return manual;
  const filed = classifyThread(input, settings);
  if (filed !== UNSORTED_CATEGORY_ID || !settings.suggestions || settings.preset === "project")
    return filed;
  const chosen = auto[threadKey]?.category;
  return chosen && categories.some((category) => category.id === chosen)
    ? chosen
    : UNSORTED_CATEGORY_ID;
}

/** A category the model suggests for threads none fit, waiting for the user's answer. */
export interface PendingCategoryProposal {
  readonly label: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly threadKeys: readonly string[];
}
interface ProposalState {
  readonly pending: readonly PendingCategoryProposal[];
  /** Labels the user turned down, never suggested again. */
  readonly dismissed: readonly string[];
}
const EMPTY_PROPOSALS: ProposalState = { pending: [], dismissed: [] };
const MAX_PENDING_PROPOSALS = 3;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
export function parseCategoryProposals(raw: string | null): ProposalState {
  const value = parseJson(raw);
  if (!isRecord(value)) return EMPTY_PROPOSALS;
  return {
    pending: (Array.isArray(value.pending) ? value.pending : []).flatMap((entry) =>
      isRecord(entry) && typeof entry.label === "string" && entry.label
        ? [
            {
              label: entry.label,
              description: typeof entry.description === "string" ? entry.description : "",
              keywords: strings(entry.keywords),
              threadKeys: strings(entry.threadKeys),
            },
          ]
        : [],
    ),
    dismissed: strings(value.dismissed),
  };
}
const proposalStore = localStore(
  "t3code:sidebar-category-proposals:v1",
  parseCategoryProposals,
  EMPTY_PROPOSALS,
);
function sameCategoryLabel(label: string) {
  return label.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}
export function useCategoryProposals(): readonly PendingCategoryProposal[] {
  return proposalStore.use().pending;
}
/** Adds new suggestions, merging one with a waiting suggestion of the same name. */
export function addCategoryProposals(
  incoming: readonly PendingCategoryProposal[],
  categories: readonly ThreadCategory[],
): boolean {
  const state = proposalStore.read();
  const taken = new Set([
    ...state.dismissed,
    ...categories.map((category) => sameCategoryLabel(category.label)),
  ]);
  const pending = [...state.pending];
  for (const proposal of incoming) {
    const label = sameCategoryLabel(proposal.label);
    if (!label || taken.has(label)) continue;
    const index = pending.findIndex((entry) => sameCategoryLabel(entry.label) === label);
    if (index >= 0) {
      const current = pending[index]!;
      pending[index] = {
        ...current,
        threadKeys: [...new Set([...current.threadKeys, ...proposal.threadKeys])],
      };
    } else pending.push(proposal);
  }
  // The newest suggestions win; older ones have usually been overtaken by filing.
  return proposalStore.write({ ...state, pending: pending.slice(-MAX_PENDING_PROPOSALS) });
}
/** Removes a waiting suggestion; a turned-down one is never suggested again. */
export function settleCategoryProposal(label: string, dismissed: boolean): boolean {
  const state = proposalStore.read();
  const key = sameCategoryLabel(label);
  return proposalStore.write({
    pending: state.pending.filter((entry) => sameCategoryLabel(entry.label) !== key),
    dismissed: dismissed ? [...new Set([...state.dismissed, key])] : state.dismissed,
  });
}
/** The settings with one more category, under the group of the last one. */
export function withAddedCategory(
  settings: SidebarCategorySettings,
  category: Omit<ThreadCategory, "group">,
): SidebarCategorySettings {
  if (settings.preset === "project") return settings;
  const rows = categoryDefinitions(settings).filter((entry) => entry.id !== UNSORTED_CATEGORY_ID);
  const group = rows.at(-1)?.group;
  return {
    ...settings,
    editedCategories: {
      ...settings.editedCategories,
      [settings.preset]: [
        ...rows,
        {
          id: category.id,
          label: category.label,
          keywords: [...category.keywords],
          ...(category.description ? { description: category.description } : {}),
          ...(group ? { group } : {}),
        },
      ],
    },
  };
}

export const CATEGORY_PROJECT_KEY_PREFIX = "thread-category:";
export function isCategoryProjectKey(projectKey: string): boolean {
  return projectKey.startsWith(CATEGORY_PROJECT_KEY_PREFIX);
}

/** The category picker is opened from the thread context menu. */
let pickerTarget: { threadKey: string; title: string } | null = null;
const pickerListeners = new Set<() => void>();
export function openThreadCategoryPicker(target: { threadKey: string; title: string } | null) {
  pickerTarget = target;
  pickerListeners.forEach((listener) => listener());
}
export function useThreadCategoryPicker() {
  return useSyncExternalStore(
    (listener) => {
      pickerListeners.add(listener);
      return () => pickerListeners.delete(listener);
    },
    () => pickerTarget,
    () => null,
  );
}

/** A category picked on an empty draft follows it once to the chosen folder's own draft. */
let carriedDraftCategory: { readonly projectKey: string; readonly categoryId: string } | null =
  null;
export function carryDraftCategory(projectKey: string, categoryId: string) {
  carriedDraftCategory = { projectKey, categoryId };
}
export function takeCarriedDraftCategory(projectKey: string): string | null {
  if (carriedDraftCategory?.projectKey !== projectKey) return null;
  const { categoryId } = carriedDraftCategory;
  carriedDraftCategory = null;
  return categoryId;
}
