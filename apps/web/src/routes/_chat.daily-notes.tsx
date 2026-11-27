import { createFileRoute } from "@tanstack/react-router";

import { DailyNotesPage } from "../dailyNotes/ui/DailyNotesPage";
import { validateTodaySearch } from "../dailyNotes/model/dates";

export const Route = createFileRoute("/_chat/daily-notes")({
  validateSearch: validateTodaySearch,
  component: DailyNotesPage,
});
