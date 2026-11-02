import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";

import {
  rememberApolloPhoneReveal,
  resetApolloPhoneRevealStoreForTests,
} from "@/app/api/lib/apollo";
import { POST } from "./route";

const originalEnv = { ...process.env };

beforeEach(() => {
  resetApolloPhoneRevealStoreForTests();
  process.env.APOLLO_WEBHOOK_SECRET = "webhook-secret";
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  resetApolloPhoneRevealStoreForTests();
});

function postWebhook(url: string, body: unknown) {
  return POST(
    new NextRequest(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

test("unauthenticated webhook requests are rejected", async () => {
  const res = await postWebhook("https://crm.example.test/api/apollo/webhook", {
    people: [{ id: "p1" }],
  });
  assert.equal(res.status, 401);
});

test("malformed webhook payloads are rejected", async () => {
  const res = await postWebhook("https://crm.example.test/api/apollo/webhook?token=webhook-secret", {
    hello: true,
  });
  assert.equal(res.status, 400);
});

test("duplicate authenticated webhook deliveries remain idempotent", async () => {
  rememberApolloPhoneReveal({
    requestId: "req-22",
    apolloPersonId: "p22",
    userId: 4,
    companyId: 8,
    phone: null,
    phoneType: null,
    status: "pending",
  });

  const body = {
    request_id: "req-22",
    people: [
      {
        id: "p22",
        phone_numbers: [{ type: "mobile", sanitized_number: "+15558888" }],
      },
    ],
  };
  const first = await postWebhook("https://crm.example.test/api/apollo/webhook?token=webhook-secret", body);
  const second = await postWebhook("https://crm.example.test/api/apollo/webhook?token=webhook-secret", body);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(await first.json(), { ok: true, updated: 1 });
  assert.deepEqual(await second.json(), { ok: true, updated: 1 });
});
