import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  confirmImportJob,
  createImportJob,
  ensureImportSession,
  getImportJob,
  LeadImportApiError,
  messageForImportHttpStatus,
  previewImportJob,
  updateImportJob,
} from "./leadImportApi";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("createImportJob posts the spreadsheet and returns the persistent job", async () => {
  const calls: Array<{ url: string; method?: string }> = [];
  globalThis.fetch = (async (input: any, init?: any) => {
    calls.push({ url: String(input), method: init?.method });
    return jsonResponse({
      job: {
        importId: 41,
        status: "uploaded",
        fileName: "leads.csv",
        mapping: { "Company Name": "companyName" },
        columns: ["Company Name"],
        defaults: {},
        previewRows: [],
        missingRequired: [],
        canConfirm: false,
        result: null,
      },
    });
  }) as typeof fetch;
  const created = await createImportJob({ name: "leads.csv" } as File);
  assert.equal(created.kind, "job");
  if (created.kind !== "job") return;
  assert.equal(created.job.importId, 41);
  assert.equal(calls[0]?.url, "/api/imports/leads");
  assert.equal(calls[0]?.method, "POST");
});

test("multi-sheet discovery is returned without creating an import", async () => {
  globalThis.fetch = (async () =>
    jsonResponse({
      needsSheetSelection: true,
      fileName: "clients.xlsx",
      fileSizeBytes: 2048,
      sheets: [{ name: "Contacts", rowCount: 2, columnCount: 4, importable: true, likelyReferenceSheet: false }],
    })) as typeof fetch;
  const created = await createImportJob({ name: "clients.xlsx" } as File);
  assert.equal(created.kind, "needs_sheet");
  if (created.kind !== "needs_sheet") return;
  assert.equal(created.sheets[0]?.name, "Contacts");
});

test("mapping persistence uses PATCH and preview refresh uses POST", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: any, init?: any) => {
    calls.push(`${init?.method || "GET"} ${String(input)}`);
    return jsonResponse({
      job: { importId: 41, status: init?.method === "POST" ? "previewed" : "uploaded", canConfirm: init?.method === "POST", previewRows: [], mapping: {}, defaults: {}, missingRequired: [], result: null },
    });
  }) as typeof fetch;
  await updateImportJob(41, {
    mapping: {
      "Company Name": "companyName",
      Address: { kind: "new", name: "Address", entityType: "lead", fieldType: "text" },
    },
  });
  await previewImportJob(41);
  assert.deepEqual(calls, ["PATCH /api/imports/leads/41", "POST /api/imports/leads/41/preview"]);
});

test("inaccessible jobs surface a generic 404 without stack traces", async () => {
  globalThis.fetch = (async () => jsonResponse({ error: "Import job was not found." }, 404)) as typeof fetch;
  await assert.rejects(() => getImportJob(99), (err: unknown) => {
    assert.equal(err instanceof LeadImportApiError, true);
    assert.match((err as Error).message, /not found or you do not have access/i);
    assert.equal((err as LeadImportApiError).status, 404);
    return true;
  });
});

test("confirm stays a single POST and completed summaries are returned as-is", async () => {
  globalThis.fetch = (async () =>
    jsonResponse({
      job: {
        importId: 41,
        status: "completed",
        canConfirm: false,
        result: { createdLeads: 1, createdContacts: 1, duplicatesSkipped: 0, invalidSkipped: 0, failed: [], scored: 1 },
        previewRows: [],
        mapping: {},
        defaults: {},
        missingRequired: [],
      },
    })) as typeof fetch;
  const job = await confirmImportJob(41);
  assert.equal(job.status, "completed");
  assert.equal(job.result?.createdLeads, 1);
  assert.equal(messageForImportHttpStatus(401), "Your session expired. Please sign in again.");
  assert.match(messageForImportHttpStatus(401, undefined, 9), /import #9/i);
});

test("ensureImportSession posts to the session keepalive endpoint", async () => {
  const calls: Array<{ url: string; method?: string }> = [];
  globalThis.fetch = (async (input: any, init?: any) => {
    calls.push({ url: String(input), method: init?.method });
    return jsonResponse({ ok: true, refreshed: true });
  }) as typeof fetch;
  await ensureImportSession();
  assert.equal(calls[0]?.url, "/api/auth/session");
  assert.equal(calls[0]?.method, "POST");
});
