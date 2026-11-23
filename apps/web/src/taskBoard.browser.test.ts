import { expect, it, vi } from "vite-plus/test";
import { startTaskBoardPolling, useTaskBoard } from "./taskBoard";

it("polls no external board service", async () => {
  using request = vi.spyOn(globalThis, "fetch");
  useTaskBoard.setState({ data: null, error: null, loading: true });
  const stop = startTaskBoardPolling();
  await Promise.resolve();
  window.dispatchEvent(new Event("focus"));
  expect(request).not.toHaveBeenCalled();
  expect(useTaskBoard.getState().loading).toBe(false);
  stop();
});
