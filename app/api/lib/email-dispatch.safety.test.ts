import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  authorizeEmailDispatchRequest,
  persistSentEmailAfterGraphSuccess,
  recoverStaleSendingEmails,
  safeSendFailureMessage,
  SEND_ATTEMPT_EVENT,
} from "./email-dispatch";
import { GraphMailSendError } from "./graph-mail";
import { evaluateEnrollmentEligibility } from "./email-sequences";

const originalToken = process.env.EMAIL_DISPATCH_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.EMAIL_DISPATCH_TOKEN;
  else process.env.EMAIL_DISPATCH_TOKEN = originalToken;
});

test("dispatch fails closed when EMAIL_DISPATCH_TOKEN is missing", () => {
  delete process.env.EMAIL_DISPATCH_TOKEN;
  const result = authorizeEmailDispatchRequest("any-value");
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});

test("unauthorized dispatch requests are rejected", () => {
  process.env.EMAIL_DISPATCH_TOKEN = "configured-token";
  const missing = authorizeEmailDispatchRequest(null);
  const wrong = authorizeEmailDispatchRequest("other-token");
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 403);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.status, 403);
});

test("configured dispatch token authorizes the internal scheduler header", () => {
  process.env.EMAIL_DISPATCH_TOKEN = "configured-token";
  const result = authorizeEmailDispatchRequest("configured-token");
  assert.equal(result.ok, true);
});

test("enrollment into DRAFT or INACTIVE sequences is rejected", () => {
  assert.equal(
    evaluateEnrollmentEligibility({ sequenceStatus: "DRAFT" }).reason,
    "SEQUENCE_NOT_ACTIVE"
  );
  assert.equal(
    evaluateEnrollmentEligibility({ sequenceStatus: "INACTIVE" }).reason,
    "SEQUENCE_NOT_ACTIVE"
  );
  assert.equal(evaluateEnrollmentEligibility({ sequenceStatus: "ACTIVE" }).allow, true);
});

test("REMOVED enrollment cannot be silently restarted", () => {
  const blocked = evaluateEnrollmentEligibility({
    sequenceStatus: "ACTIVE",
    existingStatus: "REMOVED",
  });
  const explicit = evaluateEnrollmentEligibility({
    sequenceStatus: "ACTIVE",
    existingStatus: "REMOVED",
    reEnroll: true,
  });
  assert.equal(blocked.allow, false);
  assert.equal(blocked.reason, "REENROLL_REQUIRED");
  assert.equal(explicit.allow, true);
  assert.equal(explicit.restart, true);
});

test("suppressed contacts cannot be enrolled even with reEnroll", () => {
  assert.equal(
    evaluateEnrollmentEligibility({
      sequenceStatus: "ACTIVE",
      existingStatus: "REMOVED",
      reEnroll: true,
      suppressed: true,
    }).reason,
    "CONTACT_SUPPRESSED"
  );
  assert.equal(
    evaluateEnrollmentEligibility({
      sequenceStatus: "ACTIVE",
      suppressed: false,
    }).allow,
    true
  );
});

test("duplicate active and paused enrollments are skipped", () => {
  assert.equal(
    evaluateEnrollmentEligibility({ sequenceStatus: "ACTIVE", existingStatus: "ACTIVE" }).reason,
    "ALREADY_ACTIVE"
  );
  assert.equal(
    evaluateEnrollmentEligibility({ sequenceStatus: "ACTIVE", existingStatus: "PAUSED" }).reason,
    "ALREADY_PAUSED"
  );
  assert.equal(
    evaluateEnrollmentEligibility({ sequenceStatus: "ACTIVE", existingStatus: "COMPLETED" }).reason,
    "REENROLL_REQUIRED"
  );
});

type FakeEmail = {
  EmailId: number;
  Status: string;
  events: string[];
};

function createRecoveryPool(emails: FakeEmail[]) {
  return {
    query: async (sql: string, params: any[] = []) => {
      const text = String(sql);
      if (text.includes("FROM emails") && text.includes("SENDING")) {
        return [
          emails
            .filter((email) => email.Status === "SENDING")
            .map((email) => ({ EmailId: email.EmailId, CompanyId: 11 })),
        ];
      }
      if (text.includes("FROM email_events") && text.includes("EventType")) {
        const emailId = Number(params[0]);
        const eventType = String(params[params.length - 1]);
        const email = emails.find((item) => item.EmailId === emailId);
        const found = email?.events.includes(eventType);
        return [found ? [{ EventId: 1 }] : []];
      }
      if (text.includes("SET Status = 'QUEUED'")) {
        const emailId = Number(params[0]);
        const email = emails.find((item) => item.EmailId === emailId);
        if (!email || email.Status !== "SENDING") return [{ affectedRows: 0 }];
        email.Status = "QUEUED";
        return [{ affectedRows: 1 }];
      }
      if (text.includes("SET Status = 'FAILED'")) {
        const emailId = Number(params[0]);
        const email = emails.find((item) => item.EmailId === emailId);
        if (!email || email.Status !== "SENDING") return [{ affectedRows: 0 }];
        email.Status = "FAILED";
        return [{ affectedRows: 1 }];
      }
      if (text.includes("INSERT INTO email_events")) {
        const emailId = Number(params[3]);
        const eventType = String(params[0]);
        const email = emails.find((item) => item.EmailId === emailId);
        email?.events.push(eventType);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${text.replace(/\s+/g, " ").slice(0, 180)}`);
    },
  };
}

test("stale SENDING without a send attempt is returned to QUEUED", async () => {
  const emails: FakeEmail[] = [{ EmailId: 11, Status: "SENDING", events: [] }];
  const result = await recoverStaleSendingEmails({
    pool: createRecoveryPool(emails),
    staleSeconds: 900,
  });
  assert.equal(result.recoveredQueued, 1);
  assert.equal(result.markedUncertain, 0);
  assert.equal(emails[0].Status, "QUEUED");
});

test("stale SENDING with a send attempt is marked FAILED and not resent", async () => {
  const emails: FakeEmail[] = [
    { EmailId: 12, Status: "SENDING", events: [SEND_ATTEMPT_EVENT] },
  ];
  const result = await recoverStaleSendingEmails({
    pool: createRecoveryPool(emails),
    staleSeconds: 900,
  });
  assert.equal(result.recoveredQueued, 0);
  assert.equal(result.markedUncertain, 1);
  assert.equal(emails[0].Status, "FAILED");
  assert.equal(emails[0].events.includes("FAILED"), true);
});

test("Graph send failure messages stay generic", () => {
  const graphErr = new GraphMailSendError(502, "ErrorInvalidMailbox", "Microsoft Graph service is currently unavailable.");
  assert.equal(safeSendFailureMessage(graphErr), "Microsoft Graph service is currently unavailable.");
  assert.equal(safeSendFailureMessage(new Error("secret token=abcd")), "SEND_FAILED");
});

test("successful Graph send persist writes IDs and does not mark FAILED", async () => {
  const email = {
    EmailId: 44,
    Status: "SENDING",
    ProviderMessageId: null as string | null,
    ThreadId: null as string | null,
    events: [] as string[],
  };
  const pool = {
    query: async (sql: string, params: any[] = []) => {
      const text = String(sql);
      if (text.includes("SELECT CompanyId") && text.includes("FROM emails")) {
        return [[{ CompanyId: 11 }]];
      }
      if (text.includes("SET Status = 'SENT'")) {
        assert.equal(email.Status, "SENDING");
        assert.equal(Number(params[3]), 11);
        email.Status = "SENT";
        email.ProviderMessageId = params[0];
        email.ThreadId = params[1];
        return [{ affectedRows: 1 }];
      }
      if (text.includes("INSERT INTO email_events")) {
        email.events.push(String(params[0] || "SENT"));
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${text.replace(/\s+/g, " ").slice(0, 180)}`);
    },
  };
  const result = await persistSentEmailAfterGraphSuccess({
    poolOrConn: pool,
    emailId: 44,
    source: "graph-application",
    sequenceId: 9,
    stepId: 2,
    sentIds: {
      graphMessageId: "g1",
      conversationId: "conv-1",
      internetMessageId: "<mid@shared>",
    },
  });
  assert.equal(result.persisted, true);
  assert.equal(email.Status, "SENT");
  assert.equal(email.ProviderMessageId, "<mid@shared>");
  assert.equal(email.ThreadId, "conv-1");
  assert.equal(email.events.includes("SENT"), true);
  assert.equal(email.events.includes("FAILED"), false);
});
