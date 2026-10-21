import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  applyUnsubscribeFromToken,
  blockDispatchIfSuppressed,
  createUnsubscribeToken,
  hashNormalizedEmail,
  isEmailSuppressed,
  normalizeRecipientEmail,
  SUPPRESSED_STATUS,
  upsertEmailSuppression,
  validateUnsubscribeToken,
} from "./email-suppressions";
import { evaluateEnrollmentEligibility } from "./email-sequences";

const originalSecret = process.env.EMAIL_UNSUBSCRIBE_SECRET;
const originalBase = process.env.EMAIL_UNSUBSCRIBE_BASE_URL;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
  else process.env.EMAIL_UNSUBSCRIBE_SECRET = originalSecret;
  if (originalBase === undefined) delete process.env.EMAIL_UNSUBSCRIBE_BASE_URL;
  else process.env.EMAIL_UNSUBSCRIBE_BASE_URL = originalBase;
});

test("recipient emails are normalized to lowercase trimmed values", () => {
  assert.equal(normalizeRecipientEmail("  Person@Example.COM "), "person@example.com");
});

test("unsubscribe tokens reject missing, tampered, and expired values", () => {
  process.env.EMAIL_UNSUBSCRIBE_SECRET = "unit-test-unsubscribe-secret";
  const token = createUnsubscribeToken({
    emailId: 42,
    normalizedEmail: "person@example.com",
    nowMs: Date.parse("2026-01-01T00:00:00Z"),
  });
  assert.equal(typeof token, "string");

  const valid = validateUnsubscribeToken(token, Date.parse("2026-01-02T00:00:00Z"));
  assert.equal(valid.ok, true);

  const tampered = String(token).slice(0, -2) + "ab";
  assert.equal(validateUnsubscribeToken(tampered).ok, false);

  const expired = validateUnsubscribeToken(token, Date.parse("2030-01-01T00:00:00Z"));
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.reason, "expired");

  const wrongPurpose = String(token).replace("v1.", "v2.");
  assert.equal(validateUnsubscribeToken(wrongPurpose).ok, false);
});

test("token creation fails closed without a secret", () => {
  delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
  assert.equal(
    createUnsubscribeToken({ emailId: 1, normalizedEmail: "a@b.com" }),
    null
  );
  const missing = validateUnsubscribeToken("v1.abc.def");
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.reason, "secret_missing");
});

function createSuppressionPool(state: {
  emails?: Array<{ EmailId: number; ToEmail: string; LeadContactID: number; CompanyId?: number }>;
  suppressions: Array<{
    NormalizedEmail: string;
    RevokedAt: string | null;
    Reason?: string;
    CompanyId?: number;
  }>;
  events: string[];
  enrollmentStatus?: string;
  emailStatus?: string;
}) {
  return {
    query: async (sql: string, params: any[] = []) => {
      const text = String(sql);
      if (text.includes("CREATE TABLE IF NOT EXISTS email_suppressions")) {
        return [{ affectedRows: 0 }];
      }
      if (text.includes("FROM email_suppressions") && text.includes("RevokedAt IS NULL")) {
        const normalized = String(params[0] || "");
        const companyId = Number(params[1] || 0);
        const found = state.suppressions.find(
          (row) =>
            row.NormalizedEmail === normalized &&
            row.RevokedAt == null &&
            Number(row.CompanyId || 1) === companyId
        );
        return [found ? [{ SuppressionId: 1 }] : []];
      }
      if (text.includes("FROM email_suppressions") && text.includes("NormalizedEmail")) {
        const normalized = String(params[0] || "");
        const companyId = Number(params[1] || 0);
        const found = state.suppressions.find(
          (row) =>
            row.NormalizedEmail === normalized &&
            Number(row.CompanyId || 1) === companyId
        );
        return [found ? [found] : []];
      }
      if (text.includes("INSERT INTO email_suppressions")) {
        const companyId = Number(params[0]);
        const normalized = String(params[1]);
        const existing = state.suppressions.find(
          (row) =>
            row.NormalizedEmail === normalized &&
            Number(row.CompanyId || 1) === companyId
        );
        if (existing && existing.RevokedAt == null) {
          return [{ affectedRows: 0 }];
        }
        if (existing) {
          existing.RevokedAt = null;
          existing.Reason = String(params[2]);
          return [{ affectedRows: 2 }];
        }
        state.suppressions.push({
          CompanyId: companyId,
          NormalizedEmail: normalized,
          RevokedAt: null,
          Reason: String(params[2]),
        });
        return [{ affectedRows: 1 }];
      }
      if (text.includes("FROM emails")) {
        const emailId = Number(params[0]);
        const found = (state.emails || []).find((row) => row.EmailId === emailId);
        return [found ? [{ ...found, CompanyId: found.CompanyId ?? 1 }] : []];
      }
      if (text.includes("UPDATE email_sequence_contacts")) {
        if (state.enrollmentStatus === "ACTIVE") state.enrollmentStatus = "PAUSED";
        return [{ affectedRows: 1 }];
      }
      if (text.includes("SET Status = ?") && params[0] === SUPPRESSED_STATUS) {
        state.emailStatus = SUPPRESSED_STATUS;
        return [{ affectedRows: 1 }];
      }
      if (text.includes("INSERT INTO email_events")) {
        state.events.push(String(params[0]));
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${text.replace(/\s+/g, " ").slice(0, 180)}`);
    },
  };
}

test("unsubscribe without confirm does not change suppression state", async () => {
  process.env.EMAIL_UNSUBSCRIBE_SECRET = "unit-test-unsubscribe-secret";
  const token = createUnsubscribeToken({
    emailId: 10,
    normalizedEmail: "person@example.com",
  });
  const pool = createSuppressionPool({
    emails: [{ EmailId: 10, ToEmail: "person@example.com", LeadContactID: 4, CompanyId: 1 }],
    suppressions: [],
    events: [],
  });
  const result = await applyUnsubscribeFromToken({
    pool,
    token,
    confirm: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "confirm_required");
  assert.equal(await isEmailSuppressed(pool, "person@example.com", 1), false);
});

test("confirmed unsubscribe is idempotent and does not suppress a different address", async () => {
  process.env.EMAIL_UNSUBSCRIBE_SECRET = "unit-test-unsubscribe-secret";
  const token = createUnsubscribeToken({
    emailId: 10,
    normalizedEmail: "person@example.com",
  });
  const pool = createSuppressionPool({
    emails: [{ EmailId: 10, ToEmail: "person@example.com", LeadContactID: 4, CompanyId: 1 }],
    suppressions: [],
    events: [],
    enrollmentStatus: "ACTIVE",
  });
  const first = await applyUnsubscribeFromToken({ pool, token, confirm: true });
  const second = await applyUnsubscribeFromToken({ pool, token, confirm: true });
  assert.equal(first.ok, true);
  assert.equal(first.already, false);
  assert.equal(second.ok, true);
  assert.equal(second.already, true);
  assert.equal(await isEmailSuppressed(pool, "person@example.com", 1), true);
  assert.equal(await isEmailSuppressed(pool, "other@example.com", 1), false);
});

test("token email hash must match the stored recipient", async () => {
  process.env.EMAIL_UNSUBSCRIBE_SECRET = "unit-test-unsubscribe-secret";
  const token = createUnsubscribeToken({
    emailId: 10,
    normalizedEmail: "person@example.com",
  });
  const pool = createSuppressionPool({
    emails: [{ EmailId: 10, ToEmail: "other@example.com", LeadContactID: 4, CompanyId: 1 }],
    suppressions: [],
    events: [],
  });
  const result = await applyUnsubscribeFromToken({ pool, token, confirm: true });
  assert.equal(result.ok, false);
  assert.equal(await isEmailSuppressed(pool, "other@example.com", 1), false);
  assert.equal(hashNormalizedEmail("person@example.com") !== hashNormalizedEmail("other@example.com"), true);
});

test("duplicate suppression insert is treated as already suppressed", async () => {
  const pool = createSuppressionPool({
    suppressions: [{ NormalizedEmail: "person@example.com", RevokedAt: null, CompanyId: 1 }],
    events: [],
  });
  const result = await upsertEmailSuppression({
    poolOrConn: pool,
    normalizedEmail: "Person@Example.com",
    reason: "UNSUBSCRIBE",
    source: "LINK",
    companyId: 1,
  });
  assert.equal(result.already, true);
  assert.equal(result.created, false);
});

test("dispatch skips suppressed recipients and leaves ordinary recipients unblocked", async () => {
  const suppressedPool = createSuppressionPool({
    emails: [{ EmailId: 88, ToEmail: "person@example.com", LeadContactID: 4, CompanyId: 1 }],
    suppressions: [{ NormalizedEmail: "person@example.com", RevokedAt: null, CompanyId: 1 }],
    events: [],
    enrollmentStatus: "ACTIVE",
    emailStatus: "SENDING",
  });
  const blocked = await blockDispatchIfSuppressed({
    pool: suppressedPool,
    emailId: 88,
    toEmail: "Person@Example.com",
    sequenceId: 3,
    leadContactId: 4,
  });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.reason, "RECIPIENT_SUPPRESSED");

  const openPool = createSuppressionPool({
    emails: [{ EmailId: 89, ToEmail: "ok@example.com", LeadContactID: 4, CompanyId: 1 }],
    suppressions: [],
    events: [],
    emailStatus: "SENDING",
  });
  const open = await blockDispatchIfSuppressed({
    pool: openPool,
    emailId: 89,
    toEmail: "ok@example.com",
    sequenceId: 3,
    leadContactId: 4,
  });
  assert.equal(open.blocked, false);
});

test("isEmailSuppressed fails closed without a company", async () => {
  const pool = createSuppressionPool({ suppressions: [], events: [] });
  await assert.rejects(() => isEmailSuppressed(pool, "person@example.com"), /COMPANY_REQUIRED/);
});

test("suppression in company A does not block company B", async () => {
  const pool = createSuppressionPool({
    suppressions: [{ NormalizedEmail: "person@example.com", RevokedAt: null, CompanyId: 11 }],
    events: [],
  });
  assert.equal(await isEmailSuppressed(pool, "person@example.com", 11), true);
  assert.equal(await isEmailSuppressed(pool, "person@example.com", 22), false);
});

test("re-enroll cannot bypass suppression", () => {
  assert.equal(
    evaluateEnrollmentEligibility({
      sequenceStatus: "ACTIVE",
      existingStatus: "COMPLETED",
      reEnroll: true,
      suppressed: true,
    }).allow,
    false
  );
});
