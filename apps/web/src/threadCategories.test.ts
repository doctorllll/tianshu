import { DEFAULT_SIDEBAR_CATEGORY_SETTINGS } from "@t3tools/contracts/settings";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  UNSORTED_CATEGORY_ID,
  addCategoryProposals,
  categoryDefinitions,
  categoryScheme,
  categorySuggestionRequest,
  classifyThread,
  parseAutoAssignments,
  parseCategoryOverrides,
  parseCategoryProposals,
  resolveThreadCategory,
  settleCategoryProposal,
  threadsToAutoFile,
  withAddedCategory,
  type ThreadCategory,
} from "./threadCategories";

const settings = DEFAULT_SIDEBAR_CATEGORY_SETTINGS;
describe("classifyThread", () => {
  it("matches both title languages and keeps unmatched titles unsorted", () => {
    expect(classifyThread({ title: "修复数据库接口" }, settings)).toBe("development");
    expect(classifyThread({ title: "Outline a blog article" }, settings)).toBe("content");
    expect(classifyThread({ title: "Rapid response" }, settings)).toBe(UNSORTED_CATEGORY_ID);
    expect(classifyThread({ title: "<image code>" }, settings)).toBe(UNSORTED_CATEGORY_ID);
  });

  it("applies the migrated rule order, IDs, and project fallback", () => {
    const migrated = {
      ...settings,
      editedCategories: {
        general: [
          { id: "local-content", label: "Local content", keywords: [] },
          { id: "local-work", label: "Local work", keywords: [] },
        ],
      },
      legacyRules: {
        title: [
          { categoryId: "local-content", source: "news", flags: "i" },
          { categoryId: "local-work", source: "work", flags: "" },
        ],
        project: [{ categoryId: "local-work", source: "local", flags: "" }],
      },
    };
    expect(classifyThread({ title: "work NEWS", projectName: "local" }, migrated)).toBe(
      "local-content",
    );
    expect(classifyThread({ title: "Hello", projectName: "local" }, migrated)).toBe("local-work");
    expect(
      classifyThread({ title: "work", projectName: "local" }, { ...migrated, automatic: false }),
    ).toBe(UNSORTED_CATEGORY_ID);
  });
});

describe("category overrides", () => {
  it("preserves category IDs without hardcoding a catalog", () => {
    expect(parseCategoryOverrides(null)).toEqual({});
    expect(parseCategoryOverrides("{")).toEqual({});
    expect(parseCategoryOverrides("[]")).toEqual({});
    expect(parseCategoryOverrides('{"a":"old-category","b":"","c":3}')).toEqual({
      a: "old-category",
    });
  });

  it("keeps a manual choice across preset changes", () => {
    const input = { title: "写一篇文章" };
    expect(resolveThreadCategory({}, "k", input, settings)).toBe("content");
    expect(
      resolveThreadCategory({ k: "work" }, "k", input, { ...settings, preset: "creator" }),
    ).toBe("work");
    expect(categoryDefinitions({ ...settings, preset: "project" })).toEqual([]);
  });
});

const categories: ThreadCategory[] = [
  { id: "media", label: "Media", description: "Films and the library server", keywords: [] },
  { id: "devices", label: "Devices", keywords: ["phone"] },
];
const filing = { ...settings, editedCategories: { general: categories } };

describe("filing by the model", () => {
  it("comes after a manual choice and keywords, and only while it is switched on", () => {
    const scheme = categoryScheme(categories);
    const auto = {
      k: { category: "media", scheme, title: "Commit the changes" },
      gone: { category: "removed", scheme, title: "x" },
    };
    const resolve = (key: string, title: string, overrides = {}, current = filing) =>
      resolveThreadCategory(overrides, key, { title }, current, categoryDefinitions(current), auto);
    expect(resolve("k", "Commit the changes")).toBe("media");
    expect(resolve("k", "Root the phone")).toBe("devices");
    expect(resolve("k", "Commit the changes", { k: "devices" })).toBe("devices");
    expect(resolve("gone", "x")).toBe(UNSORTED_CATEGORY_ID);
    // With no keyword in the title, the folder name decides before the model does.
    expect(
      resolveThreadCategory(
        {},
        "k",
        { title: "Commit the changes", projectName: "phone-tools" },
        filing,
        categoryDefinitions(filing),
        auto,
      ),
    ).toBe("devices");
    expect(classifyThread({ title: "Root the phone", projectName: "phones" }, filing)).toBe(
      "devices",
    );
    expect(resolve("k", "Commit the changes", {}, { ...filing, suggestions: false })).toBe(
      UNSORTED_CATEGORY_ID,
    );
  });

  it("asks again only when the categories, the title or the chosen category changed", () => {
    const scheme = categoryScheme(categories);
    const auto = parseAutoAssignments(
      JSON.stringify({
        fresh: { category: null, scheme, title: "Old title" },
        renamed: { category: null, scheme, title: "Old title" },
        stale: { category: null, scheme: "older", title: "Same" },
        filed: { category: "media", scheme, title: "Same" },
        orphan: { category: "removed", scheme, title: "Same" },
        broken: { category: 3, scheme, title: "Same" },
      }),
    );
    expect(Object.keys(auto)).not.toContain("broken");
    const pending = threadsToAutoFile(
      [
        { key: "new", title: "Never seen" },
        { key: "fresh", title: "Old title" },
        { key: "renamed", title: "New title" },
        { key: "stale", title: "Same" },
        { key: "filed", title: "Same" },
        { key: "orphan", title: "Same" },
        { key: "image", title: "<image attachment>" },
      ],
      auto,
      categories,
    );
    expect(pending.map((candidate) => candidate.key)).toEqual([
      "new",
      "renamed",
      "stale",
      "orphan",
    ]);
    expect(categoryScheme([...categories, { id: "x", label: "X", keywords: [] }])).not.toBe(scheme);
  });

  it("sends each title with its folder and agent, and each category with its line", () => {
    const request = categorySuggestionRequest({
      candidates: Array.from({ length: 35 }, (_, index) => ({
        key: `k${index}`,
        title: `Title ${index}`,
        ...(index === 0 ? { project: "library", agent: "zcode" } : {}),
      })),
      categories: [...categories, { id: UNSORTED_CATEGORY_ID, label: "Unsorted", keywords: [] }],
      modelSelection: null,
      language: "zh",
      proposeNew: true,
    });
    expect(request.candidates).toHaveLength(30);
    expect(request.categories.map((category) => category.id)).toEqual(["media", "devices"]);
    expect(request.input.contexts?.slice(0, 2)).toEqual([
      { project: "library", agent: "zcode" },
      {},
    ]);
    expect(request.input.descriptions).toEqual(["Films and the library server", ""]);
    expect(request.input.proposeNew).toBe(true);
  });
});

describe("suggested new categories", () => {
  it("merges a repeat, skips existing and turned-down names, and adds the accepted one", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    });
    const read = () =>
      parseCategoryProposals(storage.get("t3code:sidebar-category-proposals:v1") ?? null);
    try {
      const debate = { label: "Debate", description: "Speeches", keywords: [], threadKeys: ["a"] };
      addCategoryProposals(
        [
          debate,
          { ...debate, label: "media ", threadKeys: ["b"] },
          { ...debate, threadKeys: ["c"] },
        ],
        categories,
      );
      expect(read().pending).toEqual([{ ...debate, threadKeys: ["a", "c"] }]);
      settleCategoryProposal("Debate", true);
      addCategoryProposals([debate], categories);
      expect(read()).toEqual({ pending: [], dismissed: ["debate"] });
    } finally {
      vi.unstubAllGlobals();
    }

    const added = withAddedCategory(
      {
        ...settings,
        editedCategories: {
          general: [{ id: "media", label: "Media", group: "Home", keywords: [] }],
        },
      },
      { id: "debate", label: "Debate", description: "Speeches", keywords: ["speech"] },
    );
    expect(categoryDefinitions(added).map((category) => [category.id, category.group])).toEqual([
      ["media", "Home"],
      ["debate", "Home"],
      [UNSORTED_CATEGORY_ID, undefined],
    ]);
  });
});
