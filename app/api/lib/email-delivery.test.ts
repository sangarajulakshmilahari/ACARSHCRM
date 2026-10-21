import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  authorizeEmailDeliveryRequest,
  deliveryEvidenceLabel,
  foldDeliveryStatus,
  ingestDeliveryEvents,
  parseIncomingDeliveryEvent,
} from "./email-delivery";

const originalToken = process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN;
  else process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN = originalToken;
});

test("delivery ingestion fails closed without a webhook token", () => {
  delete process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN;
  const result = authorizeEmailDeliveryRequest("any");
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});

test("delivery ingestion rejects unauthorized tokens", () => {
  process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN = "delivery-token";
  assert.equal(authorizeEmailDeliveryRequest("wrong").ok, false);
  assert.equal(authorizeEmailDeliveryRequest("delivery-token").ok, true);
});

test("Graph SENT is not displayed as delivered", () => {
  assert.equal(deliveryEvidenceLabel({ status: "SENT", deliveryStatus: "UNKNOWN" }), "Sent (delivery unknown)");
  assert.equal(deliveryEvidenceLabel({ status: "SENT", deliveryStatus: "DELIVERED" }), "Delivered");
  assert.equal(deliveryEvidenceLabel({ status: "SENT", deliveryStatus: "BOUNCED" }), "Bounced");
  assert.equal(deliveryEvidenceLabel({ status: "FAILED" }), "FAILED");
});

test("invalid delivery payloads are rejected", () => {
  assert.equal(parseIncomingDeliveryEvent(null).ok, false);
  assert.equal(parseIncomingDeliveryEvent({}).ok, false);
  assert.equal(parseIncomingDeliveryEvent({ provider: "graph", providerEventId: "1", type: "opened" }).ok, false);
  assert.equal(
    parseIncomingDeliveryEvent({
      provider: "graph",
      providerEventId: "1",
      type: "delivered",
      occurredAt: "not-a-date",
    }).ok,
    false
  );
});

test("out-of-order events keep permanent bounce terminal", () => {
  assert.equal(
    foldDeliveryStatus([
      { type: "bounced", occurredAt: "2026-01-02T00:00:00Z" },
      { type: "delivered", occurredAt: "2026-01-01T00:00:00Z" },
    ]),
    "BOUNCED"
  );
  assert.equal(
    foldDeliveryStatus([
      { type: "deferred", occurredAt: "2026-01-01T00:00:00Z" },
      { type: "delivered", occurredAt: "2026-01-02T00:00:00Z" },
    ]),
    "DELIVERED"
  );
});

type FakeEmail = {
  EmailId: number;
  ToEmail: string;
  SequenceId: number | null;
  LeadContactID: number;
  CompanyId?: number | null;
  Status: string;
  DeliveryStatus: string;
  ProviderMessageId?: string | null;
  ThreadId?: string | null;
};

function createDeliveryPool(state: {
  emails: FakeEmail[];
  events: Array<{ EmailId: number; EventType: string; providerEventId?: string; occurredAt?: string }>;
  suppressions: string[];
}) {
  return {
    state,
    query: async (sql: string, params: any[] = []) => {
      const text = String(sql);
      if (text.includes("SHOW COLUMNS FROM emails LIKE 'DeliveryStatus'")) {
        return [[{ Field: "DeliveryStatus" }]];
      }
      if (text.includes("FROM emails") && text.includes("WHERE EmailId = ?")) {
        const found = state.emails.find((row) => row.EmailId === Number(params[0]));
        return [found ? [found] : []];
      }
      if (text.includes("ProviderMessageId = ?")) {
        const found = state.emails.filter((row) => row.ProviderMessageId === params[0]);
        return [found];
      }
      if (text.includes("ThreadId = ?")) {
        const found = state.emails.filter((row) => row.ThreadId === params[0]);
        return [found];
      }
      if (text.includes("graphMessageId")) {
        return [[]];
      }
      if (text.includes("FROM email_events") && text.includes("providerEventId")) {
        const emailId = Number(params[0]);
        const providerEventId = String(params[params.length - 1]);
        const found = state.events.find(
          (event) => event.EmailId === emailId && event.providerEventId === providerEventId
        );
        return [found ? [{ EventId: 1 }] : []];
      }
      if (text.includes("INSERT INTO email_events")) {
        const metadata = JSON.parse(String(params[2] || "{}"));
        state.events.push({
          EmailId: Number(params[3]),
          EventType: String(params[0]),
          providerEventId: metadata.providerEventId,
          occurredAt: metadata.occurredAt,
        });
        return [{ affectedRows: 1 }];
      }
      if (text.includes("FROM email_events") && text.includes("EventType IN")) {
        const emailId = Number(params[0]);
        return [
          state.events
            .filter((event) => event.EmailId === emailId)
            .map((event) => ({
              EventType: event.EventType,
              EventTime: event.occurredAt,
              Metadata: JSON.stringify({
                providerEventId: event.providerEventId,
                occurredAt: event.occurredAt,
              }),
            })),
        ];
      }
      if (text.includes("SET DeliveryStatus = ?")) {
        const email = state.emails.find((row) => row.EmailId === Number(params[1]));
        if (email) email.DeliveryStatus = String(params[0]);
        return [{ affectedRows: 1 }];
      }
      if (text.includes("CREATE TABLE IF NOT EXISTS email_suppressions")) {
        return [{ affectedRows: 0 }];
      }
      if (text.includes("FROM email_suppressions")) {
        const normalized = String(params[0] || "");
        const found = state.suppressions.includes(normalized);
        return [found ? [{ SuppressionId: 1, RevokedAt: null }] : []];
      }
      if (text.includes("INSERT INTO email_suppressions")) {
        state.suppressions.push(String(params[1] || params[0]));
        return [{ affectedRows: 1 }];
      }
      if (text.includes("UPDATE email_sequence_contacts")) {
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${text.replace(/\s+/g, " ").slice(0, 180)}`);
    },
  };
}

test("delivery events without a stored CompanyId are unknown", async () => {
  const pool = createDeliveryPool({
    emails: [
      {
        EmailId: 3,
        ToEmail: "none@example.com",
        SequenceId: 9,
        LeadContactID: 4,
        CompanyId: null,
        Status: "SENT",
        DeliveryStatus: "UNKNOWN",
      },
    ],
    events: [],
    suppressions: [],
  });
  const result = await ingestDeliveryEvents({
    pool,
    events: [
      {
        provider: "graph",
        providerEventId: "no-co",
        type: "delivered",
        occurredAt: "2026-01-01T00:00:00Z",
        emailId: 3,
      },
    ],
  });
  assert.equal(result.unknown, 1);
  assert.equal(result.applied, 0);
});

test("empty ingestion does not fabricate delivery events", async () => {
  const pool = createDeliveryPool({
    emails: [
      {
        EmailId: 1,
        ToEmail: "a@b.com",
        SequenceId: 9,
        LeadContactID: 4,
        Status: "SENT",
        DeliveryStatus: "UNKNOWN",
      },
    ],
    events: [],
    suppressions: [],
  });
  const result = await ingestDeliveryEvents({ pool, events: [] });
  assert.equal(result.processed, 0);
  assert.equal(result.applied, 0);
  assert.equal(pool.state.events.length, 0);
  assert.equal(pool.state.emails[0].DeliveryStatus, "UNKNOWN");
  assert.equal(pool.state.emails[0].Status, "SENT");
});

test("unknown message ids and invalid payloads are skipped", async () => {
  const pool = createDeliveryPool({
    emails: [
      {
        EmailId: 1,
        ToEmail: "a@b.com",
        SequenceId: 9,
        LeadContactID: 4,
        Status: "SENT",
        DeliveryStatus: "UNKNOWN",
        ProviderMessageId: "<mid@x>",
      },
    ],
    events: [],
    suppressions: [],
  });
  const result = await ingestDeliveryEvents({
    pool,
    events: [
      { provider: "graph", providerEventId: "bad", type: "opened", occurredAt: "2026-01-01T00:00:00Z" },
      {
        provider: "graph",
        providerEventId: "missing",
        type: "delivered",
        occurredAt: "2026-01-01T00:00:00Z",
        internetMessageId: "<nope@x>",
      },
    ],
  });
  assert.equal(result.invalid, 1);
  assert.equal(result.unknown, 1);
  assert.equal(result.applied, 0);
  assert.equal(pool.state.emails[0].DeliveryStatus, "UNKNOWN");
});

test("duplicate provider events are idempotent", async () => {
  const pool = createDeliveryPool({
    emails: [
      {
        EmailId: 7,
        ToEmail: "person@example.com",
        SequenceId: 3,
        LeadContactID: 4,
        CompanyId: 11,
        Status: "SENT",
        DeliveryStatus: "UNKNOWN",
      },
    ],
    events: [],
    suppressions: [],
  });
  const event = {
    provider: "exchange-trace",
    providerEventId: "evt-1",
    type: "delivered",
    occurredAt: "2026-01-02T00:00:00Z",
    emailId: 7,
  };
  const first = await ingestDeliveryEvents({ pool, events: [event] });
  const second = await ingestDeliveryEvents({ pool, events: [event] });
  assert.equal(first.applied, 1);
  assert.equal(second.duplicate, 1);
  assert.equal(pool.state.events.length, 1);
  assert.equal(pool.state.emails[0].DeliveryStatus, "DELIVERED");
  assert.equal(pool.state.emails[0].Status, "SENT");
});

test("permanent bounce suppresses without converting SENT to FAILED", async () => {
  const pool = createDeliveryPool({
    emails: [
      {
        EmailId: 8,
        ToEmail: "person@example.com",
        SequenceId: 3,
        LeadContactID: 4,
        CompanyId: 1,
        Status: "SENT",
        DeliveryStatus: "UNKNOWN",
      },
    ],
    events: [],
    suppressions: [],
  });
  const result = await ingestDeliveryEvents({
    pool,
    events: [
      {
        provider: "exchange-trace",
        providerEventId: "bounce-1",
        type: "bounced",
        bounceClass: "permanent",
        occurredAt: "2026-01-03T00:00:00Z",
        emailId: 8,
      },
    ],
  });
  assert.equal(result.applied, 1);
  assert.equal(result.suppressed, 1);
  assert.equal(pool.state.emails[0].Status, "SENT");
  assert.equal(pool.state.emails[0].DeliveryStatus, "BOUNCED");
  assert.equal(pool.state.suppressions.includes("person@example.com"), true);
});

test("transient deferred events do not suppress", async () => {
  const pool = createDeliveryPool({
    emails: [
      {
        EmailId: 9,
        ToEmail: "person@example.com",
        SequenceId: 3,
        LeadContactID: 4,
        CompanyId: 11,
        Status: "SENT",
        DeliveryStatus: "UNKNOWN",
      },
    ],
    events: [],
    suppressions: [],
  });
  const result = await ingestDeliveryEvents({
    pool,
    events: [
      {
        provider: "exchange-trace",
        providerEventId: "defer-1",
        type: "deferred",
        bounceClass: "transient",
        occurredAt: "2026-01-03T00:00:00Z",
        emailId: 9,
      },
    ],
  });
  assert.equal(result.applied, 1);
  assert.equal(result.suppressed, 0);
  assert.equal(pool.state.emails[0].DeliveryStatus, "DEFERRED");
  assert.equal(pool.state.suppressions.length, 0);
});
