import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  applyOptionalEmailTracking,
  createClickToken,
  createOpenToken,
  handleOpenPixel,
  hashDestinationUrl,
  isSafeHttpUrl,
  recordOpenEvent,
  resolveTrackedClick,
  shouldTrackHref,
  summarizeTrackingEvents,
  trackingPixelHeaders,
  validateClickToken,
  validateOpenToken,
} from "./email-tracking";

const originalEnabled = process.env.EMAIL_TRACKING_ENABLED;
const originalSecret = process.env.EMAIL_TRACKING_SECRET;
const originalBase = process.env.EMAIL_TRACKING_BASE_URL;
const originalUnsubBase = process.env.EMAIL_UNSUBSCRIBE_BASE_URL;

afterEach(() => {
  if (originalEnabled === undefined) delete process.env.EMAIL_TRACKING_ENABLED;
  else process.env.EMAIL_TRACKING_ENABLED = originalEnabled;
  if (originalSecret === undefined) delete process.env.EMAIL_TRACKING_SECRET;
  else process.env.EMAIL_TRACKING_SECRET = originalSecret;
  if (originalBase === undefined) delete process.env.EMAIL_TRACKING_BASE_URL;
  else process.env.EMAIL_TRACKING_BASE_URL = originalBase;
  if (originalUnsubBase === undefined) delete process.env.EMAIL_UNSUBSCRIBE_BASE_URL;
  else process.env.EMAIL_UNSUBSCRIBE_BASE_URL = originalUnsubBase;
});

function enableTracking() {
  process.env.EMAIL_TRACKING_ENABLED = "true";
  process.env.EMAIL_TRACKING_SECRET = "unit-test-tracking-secret";
  process.env.EMAIL_TRACKING_BASE_URL = "https://crm.example.test";
}

test("tracking is disabled by default and leaves HTML unchanged", async () => {
  delete process.env.EMAIL_TRACKING_ENABLED;
  delete process.env.EMAIL_TRACKING_SECRET;
  const html = '<p>Hello https://example.com</p><a href="https://crm.example.test/unsubscribe?token=abc">unsubscribe</a>';
  const out = await applyOptionalEmailTracking({
    pool: { query: async () => {
      throw new Error("tracking pool should not be used when disabled");
    } },
    html,
    emailId: 1,
    toEmail: "a@b.com",
  });
  assert.equal(out, html);
  assert.equal(createOpenToken({ emailId: 1, normalizedEmail: "a@b.com" }), null);
});

test("unsafe and unsubscribe URLs are not tracked", () => {
  enableTracking();
  assert.equal(isSafeHttpUrl("javascript:alert(1)"), false);
  assert.equal(isSafeHttpUrl("data:text/html,hi"), false);
  assert.equal(shouldTrackHref("https://crm.example.test/unsubscribe?token=abc"), false);
  assert.equal(shouldTrackHref("https://example.com/path"), true);
});

test("open tokens reject tampering and invalid identifiers", () => {
  enableTracking();
  const token = createOpenToken({ emailId: 12, normalizedEmail: "person@example.com" });
  assert.equal(typeof token, "string");
  assert.equal(validateOpenToken(token).ok, true);
  assert.equal(validateOpenToken(String(token).slice(0, -3) + "zzz").ok, false);
  assert.equal(validateOpenToken("not-a-token").ok, false);
  assert.equal(validateClickToken(token).ok, false);
});

test("pixel cache headers prevent caching and invalid tokens still return a gif", async () => {
  enableTracking();
  const headers = trackingPixelHeaders();
  assert.match(headers["Cache-Control"], /no-store/);
  assert.equal(headers["Content-Type"], "image/gif");
  const pixel = await handleOpenPixel({
    pool: { query: async () => {
      throw new Error("invalid token must not write events");
    } },
    token: "v1.bad.sig",
  });
  assert.equal(pixel.status, 200);
  assert.equal(pixel.body.length > 0, true);
  assert.match(pixel.headers["Cache-Control"], /no-store/);
});

test("unsubscribe links stay direct after tracking rewrite", async () => {
  enableTracking();
  const links: string[] = [];
  const pool = {
    query: async (sql: string, params: any[] = []) => {
      const text = String(sql);
      if (text.includes("CREATE TABLE IF NOT EXISTS email_tracked_links")) return [{}];
      if (text.includes("SHOW COLUMNS FROM email_tracked_links")) return [[{ Field: "CompanyId" }]];
      if (text.includes("INSERT INTO email_tracked_links")) {
        assert.match(text, /e\.CompanyId/);
        links.push(String(params[1]));
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${text.slice(0, 120)}`);
    },
  };
  const html =
    `<p>See https://example.com/offer</p>` +
    `<p><a href="https://crm.example.test/unsubscribe?token=abc">unsubscribe</a></p>`;
  const out = await applyOptionalEmailTracking({
    pool,
    html,
    emailId: 44,
    toEmail: "person@example.com",
  });
  assert.match(out, /\/unsubscribe\?token=abc/);
  assert.equal(out.includes("/api/email/t/click") && out.includes("example.com/offer"), true);
  assert.equal(links.includes("https://crm.example.test/unsubscribe?token=abc"), false);
  assert.equal(links.includes("https://example.com/offer"), true);
  assert.match(out, /\/api\/email\/t\/open\?t=/);
});

test("open recording does not change delivery or enrollment state", async () => {
  const sqlLog: string[] = [];
  const pool = {
    query: async (sql: string) => {
      sqlLog.push(String(sql));
      return [{ affectedRows: 1 }];
    },
  };
  await recordOpenEvent({ pool, emailId: 9 });
  assert.equal(sqlLog.some((sql) => sql.includes("DeliveryStatus")), false);
  assert.equal(sqlLog.some((sql) => sql.includes("email_sequence_contacts")), false);
  assert.equal(sqlLog.some((sql) => sql.includes("SET Status")), false);
});

test("click redirect uses stored destination only", async () => {
  enableTracking();
  const dest = "https://example.com/safe";
  const urlHash = hashDestinationUrl(dest);
  const token = createClickToken({
    emailId: 5,
    normalizedEmail: "person@example.com",
    urlHash,
  });
  const pool = {
    query: async (sql: string, params: any[] = []) => {
      const text = String(sql);
      if (text.includes("CREATE TABLE IF NOT EXISTS email_tracked_links")) return [{}];
      if (text.includes("FROM email_tracked_links")) {
        assert.match(text, /INNER JOIN emails e/);
        assert.equal(Number(params[0]), 5);
        assert.equal(String(params[1]), urlHash);
        return [[{ DestinationUrl: dest }]];
      }
      if (text.includes("INSERT INTO email_events")) return [{ affectedRows: 1 }];
      throw new Error(text.slice(0, 120));
    },
  };
  const resolved = await resolveTrackedClick({ pool, token });
  assert.equal(resolved.ok, true);
  if (resolved.ok) assert.equal(resolved.url, dest);

  const tampered = await resolveTrackedClick({ pool, token: String(token).slice(0, -2) + "aa" });
  assert.equal(tampered.ok, false);
});

test("tracking summaries stay hidden when no open/click events exist", () => {
  const empty = summarizeTrackingEvents([{ EventType: "SENT" }, { EventType: "DELIVERED" }]);
  assert.equal(empty.opensApprox, 0);
  assert.equal(empty.clicksApprox, 0);
  const present = summarizeTrackingEvents([{ EventType: "OPEN" }, { EventType: "CLICK" }, { EventType: "CLICK" }]);
  assert.equal(present.opensApprox, 1);
  assert.equal(present.clicksApprox, 2);
});
