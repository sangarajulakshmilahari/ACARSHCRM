import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mapGraphInboxMessage,
  matchIncomingReplyToSentEmails,
  paginateGraphMessages,
  pauseEnrollmentAfterVerifiedReply,
  processIncomingReplyMessages,
  processSharedMailboxReplies,
  REPLIED_EVENT,
  resolveReplySyncWindow,
  type IncomingGraphMessage,
  type SentEmailMatchRow,
} from "./email-replies";

const sent: SentEmailMatchRow = {
  EmailId: 10,
  SequenceId: 9,
  LeadContactID: 44,
  ToEmail: "prospect@example.com",
  Subject: "Intro",
  ProviderMessageId: "<orig@shared.example>",
  ThreadId: "conv-1",
};

const otherContact: SentEmailMatchRow = {
  ...sent,
  EmailId: 11,
  LeadContactID: 55,
  ThreadId: "conv-2",
  ProviderMessageId: "<other@shared.example>",
};

test("pagination concatenates only the allowed number of pages", () => {
  const pages = [
    [{ id: "a" }, { id: "b" }],
    [{ id: "c" }],
    [{ id: "d" }],
  ];
  assert.deepEqual(
    paginateGraphMessages(pages, 2).map((item) => item.id),
    ["a", "b", "c"]
  );
});

test("exact conversation or In-Reply-To match is high confidence", () => {
  const byThread = matchIncomingReplyToSentEmails(
    {
      id: "in-1",
      conversationId: "conv-1",
      internetMessageId: "<reply@x>",
      subject: "Re: Intro",
      fromAddress: "prospect@example.com",
      receivedDateTime: "2026-01-02T00:00:00Z",
      inReplyTo: null,
      references: [],
    },
    [sent, otherContact]
  );
  const byHeader = matchIncomingReplyToSentEmails(
    {
      id: "in-2",
      conversationId: null,
      internetMessageId: "<reply2@x>",
      subject: "Re: Intro",
      fromAddress: "prospect@example.com",
      receivedDateTime: "2026-01-02T00:00:00Z",
      inReplyTo: "<orig@shared.example>",
      references: ["<orig@shared.example>"],
    },
    [sent, otherContact]
  );
  assert.equal(byThread.confidence, "high");
  if (byThread.confidence === "high") assert.equal(byThread.email.EmailId, 10);
  assert.equal(byHeader.confidence, "high");
});

test("unrelated messages and subject-only similarity are not matches", () => {
  const unrelated = matchIncomingReplyToSentEmails(
    {
      id: "in-3",
      conversationId: "conv-other",
      internetMessageId: "<nope@x>",
      subject: "Intro",
      fromAddress: "prospect@example.com",
      receivedDateTime: "2026-01-02T00:00:00Z",
      inReplyTo: null,
      references: [],
    },
    [sent]
  );
  assert.equal(unrelated.confidence, "none");
});

test("matches across different contacts are ambiguous", () => {
  const ambiguous = matchIncomingReplyToSentEmails(
    {
      id: "in-4",
      conversationId: "conv-1",
      internetMessageId: "<r@x>",
      subject: "Re: Intro",
      fromAddress: "someone@example.com",
      receivedDateTime: "2026-01-02T00:00:00Z",
      inReplyTo: "<other@shared.example>",
      references: [],
    },
    [sent, { ...otherContact, ThreadId: "conv-1" }]
  );
  assert.equal(ambiguous.confidence, "ambiguous");
});

test("Graph header mapping does not keep message bodies", () => {
  const mapped = mapGraphInboxMessage({
    id: "m1",
    conversationId: "c1",
    internetMessageId: "<id@x>",
    subject: "Re: Hello",
    from: { emailAddress: { address: "a@b.com" } },
    receivedDateTime: "2026-01-02T00:00:00Z",
    body: { content: "secret body" },
    internetMessageHeaders: [
      { name: "In-Reply-To", value: "<orig@x>" },
      { name: "References", value: "<orig@x> <mid@x>" },
    ],
  });
  assert.equal(mapped?.id, "m1");
  assert.equal(mapped?.inReplyTo, "<orig@x>");
  assert.equal((mapped as any)?.body, undefined);
});

function createReplyPool(
  state: {
    events: Array<{ EmailId: number; EventType: string; incomingMessageId?: string }>;
    enrollmentStatus: string;
    emails: SentEmailMatchRow[];
  },
  options: { failPauseOnce?: boolean } = {}
) {
  let chain = Promise.resolve();
  let pauseFailed = false;
  function handleQuery(sql: string, params: any[] = []) {
    const text = String(sql);
    if (text.includes("INSERT INTO email_events") && text.includes("NOT EXISTS")) {
      const emailId = Number(params[3]);
      const metadata = JSON.parse(String(params[2] || "{}"));
      const incomingId = String(params[6] || metadata.incomingMessageId);
      const found = state.events.find(
        (event) =>
          event.EmailId === emailId &&
          event.EventType === REPLIED_EVENT &&
          event.incomingMessageId === incomingId
      );
      if (found) return [{ affectedRows: 0 }];
      state.events.push({
        EmailId: emailId,
        EventType: String(params[0]),
        incomingMessageId: incomingId,
      });
      return [{ affectedRows: 1 }];
    }
    if (text.includes("FROM emails") && text.includes("ProviderMessageId")) {
      return [state.emails];
    }
    if (text.includes("FROM email_sequence_contacts") && text.includes("FOR UPDATE")) {
      if (options.failPauseOnce && !pauseFailed) {
        pauseFailed = true;
        throw new Error("pause failed");
      }
      return [[{ SequenceContactId: 1, Status: state.enrollmentStatus }]];
    }
    if (text.includes("SET Status = 'PAUSED'")) {
      if (state.enrollmentStatus !== "ACTIVE") return [{ affectedRows: 0 }];
      state.enrollmentStatus = "PAUSED";
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${text.replace(/\s+/g, " ").slice(0, 180)}`);
  }
  function createConn() {
    let release: (() => void) | undefined;
    return {
      beginTransaction: async () => {
        const previous = chain;
        chain = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
      },
      commit: async () => release?.(),
      rollback: async () => release?.(),
      release: () => undefined,
      query: async (sql: string, params?: any[]) => handleQuery(sql, params),
    };
  }
  return {
    getConnection: async () => createConn(),
    query: async (sql: string, params?: any[]) => handleQuery(sql, params),
    state,
  };
}

test("duplicate incoming messages do not create a second REPLIED event", async () => {
  const incoming: IncomingGraphMessage = {
    id: "in-dup",
    conversationId: "conv-1",
    internetMessageId: "<r@x>",
    subject: "Re: Intro",
    fromAddress: "prospect@example.com",
    receivedDateTime: "2026-01-02T00:00:00Z",
    inReplyTo: "<orig@shared.example>",
    references: [],
  };
  const pool = createReplyPool({
    events: [],
    enrollmentStatus: "ACTIVE",
    emails: [sent],
  });
  const first = await processIncomingReplyMessages({
    pool,
    incoming: [incoming],
    sentEmails: [sent],
  });
  const second = await processIncomingReplyMessages({
    pool,
    incoming: [incoming],
    sentEmails: [sent],
  });
  assert.equal(first.matched, 1);
  assert.equal(second.matched, 0);
  assert.equal(second.skippedDuplicate, 1);
  assert.equal(pool.state.events.filter((event) => event.EventType === REPLIED_EVENT).length, 1);
});

test("verified reply pauses only that contact enrollment", async () => {
  const pool = createReplyPool({
    events: [],
    enrollmentStatus: "ACTIVE",
    emails: [sent],
  });
  const result = await pauseEnrollmentAfterVerifiedReply({
    pool,
    sequenceId: 9,
    leadContactId: 44,
  });
  assert.equal(result.paused, true);
  assert.equal(pool.state.enrollmentStatus, "PAUSED");
});

test("pause-versus-dispatch: paused enrollment is no longer ACTIVE", async () => {
  const pool = createReplyPool({
    events: [],
    enrollmentStatus: "ACTIVE",
    emails: [sent],
  });
  await pauseEnrollmentAfterVerifiedReply({
    pool,
    sequenceId: 9,
    leadContactId: 44,
  });
  const again = await pauseEnrollmentAfterVerifiedReply({
    pool,
    sequenceId: 9,
    leadContactId: 44,
  });
  assert.equal(again.paused, false);
  assert.equal(pool.state.enrollmentStatus, "PAUSED");
});

test("existing REPLIED event still pauses an ACTIVE enrollment", async () => {
  const incoming: IncomingGraphMessage = {
    id: "in-dup",
    conversationId: "conv-1",
    internetMessageId: "<r@x>",
    subject: "Re: Intro",
    fromAddress: "prospect@example.com",
    receivedDateTime: "2026-01-02T00:00:00Z",
    inReplyTo: "<orig@shared.example>",
    references: [],
  };
  const pool = createReplyPool({
    events: [{ EmailId: 10, EventType: REPLIED_EVENT, incomingMessageId: "in-dup" }],
    enrollmentStatus: "ACTIVE",
    emails: [sent],
  });
  const result = await processIncomingReplyMessages({
    pool,
    incoming: [incoming],
    sentEmails: [sent],
  });
  assert.equal(result.matched, 0);
  assert.equal(result.skippedDuplicate, 1);
  assert.equal(result.paused, 1);
  assert.equal(pool.state.enrollmentStatus, "PAUSED");
});

test("one incoming message error does not block later matches", async () => {
  const pool = createReplyPool(
    {
      events: [],
      enrollmentStatus: "ACTIVE",
      emails: [sent],
    },
    { failPauseOnce: true }
  );
  const result = await processIncomingReplyMessages({
    pool,
    incoming: [
      {
        id: "in-err",
        conversationId: "conv-1",
        internetMessageId: "<e@x>",
        subject: "Re: Intro",
        fromAddress: "prospect@example.com",
        receivedDateTime: "2026-01-02T00:00:00Z",
        inReplyTo: "<orig@shared.example>",
        references: [],
      },
      {
        id: "in-ok",
        conversationId: "conv-1",
        internetMessageId: "<ok@x>",
        subject: "Re: Intro",
        fromAddress: "prospect@example.com",
        receivedDateTime: "2026-01-02T00:01:00Z",
        inReplyTo: "<orig@shared.example>",
        references: [],
      },
    ],
    sentEmails: [sent],
  });
  assert.equal(result.skippedError, 1);
  assert.equal(result.matched, 1);
  assert.equal(result.paused, 1);
});

test("reply sync lookback and page caps are bounded", () => {
  const wide = resolveReplySyncWindow({
    lookbackHours: 9999,
    pageSize: 500,
    maxPages: 99,
    nowMs: Date.parse("2026-10-15T12:00:00Z"),
  });
  const narrow = resolveReplySyncWindow({
    lookbackHours: 0,
    pageSize: 0,
    maxPages: 0,
    nowMs: Date.parse("2026-10-15T12:00:00Z"),
  });
  assert.equal(wide.lookbackHours, 168);
  assert.equal(wide.pageSize, 50);
  assert.equal(wide.maxPages, 20);
  assert.equal(wide.maxMessages, 1000);
  assert.equal(wide.sinceIso, "2026-10-08T12:00:00Z");
  assert.equal(narrow.lookbackHours, 1);
  assert.equal(narrow.pageSize, 1);
  assert.equal(narrow.maxPages, 1);
});

test("mocked Graph inbox matches high-confidence replies only", async () => {
  const pool = createReplyPool({
    events: [],
    enrollmentStatus: "ACTIVE",
    emails: [sent],
  });
  const result = await processSharedMailboxReplies({
    pool,
    listInbox: async (input) => {
      assert.match(input.sinceIso, /Z$/);
      return [
        {
          id: "graph-in-1",
          conversationId: "conv-1",
          internetMessageId: "<reply@x>",
          subject: "Re: Intro",
          fromAddress: "prospect@example.com",
          receivedDateTime: "2026-01-02T00:00:00Z",
          inReplyTo: "<orig@shared.example>",
          references: [],
        },
        {
          id: "graph-in-unrelated",
          conversationId: "other-thread",
          internetMessageId: "<nope@x>",
          subject: "Intro",
          fromAddress: "prospect@example.com",
          receivedDateTime: "2026-01-02T00:00:00Z",
          inReplyTo: null,
          references: [],
        },
      ];
    },
  });
  assert.equal(result.matched, 1);
  assert.equal(result.paused, 1);
  assert.equal(result.skippedUncertain, 1);
  assert.equal(pool.state.enrollmentStatus, "PAUSED");
});
