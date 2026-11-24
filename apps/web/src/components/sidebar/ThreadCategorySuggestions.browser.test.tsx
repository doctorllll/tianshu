import "~/index.css";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { __resetClientSettingsPersistenceForTests } from "~/hooks/useSettings";
import { ThreadCategorySuggestions } from "./ThreadCategorySuggestions";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("~/hooks/useSidebarSuggestionModels", () => ({
  useSidebarSuggestionModels: () => ({ environmentId: "fixture", models: [{}] }),
}));
vi.mock("~/state/server", async (importOriginal) => {
  const { Atom } = await import("effect/reactivity");
  const allowed = Atom.make(true);
  return {
    ...(await importOriginal<typeof import("~/state/server")>()),
    serverEnvironment: { suggestSidebarCategories: { permissionAtom: () => allowed } },
  };
});
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: () => mocks.run,
}));

const overridesKey = "t3code:thread-categories:v1";
const autoKey = "t3code:thread-categories-auto:v1";
const proposalsKey = "t3code:sidebar-category-proposals:v1";
const settingsKey = "t3code:client-settings:v1";
/** Puts back what local storage held before the test. */
function isolatedStorage() {
  const keys = [overridesKey, autoKey, proposalsKey, settingsKey];
  __resetClientSettingsPersistenceForTests();
  const previous = keys.map((key) => localStorage.getItem(key));
  keys.forEach((key) => localStorage.removeItem(key));
  return {
    [Symbol.dispose]() {
      keys.forEach((key, index) => {
        const value = previous[index];
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      });
      __resetClientSettingsPersistenceForTests();
    },
  };
}
/** The category the sidebar settings gained, once they are saved. */
const addedCategory = () =>
  vi.waitFor(() => {
    const saved = JSON.parse(localStorage.getItem(settingsKey) ?? "{}");
    const added = saved.sidebarCategories?.editedCategories?.general?.at(-1);
    expect(added).toBeDefined();
    return added;
  });
const categories = [
  { id: "work", label: "Work", description: "Office matters", keywords: [] },
  { id: "research", label: "Research", keywords: [] },
];

it("asks about every unsorted thread and moves only what the user checks", async () => {
  await page.viewport(1280, 800);
  using _storage = isolatedStorage();
  const candidates = Array.from({ length: 4 }, (_, index) => ({
    key: `private-id-${index}`,
    title: `Example title ${index}`,
    ...(index === 0 ? { project: "example-folder", agent: "example-agent" } : {}),
  }));
  mocks.run.mockReset().mockResolvedValue({
    _tag: "Success",
    value: {
      model: "local-fixture",
      suggestions: [
        { titleIndex: 0, categoryIndex: 0, reason: "First reason" },
        { titleIndex: 1, categoryIndex: 1, reason: "Second reason" },
      ],
      proposals: [
        { label: "Debate", description: "Speeches", keywords: ["speech"], titleIndexes: [2, 3] },
      ],
    },
  });

  // Exercises the suggestion panel without a connection or a real model call.
  await using screen = await render(
    <ThreadCategorySuggestions
      candidates={candidates}
      categories={categories}
      modelSelection={null}
    />,
    { router: false },
  );
  await expect.element(screen.getByText("4 threads are still unsorted")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Help me categorize" }));
  const dialog = page.getByRole("dialog");
  await expect.element(dialog.getByText("First reason")).toBeVisible();
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith({
    environmentId: "fixture",
    input: {
      titles: candidates.map((candidate) => candidate.title),
      categories: ["Work", "Research"],
      modelSelection: null,
      language: "en",
      contexts: [{ project: "example-folder", agent: "example-agent" }, {}, {}, {}],
      descriptions: ["Office matters", ""],
      proposeNew: true,
    },
  });
  expect(localStorage.getItem(overridesKey)).toBeNull();

  await userEvent.selectOptions(
    dialog.getByRole("combobox", { name: "Category for Example title 0" }),
    "research",
  );
  await userEvent.click(dialog.getByRole("checkbox", { name: "Include Example title 1" }));
  await userEvent.click(dialog.getByRole("checkbox", { name: "Create Debate" }));
  await userEvent.click(dialog.getByRole("button", { name: "Move 3 threads" }));

  const added = await addedCategory();
  expect(added).toMatchObject({ label: "Debate", description: "Speeches", keywords: ["speech"] });
  expect(JSON.parse(localStorage.getItem(overridesKey) ?? "{}")).toEqual({
    "private-id-0": "research",
    "private-id-2": added.id,
    "private-id-3": added.id,
  });
  await expect.element(dialog).not.toBeInTheDocument();
});

it("offers a suggested category until the user takes it or turns it down", async () => {
  await page.viewport(1280, 800);
  using _storage = isolatedStorage();
  mocks.run.mockReset();
  localStorage.setItem(
    proposalsKey,
    JSON.stringify({
      pending: [
        { label: "Debate", description: "Speeches", keywords: [], threadKeys: ["a", "b"] },
        { label: "Travel", description: "", keywords: [], threadKeys: ["c", "d"] },
      ],
      dismissed: [],
    }),
  );

  await using screen = await render(
    <ThreadCategorySuggestions candidates={[]} categories={categories} modelSelection={null} />,
    { router: false },
  );
  await expect.element(screen.getByText("Suggested new category: Debate")).toBeVisible();
  await expect.element(screen.getByText("Speeches · 2 threads fit it")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "No thanks" }).last());
  await expect.element(screen.getByText("Suggested new category: Travel")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Create category" }));

  const added = await addedCategory();
  expect(added).toMatchObject({ label: "Debate", description: "Speeches" });
  expect(JSON.parse(localStorage.getItem(autoKey) ?? "{}")).toEqual({
    a: { category: added.id, scheme: "", title: "" },
    b: { category: added.id, scheme: "", title: "" },
  });
  expect(JSON.parse(localStorage.getItem(proposalsKey) ?? "{}")).toEqual({
    pending: [],
    dismissed: ["travel"],
  });
  expect(mocks.run).not.toHaveBeenCalled();
});
