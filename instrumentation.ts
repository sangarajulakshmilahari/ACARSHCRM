import { startReminderScheduler } from "./app/api/lib/reminder-scheduler";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  startReminderScheduler();
}

