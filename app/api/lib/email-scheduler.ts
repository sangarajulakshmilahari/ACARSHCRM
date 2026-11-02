function isSchedulerEnabled() {
  if (process.env.EMAIL_SCHEDULER_ENABLED === "false") {
    return false;
  }

  // Enabled by default in development unless explicitly disabled.
  if (process.env.NODE_ENV !== "production") {
    return process.env.EMAIL_SCHEDULER_ALLOW_IN_DEV !== "false";
  }

  return true;
}

function getSchedulerApiUrl(path: "/api/email/dispatch" | "/api/email/replies/sync") {
  const explicitBaseUrl = (process.env.EMAIL_SCHEDULER_BASE_URL || "").trim();
  const publicBaseUrl = (process.env.NEXT_PUBLIC_BASE_URL || "").trim();
  const authBaseUrl = (process.env.NEXTAUTH_URL || "").trim();
  const port = Number(process.env.PORT || 3001);

  if (explicitBaseUrl) {
    return `${explicitBaseUrl.replace(/\/$/, "")}${path}`;
  }

  if (process.env.NODE_ENV !== "production") {
    return `https://localhost:${port}${path}`;
  }

  const baseUrl = publicBaseUrl || authBaseUrl || `https://localhost:${port}`;
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function isLocalHttpsUrl(url: string) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "::1")
    );
  } catch {
    return false;
  }
}

async function schedulerFetch(url: string, init: RequestInit) {
  if (!isLocalHttpsUrl(url)) {
    return fetch(url, init);
  }

  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    return await fetch(url, init);
  } finally {
    if (previous === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
    }
  }
}

function getDispatchUrl() {
  return getSchedulerApiUrl("/api/email/dispatch");
}

export function startEmailScheduler() {
  if (!isSchedulerEnabled()) {
    console.log("[Email Scheduler] Disabled by configuration");
    return;
  }

  const globalKey = "__acarshEmailSchedulerStarted";
  const globalState = globalThis as typeof globalThis & Record<string, any>;
  if (globalState[globalKey]) {
    return;
  }
  globalState[globalKey] = true;

  const intervalMs = Number(process.env.EMAIL_SCHEDULER_INTERVAL_MS || 60_000);
  const dispatchUrl = getDispatchUrl();
  const dispatchToken = (process.env.EMAIL_DISPATCH_TOKEN || "").trim();
  let isRunning = false;

  const run = async () => {
    if (isRunning) {
      console.log("[Email Scheduler] Previous cycle still running; skipping overlap");
      return;
    }

    if (!dispatchToken) {
      console.error("[Email Scheduler] EMAIL_DISPATCH_TOKEN is not configured; skipping dispatch");
      return;
    }

    isRunning = true;
    try {
      console.log("[Email Scheduler] Checking scheduled emails...");
      const response = await schedulerFetch(dispatchUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-email-dispatch-token": dispatchToken,
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        console.error(
          `[Email Scheduler] Dispatch endpoint failed (${response.status}): ${errorText || response.statusText}`
        );
      } else {
        const payload = await response.json().catch(() => null);
        const processed = Number(payload?.processed || 0);
        const sentCount = Number(payload?.sentCount || 0);
        const failedCount = Number(payload?.failedCount || 0);
        const skippedCount = Number(payload?.skippedCount || 0);

        console.log(
          `[Email Scheduler] Cycle complete. processed=${processed}, sent=${sentCount}, failed=${failedCount}, skipped=${skippedCount}`
        );
      }

      const repliesUrl = getSchedulerApiUrl("/api/email/replies/sync");
      const repliesResponse = await schedulerFetch(repliesUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-email-dispatch-token": dispatchToken,
        },
      });
      if (!repliesResponse.ok) {
        const errorText = await repliesResponse.text().catch(() => "");
        console.error(
          `[Email Scheduler] Reply sync failed (${repliesResponse.status}): ${errorText || repliesResponse.statusText}`
        );
      } else {
        const replies = await repliesResponse.json().catch(() => null);
        console.log(
          `[Email Scheduler] Reply sync scanned=${Number(replies?.scanned || 0)} matched=${Number(replies?.matched || 0)} paused=${Number(replies?.paused || 0)}`
        );
      }
    } catch (error) {
      console.error("[email-scheduler] Scheduled run failed", error);
    } finally {
      isRunning = false;
    }
  };

  console.log(
    `[Email Scheduler] Started (interval: ${intervalMs}ms, dispatchUrl: ${dispatchUrl})`
  );
  run();
  setInterval(run, intervalMs);
}

