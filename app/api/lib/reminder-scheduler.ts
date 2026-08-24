function isSchedulerEnabled() {
  if (process.env.REMINDER_SCHEDULER_ENABLED !== "true") {
    return false;
  }

  // Avoid dev-time route self-calls during Next HMR/compilation.
  // This has caused unstable .next chunks and MODULE_NOT_FOUND crashes.
  if (process.env.NODE_ENV !== "production") {
    return process.env.REMINDER_SCHEDULER_ALLOW_IN_DEV === "true";
  }

  return true;
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

  const globalKey = "__acarshReminderSchedulerStarted";
  const globalState = globalThis as typeof globalThis & Record<string, any>;
  if (globalState[globalKey]) {
    return;
  }
  globalState[globalKey] = true;

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

