function isSchedulerEnabled() {
  return process.env.REMINDER_SCHEDULER_ENABLED === "true";
}

function getDispatchUrl() {
  const explicitBaseUrl = (process.env.REMINDER_SCHEDULER_BASE_URL || "").trim();
  const publicBaseUrl = (process.env.NEXT_PUBLIC_BASE_URL || "").trim();
  const authBaseUrl = (process.env.NEXTAUTH_URL || "").trim();
  const port = Number(process.env.PORT || 3001);

  if (explicitBaseUrl) {
    return `${explicitBaseUrl.replace(/\/$/, "")}/api/employees/reminders/dispatch`;
  }

  const baseUrl = publicBaseUrl || authBaseUrl || `http://localhost:${port}`;
  return `${baseUrl.replace(/\/$/, "")}/api/employees/reminders/dispatch`;
}

export function startReminderScheduler() {
  if (!isSchedulerEnabled()) {
    return;
  }

  const intervalMs = Number(process.env.REMINDER_SCHEDULER_INTERVAL_MS || 60_000);
  const dispatchUrl = getDispatchUrl();
  const dispatchToken = (process.env.REMINDER_DISPATCH_TOKEN || "").trim();

  const run = async () => {
    try {
      await fetch(dispatchUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(dispatchToken ? { "x-reminder-dispatch-token": dispatchToken } : {}),
        },
      });
    } catch (error) {
      console.error("[reminder-scheduler] Scheduled run failed", error);
    }
  };

  run();
  setInterval(run, intervalMs);
}

