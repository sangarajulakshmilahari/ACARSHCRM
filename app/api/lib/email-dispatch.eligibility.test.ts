import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  claimDueQueuedEmailForDispatch,
  evaluateSequenceDispatchEligibility,
  pauseActiveSequenceEnrollments,
  releaseClaimedSequenceEmailIfIneligible,
} from "./email-sequences";

const originalLog = console.log;

before(() => {
  console.log = () => undefined;
});

after(() => {
  console.log = originalLog;
});

test("one-off emails remain eligible without sequence state", () => {
  assert.deepEqual(
    evaluateSequenceDispatchEligibility({
      sequenceId: null,
      sequenceStatus: "INACTIVE",
      enrollmentStatus: "PAUSED",
    }),
    { eligible: true }
  );
});

test("active sequence and active enrollment are eligible", () => {
  assert.deepEqual(
    evaluateSequenceDispatchEligibility({
      sequenceId: 12,
      sequenceStatus: "ACTIVE",
      enrollmentStatus: "ACTIVE",
    }),
    { eligible: true }
  );
});

test("inactive or draft sequences are not eligible", () => {
  assert.equal(
    evaluateSequenceDispatchEligibility({
      sequenceId: 12,
      sequenceStatus: "INACTIVE",
      enrollmentStatus: "ACTIVE",
    }).reason,
    "SEQUENCE_NOT_ACTIVE"
  );
  assert.equal(
    evaluateSequenceDispatchEligibility({
      sequenceId: 12,
      sequenceStatus: "DRAFT",
      enrollmentStatus: "ACTIVE",
    }).reason,
    "SEQUENCE_NOT_ACTIVE"
  );
});

test("paused or completed enrollments are not eligible", () => {
  assert.equal(
    evaluateSequenceDispatchEligibility({
      sequenceId: 12,
      sequenceStatus: "ACTIVE",
      enrollmentStatus: "PAUSED",
    }).reason,
    "ENROLLMENT_NOT_ACTIVE"
  );
  assert.equal(
    evaluateSequenceDispatchEligibility({
      sequenceId: 12,
      sequenceStatus: "ACTIVE",
      enrollmentStatus: "COMPLETED",
    }).reason,
    "ENROLLMENT_NOT_ACTIVE"
  );
});

test("missing enrollment is not eligible", () => {
  assert.equal(
    evaluateSequenceDispatchEligibility({
      sequenceId: 12,
      sequenceStatus: "ACTIVE",
      enrollmentStatus: null,
    }).reason,
    "ENROLLMENT_NOT_FOUND"
  );
});

type FakeState = {
  lockHeld: boolean;
  emailStatus: string;
  sequenceStatus: string;
  enrollmentStatus: string | null;
  sequenceId: number | null;
  leadContactId: number;
  due: boolean;
  sendingUpdates: number;
  queuedReverts: number;
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFakePool(state: FakeState) {
  let chain = Promise.resolve();

  function handleQuery(sql: string, params: any[] = []) {
    const text = String(sql);

    if (text.includes("FOR UPDATE") && text.includes("FROM emails")) {
      return [
        [
          {
            EmailId: Number(params[0] || 1),
            LeadContactID: state.leadContactId,
            SequenceId: state.sequenceId,
            StepId: state.sequenceId ? 1 : null,
            ToEmail: "test@example.com",
            Subject: "Hello",
            Body: "Body",
            EmailStatus: state.emailStatus,
            SequenceStatus: state.sequenceStatus,
            EnrollmentStatus: state.enrollmentStatus,
            CompanyId: 11,
            ContactCompanyId: 11,
            LeadCompanyId: 11,
          },
        ],
      ];
    }

    if (text.includes("SET Status = 'SENDING'")) {
      const dueOk = state.due || !text.includes("ScheduledAt IS NOT NULL");
      if (state.emailStatus === "QUEUED" && dueOk) {
        state.emailStatus = "SENDING";
        state.sendingUpdates += 1;
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 0 }];
    }

    if (text.includes("FROM email_sequences s") && text.includes("EnrollmentStatus")) {
      return [
        [
          {
            SequenceStatus: state.sequenceStatus,
            EnrollmentStatus: state.enrollmentStatus,
          },
        ],
      ];
    }

    if (text.includes("SET Status = 'QUEUED'") && text.includes("SENDING")) {
      if (state.emailStatus === "SENDING") {
        state.emailStatus = "QUEUED";
        state.queuedReverts += 1;
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 0 }];
    }

    if (text.includes("UPDATE email_sequence_contacts") && text.includes("PAUSED")) {
      if (String(state.enrollmentStatus || "").toUpperCase() === "ACTIVE") {
        state.enrollmentStatus = "PAUSED";
      }
      return [{ affectedRows: 1 }];
    }

    throw new Error(`Unexpected SQL: ${text.replace(/\s+/g, " ").slice(0, 180)}`);
  }

  function createConn() {
    let releaseTxn: (() => void) | undefined;
    return {
      beginTransaction: async () => {
        const previous = chain;
        chain = new Promise<void>((resolve) => {
          releaseTxn = resolve;
        });
        await previous;
        state.lockHeld = true;
      },
      commit: async () => {
        state.lockHeld = false;
        releaseTxn?.();
      },
      rollback: async () => {
        state.lockHeld = false;
        releaseTxn?.();
      },
      release: () => undefined,
      query: async (sql: string, params?: any[]) => handleQuery(sql, params),
    };
  }

  return {
    getConnection: async () => createConn(),
    query: async (sql: string, params?: any[]) => handleQuery(sql, params),
  };
}

test("claim skips inactive sequence emails and leaves them queued", async () => {
  const state: FakeState = {
    lockHeld: false,
    emailStatus: "QUEUED",
    sequenceStatus: "INACTIVE",
    enrollmentStatus: "ACTIVE",
    sequenceId: 9,
    leadContactId: 44,
    due: true,
    sendingUpdates: 0,
    queuedReverts: 0,
  };
  const result = await claimDueQueuedEmailForDispatch({
    pool: createFakePool(state),
    emailId: 101,
    requireScheduledAt: true,
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "SEQUENCE_NOT_ACTIVE");
  assert.equal(state.emailStatus, "QUEUED");
  assert.equal(state.sendingUpdates, 0);
});

test("claim skips paused enrollments and leaves them queued", async () => {
  const state: FakeState = {
    lockHeld: false,
    emailStatus: "QUEUED",
    sequenceStatus: "ACTIVE",
    enrollmentStatus: "PAUSED",
    sequenceId: 9,
    leadContactId: 44,
    due: true,
    sendingUpdates: 0,
    queuedReverts: 0,
  };
  const result = await claimDueQueuedEmailForDispatch({
    pool: createFakePool(state),
    emailId: 102,
    requireScheduledAt: true,
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "ENROLLMENT_NOT_ACTIVE");
  assert.equal(state.emailStatus, "QUEUED");
});

test("claim sends active sequence enrollments", async () => {
  const state: FakeState = {
    lockHeld: false,
    emailStatus: "QUEUED",
    sequenceStatus: "ACTIVE",
    enrollmentStatus: "ACTIVE",
    sequenceId: 9,
    leadContactId: 44,
    due: true,
    sendingUpdates: 0,
    queuedReverts: 0,
  };
  const result = await claimDueQueuedEmailForDispatch({
    pool: createFakePool(state),
    emailId: 103,
    requireScheduledAt: true,
  });

  assert.equal(result.skipped, false);
  assert.equal(result.row?.SequenceId, 9);
  assert.equal(state.emailStatus, "SENDING");
  assert.equal(state.sendingUpdates, 1);
});

test("claim still dispatches queued one-off emails", async () => {
  const state: FakeState = {
    lockHeld: false,
    emailStatus: "QUEUED",
    sequenceStatus: "INACTIVE",
    enrollmentStatus: "PAUSED",
    sequenceId: null,
    leadContactId: 44,
    due: true,
    sendingUpdates: 0,
    queuedReverts: 0,
  };
  const result = await claimDueQueuedEmailForDispatch({
    pool: createFakePool(state),
    emailId: 104,
    requireScheduledAt: true,
  });

  assert.equal(result.skipped, false);
  assert.equal(result.row?.SequenceId, null);
  assert.equal(state.emailStatus, "SENDING");
});

test("pre-send recheck restores QUEUED when enrollment is paused after claim", async () => {
  const state: FakeState = {
    lockHeld: false,
    emailStatus: "SENDING",
    sequenceStatus: "ACTIVE",
    enrollmentStatus: "PAUSED",
    sequenceId: 9,
    leadContactId: 44,
    due: true,
    sendingUpdates: 0,
    queuedReverts: 0,
  };

  const eligibility = await releaseClaimedSequenceEmailIfIneligible({
    pool: createFakePool(state),
    emailId: 105,
    sequenceId: 9,
    leadContactId: 44,
  });

  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, "ENROLLMENT_NOT_ACTIVE");
  assert.equal(state.emailStatus, "QUEUED");
  assert.equal(state.queuedReverts, 1);
});

test("concurrent pause wins over dispatch while the email is still queued", async () => {
  const state: FakeState = {
    lockHeld: false,
    emailStatus: "QUEUED",
    sequenceStatus: "ACTIVE",
    enrollmentStatus: "ACTIVE",
    sequenceId: 9,
    leadContactId: 44,
    due: true,
    sendingUpdates: 0,
    queuedReverts: 0,
  };
  const pool = createFakePool(state);

  const pausePromise = (async () => {
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    await wait(25);
    await pauseActiveSequenceEnrollments(conn, 9);
    await conn.commit();
    conn.release();
  })();

  while (!state.lockHeld) {
    await wait(1);
  }

  const result = await claimDueQueuedEmailForDispatch({
    pool,
    emailId: 106,
    requireScheduledAt: true,
  });
  await pausePromise;

  assert.equal(state.enrollmentStatus, "PAUSED");
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "ENROLLMENT_NOT_ACTIVE");
  assert.equal(state.emailStatus, "QUEUED");
  assert.equal(state.sendingUpdates, 0);
});
