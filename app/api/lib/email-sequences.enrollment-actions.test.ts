import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applySequenceEnrollmentAction,
  claimDueQueuedEmailForDispatch,
  evaluateEnrollmentActionTransition,
} from "./email-sequences";

test("pause is valid only from ACTIVE", () => {
  assert.deepEqual(
    evaluateEnrollmentActionTransition({
      action: "pause",
      enrollmentStatus: "ACTIVE",
      sequenceStatus: "ACTIVE",
    }),
    { ok: true, nextStatus: "PAUSED" }
  );
  assert.equal(
    evaluateEnrollmentActionTransition({
      action: "pause",
      enrollmentStatus: "PAUSED",
      sequenceStatus: "ACTIVE",
    }).ok,
    false
  );
});

test("resume is valid only from PAUSED when the sequence is ACTIVE", () => {
  assert.deepEqual(
    evaluateEnrollmentActionTransition({
      action: "resume",
      enrollmentStatus: "PAUSED",
      sequenceStatus: "ACTIVE",
    }),
    { ok: true, nextStatus: "ACTIVE" }
  );
  assert.equal(
    (
      evaluateEnrollmentActionTransition({
        action: "resume",
        enrollmentStatus: "PAUSED",
        sequenceStatus: "INACTIVE",
      }) as { ok: false; reason: string }
    ).reason,
    "SEQUENCE_NOT_ACTIVE"
  );
  assert.equal(
    (
      evaluateEnrollmentActionTransition({
        action: "resume",
        enrollmentStatus: "COMPLETED",
        sequenceStatus: "ACTIVE",
      }) as { ok: false; reason: string }
    ).reason,
    "INVALID_TRANSITION"
  );
  assert.equal(
    (
      evaluateEnrollmentActionTransition({
        action: "resume",
        enrollmentStatus: "REMOVED",
        sequenceStatus: "ACTIVE",
      }) as { ok: false; reason: string }
    ).reason,
    "INVALID_TRANSITION"
  );
});

test("remove is auditable and cannot be applied twice", () => {
  assert.deepEqual(
    evaluateEnrollmentActionTransition({
      action: "remove",
      enrollmentStatus: "ACTIVE",
      sequenceStatus: "INACTIVE",
    }),
    { ok: true, nextStatus: "REMOVED" }
  );
  assert.equal(
    (
      evaluateEnrollmentActionTransition({
        action: "remove",
        enrollmentStatus: "REMOVED",
        sequenceStatus: "ACTIVE",
      }) as { ok: false; reason: string }
    ).reason,
    "INVALID_TRANSITION"
  );
});

type EnrollmentRow = {
  SequenceContactId: number;
  SequenceId: number;
  LeadContactID: number;
  CurrentStep: number;
  Status: string;
  NextActionAt: string | null;
  LeadId: number;
};

type EmailRow = {
  EmailId: number;
  SequenceId: number | null;
  LeadContactID: number;
  Status: string;
  StepId?: number | null;
};

type FakeDb = {
  sequenceStatus: string;
  enrollments: Record<number, EnrollmentRow>;
  emails: EmailRow[];
  crmContacts: Record<number, boolean>;
  allowLeadAccess: boolean;
  lockHeld: boolean;
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createActionPool(db: FakeDb) {
  let chain = Promise.resolve();

  function handleQuery(sql: string, params: any[] = []) {
    const text = String(sql);

    if (text.includes("FROM email_sequence_contacts esc") && text.includes("FOR UPDATE")) {
      const sequenceContactId = Number(params[0]);
      const sequenceId = Number(params[1]);
      const row = db.enrollments[sequenceContactId];
      if (!row || Number(row.SequenceId) !== sequenceId) return [[]];
      return [
        [
          {
            ...row,
            SequenceStatus: db.sequenceStatus,
            ContactCompanyId: 11,
          },
        ],
      ];
    }

    if (text.includes("FROM Leads l")) {
      return db.allowLeadAccess ? [[{ 1: 1 }]] : [[]];
    }

    if (text.includes("UPDATE email_sequence_contacts") && text.includes("SET Status = 'PAUSED'")) {
      const sequenceContactId = Number(params[0]);
      const row = db.enrollments[sequenceContactId];
      if (!row || String(row.Status).toUpperCase() !== "ACTIVE") return [{ affectedRows: 0 }];
      row.Status = "PAUSED";
      return [{ affectedRows: 1 }];
    }

    if (text.includes("UPDATE email_sequence_contacts") && text.includes("SET Status = 'ACTIVE'")) {
      const sequenceContactId = Number(params[0]);
      const row = db.enrollments[sequenceContactId];
      if (!row || String(row.Status).toUpperCase() !== "PAUSED") return [{ affectedRows: 0 }];
      row.Status = "ACTIVE";
      return [{ affectedRows: 1 }];
    }

    if (text.includes("SET Status = 'REMOVED'")) {
      const sequenceContactId = Number(params[0]);
      const row = db.enrollments[sequenceContactId];
      if (!row || String(row.Status).toUpperCase() === "REMOVED") return [{ affectedRows: 0 }];
      row.Status = "REMOVED";
      row.NextActionAt = null;
      return [{ affectedRows: 1 }];
    }

    if (text.includes("FROM emails") && text.includes("QUEUED") && text.includes("LeadContactID")) {
      const sequenceId = Number(params[0]);
      const leadContactId = Number(params[1]);
      const queued = db.emails.filter(
        (email) =>
          Number(email.SequenceId) === sequenceId &&
          Number(email.LeadContactID) === leadContactId &&
          String(email.Status).toUpperCase() === "QUEUED"
      );
      return [queued.slice(0, 1)];
    }

    if (text.includes("FROM email_sequence_contacts") && text.includes("CurrentStep") && !text.includes("FOR UPDATE")) {
      const sequenceContactId = Number(params[0]);
      const row = db.enrollments[sequenceContactId];
      return row ? [[row]] : [[]];
    }

    if (text.includes("FOR UPDATE") && text.includes("FROM emails e")) {
      const emailId = Number(params[0]);
      const email = db.emails.find((item) => Number(item.EmailId) === emailId);
      if (!email) return [[]];
      const enrollment = Object.values(db.enrollments).find(
        (item) =>
          Number(item.SequenceId) === Number(email.SequenceId || 0) &&
          Number(item.LeadContactID) === Number(email.LeadContactID)
      );
      return [
        [
          {
            EmailId: email.EmailId,
            LeadContactID: email.LeadContactID,
            SequenceId: email.SequenceId,
            StepId: email.StepId ?? 1,
            ToEmail: "test@example.com",
            Subject: "Hello",
            Body: "Body",
            EmailStatus: email.Status,
            SequenceStatus: db.sequenceStatus,
            EnrollmentStatus: enrollment?.Status ?? null,
            CompanyId: 11,
            ContactCompanyId: 11,
            LeadCompanyId: 11,
          },
        ],
      ];
    }

    if (text.includes("SET Status = 'SENDING'")) {
      const emailId = Number(params[0]);
      const email = db.emails.find((item) => Number(item.EmailId) === emailId);
      if (!email || String(email.Status).toUpperCase() !== "QUEUED") return [{ affectedRows: 0 }];
      email.Status = "SENDING";
      return [{ affectedRows: 1 }];
    }

    throw new Error(`Unexpected SQL: ${text.replace(/\s+/g, " ").slice(0, 200)}`);
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
        db.lockHeld = true;
      },
      commit: async () => {
        db.lockHeld = false;
        releaseTxn?.();
      },
      rollback: async () => {
        db.lockHeld = false;
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

function seedDb(): FakeDb {
  return {
    sequenceStatus: "ACTIVE",
    lockHeld: false,
    allowLeadAccess: true,
    crmContacts: { 44: true, 55: true },
    enrollments: {
      1: {
        SequenceContactId: 1,
        SequenceId: 9,
        LeadContactID: 44,
        CurrentStep: 2,
        Status: "ACTIVE",
        NextActionAt: "2026-01-02 10:00:00",
        LeadId: 7,
      },
      2: {
        SequenceContactId: 2,
        SequenceId: 9,
        LeadContactID: 55,
        CurrentStep: 1,
        Status: "ACTIVE",
        NextActionAt: "2026-01-02 11:00:00",
        LeadId: 8,
      },
    },
    emails: [
      { EmailId: 201, SequenceId: 9, LeadContactID: 44, Status: "QUEUED", StepId: 2 },
      { EmailId: 202, SequenceId: 9, LeadContactID: 55, Status: "QUEUED", StepId: 1 },
      { EmailId: 203, SequenceId: 9, LeadContactID: 44, Status: "SENT", StepId: 1 },
    ],
  };
}

const admin = { userId: 1, roleId: 1, companyId: 11 };

test("pausing one contact leaves the other enrollment active", async () => {
  const db = seedDb();
  const result = await applySequenceEnrollmentAction({
    pool: createActionPool(db),
    sequenceId: 9,
    sequenceContactId: 1,
    action: "pause",
    authUser: admin,
  });

  assert.equal(result.status, "PAUSED");
  assert.equal(result.currentStep, 2);
  assert.equal(result.nextActionAt, "2026-01-02 10:00:00");
  assert.equal(db.enrollments[1].Status, "PAUSED");
  assert.equal(db.enrollments[2].Status, "ACTIVE");
  assert.equal(db.emails[0].Status, "QUEUED");
});

test("a paused contact's queued email stays QUEUED and is not claimed", async () => {
  const db = seedDb();
  const pool = createActionPool(db);
  await applySequenceEnrollmentAction({
    pool,
    sequenceId: 9,
    sequenceContactId: 1,
    action: "pause",
    authUser: admin,
  });

  const pausedClaim = await claimDueQueuedEmailForDispatch({
    pool,
    emailId: 201,
    requireScheduledAt: true,
  });
  const otherClaim = await claimDueQueuedEmailForDispatch({
    pool,
    emailId: 202,
    requireScheduledAt: true,
  });

  assert.equal(pausedClaim.skipped, true);
  assert.equal(pausedClaim.reason, "ENROLLMENT_NOT_ACTIVE");
  assert.equal(db.emails[0].Status, "QUEUED");
  assert.equal(otherClaim.skipped, false);
  assert.equal(db.emails[1].Status, "SENDING");
});

test("resume keeps CurrentStep and does not duplicate queued emails", async () => {
  const db = seedDb();
  db.enrollments[1].Status = "PAUSED";
  const pool = createActionPool(db);
  const beforeCount = db.emails.length;

  const result = await applySequenceEnrollmentAction({
    pool,
    sequenceId: 9,
    sequenceContactId: 1,
    action: "resume",
    authUser: admin,
  });

  assert.equal(result.status, "ACTIVE");
  assert.equal(result.currentStep, 2);
  assert.equal(result.pendingQueuedEmail, true);
  assert.equal(result.queuedEmailId, 201);
  assert.equal(db.enrollments[1].CurrentStep, 2);
  assert.equal(db.emails.length, beforeCount);
  assert.equal(db.emails.filter((email) => email.LeadContactID === 44 && email.Status === "QUEUED").length, 1);
});

test("resume is rejected when the parent sequence is not ACTIVE", async () => {
  const db = seedDb();
  db.enrollments[1].Status = "PAUSED";
  db.sequenceStatus = "INACTIVE";

  await assert.rejects(
    () =>
      applySequenceEnrollmentAction({
        pool: createActionPool(db),
        sequenceId: 9,
        sequenceContactId: 1,
        action: "resume",
        authUser: admin,
      }),
    /SEQUENCE_NOT_ACTIVE/
  );
  assert.equal(db.enrollments[1].Status, "PAUSED");
  assert.equal(db.enrollments[1].CurrentStep, 2);
});

test("remove does not delete CRM contacts or email history", async () => {
  const db = seedDb();
  const result = await applySequenceEnrollmentAction({
    pool: createActionPool(db),
    sequenceId: 9,
    sequenceContactId: 1,
    action: "remove",
    authUser: admin,
  });

  assert.equal(result.status, "REMOVED");
  assert.equal(db.crmContacts[44], true);
  assert.equal(db.emails.some((email) => email.EmailId === 201), true);
  assert.equal(db.emails.some((email) => email.EmailId === 203 && email.Status === "SENT"), true);
  assert.equal(db.enrollments[1].Status, "REMOVED");
});

test("unauthorized users cannot modify inaccessible enrollments", async () => {
  const db = seedDb();
  db.allowLeadAccess = false;

  await assert.rejects(
    () =>
      applySequenceEnrollmentAction({
        pool: createActionPool(db),
        sequenceId: 9,
        sequenceContactId: 1,
        action: "pause",
        authUser: { userId: 22, roleId: 2, companyId: 11 },
      }),
    /ACCESS_DENIED/
  );
  assert.equal(db.enrollments[1].Status, "ACTIVE");
});

test("invalid transitions are rejected", async () => {
  const db = seedDb();
  db.enrollments[1].Status = "COMPLETED";

  await assert.rejects(
    () =>
      applySequenceEnrollmentAction({
        pool: createActionPool(db),
        sequenceId: 9,
        sequenceContactId: 1,
        action: "resume",
        authUser: admin,
      }),
    /INVALID_TRANSITION/
  );
});

test("concurrent pause prevents dispatch of that contact's queued email", async () => {
  const db = seedDb();
  const pool = createActionPool(db);

  const pausePromise = (async () => {
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    await wait(25);
    await conn.query(
      `
        UPDATE email_sequence_contacts
        SET Status = 'PAUSED'
        WHERE SequenceContactId = ?
          AND SequenceId = ?
          AND UPPER(Status) = 'ACTIVE'
      `,
      [1, 9]
    );
    await conn.commit();
    conn.release();
  })();

  while (!db.lockHeld) {
    await wait(1);
  }

  const result = await claimDueQueuedEmailForDispatch({
    pool,
    emailId: 201,
    requireScheduledAt: true,
  });
  await pausePromise;

  assert.equal(db.enrollments[1].Status, "PAUSED");
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "ENROLLMENT_NOT_ACTIVE");
  assert.equal(db.emails[0].Status, "QUEUED");
});
