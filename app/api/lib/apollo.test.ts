import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";

import {
  applyApolloPhoneWebhook,
  buildApolloMatchPayload,
  buildApolloSearchPayload,
  buildApolloWebhookResultPath,
  canRevealPhoneNumbers,
  canUseApolloPhoneWebhook,
  extractApolloRequestIdFromRawJson,
  getPhoneRevealMode,
  isValidApolloRequestId,
  parseApolloJson,
  setApolloSleepForTests,
  enrichApolloPerson,
  extractPhone,
  getApolloPhoneRevealStatus,
  isLikelyDomain,
  mapPerson,
  rememberApolloPhoneReveal,
  resetApolloPhoneRevealStoreForTests,
  searchApolloPeople,
  verifyApolloWebhookToken,
} from "./apollo";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  resetApolloPhoneRevealStoreForTests();
  process.env.APOLLO_API_KEY = "test-apollo-key";
  process.env.APOLLO_BASE_URL = "https://api.apollo.io";
  delete process.env.APOLLO_REVEAL_PHONE_NUMBER;
  delete process.env.APOLLO_WEBHOOK_URL;
  delete process.env.APOLLO_WEBHOOK_SECRET;
  globalThis.fetch = (async () => {
    throw new Error("Unexpected live fetch in Apollo unit test");
  }) as typeof fetch;
  setApolloSleepForTests(async () => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  resetApolloPhoneRevealStoreForTests();
  setApolloSleepForTests(null);
});

test("company names are not treated as domains unless they look like hostnames", () => {
  assert.equal(isLikelyDomain("Adroitent"), false);
  assert.equal(isLikelyDomain("Adroitent Inc"), false);
  assert.equal(isLikelyDomain("adroitent.ai"), true);
  assert.equal(isLikelyDomain("https://www.adroitent.ai/about"), true);
});

test("search payload uses documented People API Search fields", () => {
  const payload = buildApolloSearchPayload({
    contactName: "Ada Lovelace",
    companyName: "Analytical Engines",
    contactTitle: "CTO",
    linkedinUrl: "https://www.linkedin.com/in/ada",
  });
  assert.deepEqual(payload, {
    q_keywords: "Ada Lovelace Analytical Engines",
    person_titles: ["CTO"],
    page: 1,
    per_page: 10,
  });
  assert.equal("q_person_name" in payload, false);
  assert.equal("person_linkedin_url" in payload, false);
  assert.equal("q_organization_name" in payload, false);
});

test("search payload sends organization domains only for real domains", () => {
  const payload = buildApolloSearchPayload({
    contactName: "Ada Lovelace",
    companyName: "analyticalengines.com",
  });
  assert.deepEqual(payload.q_organization_domains, ["analyticalengines.com"]);
  assert.equal(payload.q_keywords, "Ada Lovelace");
});

test("match payload prefers id or linkedin and omits invalid domains", () => {
  const payload = buildApolloMatchPayload({
    apolloPersonId: "person-1",
    linkedinUrl: "https://www.linkedin.com/in/ada",
    contactName: "Ada Lovelace",
    companyName: "Analytical Engines",
    companyDomain: "not a domain",
  });
  assert.equal(payload.id, "person-1");
  assert.equal(payload.linkedin_url, "https://www.linkedin.com/in/ada");
  assert.equal(payload.organization_name, "Analytical Engines");
  assert.equal(payload.domain, undefined);
  assert.equal(payload.reveal_phone_number, undefined);
  assert.equal(payload.poll_only, undefined);
  assert.equal("person_id" in payload, false);
});

test("signed 64-bit Apollo request IDs stay exact through parsing and URL construction", () => {
  const negativeId = "-8148263167037577234";
  const positiveId = "9223372036854775807";
  const rawNegative = `{"request_id": ${negativeId}, "status":"pending"}`;
  const rawPositive = `{"request_id": ${positiveId}, "status":"pending"}`;

  assert.equal(extractApolloRequestIdFromRawJson(rawNegative), negativeId);
  assert.equal(parseApolloJson(rawNegative).request_id, negativeId);
  assert.notEqual(String(JSON.parse(rawNegative).request_id), negativeId);
  assert.equal(isValidApolloRequestId(negativeId), true);
  assert.equal(isValidApolloRequestId(JSON.parse(rawNegative).request_id), false);
  assert.equal(
    buildApolloWebhookResultPath(negativeId),
    `/api/v1/webhook_result/${encodeURIComponent(negativeId)}`,
  );

  assert.equal(extractApolloRequestIdFromRawJson(rawPositive), positiveId);
  assert.equal(parseApolloJson(rawPositive).request_id, positiveId);
  assert.notEqual(String(JSON.parse(rawPositive).request_id), positiveId);
  assert.equal(
    buildApolloWebhookResultPath(positiveId),
    `/api/v1/webhook_result/${encodeURIComponent(positiveId)}`,
  );
});

test("poll URL uses the exact 64-bit request_id from the match response text", async () => {
  process.env.APOLLO_REVEAL_PHONE_NUMBER = "true";
  const exactId = "-8148263167037577234";
  let seenPollUrl = "";
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    if (url.includes("/people/match")) {
      return new Response(
        `{"request_id": ${exactId}, "person":{"id":"p1","name":"Ada Lovelace","email":"ada@engines.test"}}`,
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    seenPollUrl = url;
    assert.match(url, /\/api\/v1\/webhook_result\/-8148263167037577234$/);
    assert.equal(url.includes("-8148263167037577000"), false);
    return jsonResponse(404, { error: "result_pending", retry_after_seconds: 0 });
  }) as typeof fetch;

  const person = await enrichApolloPerson({
    apolloPersonId: "p1",
    revealPhoneNumber: true,
  });
  assert.match(seenPollUrl, /\/api\/v1\/webhook_result\/-8148263167037577234$/);
  assert.equal(person?.requestId, exactId);
  assert.equal(person?.phoneStatus, "timeout");
});

test("extractPhone prefers mobile/direct-dial objects and never stringifies objects", () => {
  const extracted = extractPhone({
    phone_numbers: [
      { type: "work", raw_number: "+1 555 0100", sanitized_number: "+15550100" },
      { type: "mobile", raw_number: "+1 555 0199", sanitized_number: "+15550199" },
    ],
  });
  assert.equal(extracted.phone, "+15550199");
  assert.equal(extracted.type, "mobile");
  assert.equal(extractPhone({ phone_numbers: [{ nested: true }] }).phone, null);
  assert.equal(mapPerson({ id: "p1", phone_numbers: [{ nested: true }] })?.phone, null);
});

test("successful person search maps people without treating missing emails as success data", async () => {
  globalThis.fetch = (async (input: any) => {
    assert.match(String(input), /\/api\/v1\/mixed_people\/api_search$/);
    return jsonResponse(200, {
      people: [
        {
          id: "p1",
          name: "Ada Lovelace",
          title: "CTO",
          organization: { id: "o1", name: "Analytical Engines" },
        },
      ],
    });
  }) as typeof fetch;

  const results = await searchApolloPeople({ contactName: "Ada", companyName: "Analytical Engines" });
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "Ada Lovelace");
  assert.equal(results[0].workEmail, null);
  assert.equal(results[0].phone, null);
  assert.equal(results[0].source, "search");
});

test("no matching person returns an empty list", async () => {
  globalThis.fetch = (async () => jsonResponse(200, { people: [] })) as typeof fetch;
  const results = await searchApolloPeople({ contactName: "Nobody" });
  assert.equal(results.length, 0);
});

test("invalid Apollo credentials surface as 401", async () => {
  globalThis.fetch = (async () => jsonResponse(401, { error: "Invalid API key" })) as typeof fetch;
  await assert.rejects(() => searchApolloPeople({ contactName: "Ada" }), (error: any) => {
    assert.equal(error.statusCode, 401);
    assert.match(String(error.userMessage), /Invalid Apollo API key/);
    return true;
  });
});

test("rate limiting surfaces as 429", async () => {
  globalThis.fetch = (async () => jsonResponse(429, { message: "Too many requests" })) as typeof fetch;
  await assert.rejects(() => searchApolloPeople({ contactName: "Ada" }), (error: any) => {
    assert.equal(error.statusCode, 429);
    return true;
  });
});

test("unsupported search input without identifiers is rejected", async () => {
  await assert.rejects(
    () => searchApolloPeople({ contactTitle: "CTO" }),
    (error: any) => {
      assert.equal(error.statusCode, 400);
      return true;
    },
  );
});

test("linkedin-only search uses people match instead of repeating a search-only lookup", async () => {
  globalThis.fetch = (async (input: any) => {
    assert.match(String(input), /\/api\/v1\/people\/match$/);
    return jsonResponse(200, {
      person: {
        id: "p9",
        name: "Ada Lovelace",
        email: "ada@engines.test",
        linkedin_url: "https://www.linkedin.com/in/ada",
      },
    });
  }) as typeof fetch;

  const results = await searchApolloPeople({
    linkedinUrl: "https://www.linkedin.com/in/ada",
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].source, "match");
  assert.equal(results[0].workEmail, "ada@engines.test");
});

test("successful enrichment maps work email and does not invent a phone number", async () => {
  globalThis.fetch = (async (input: any, init?: any) => {
    assert.match(String(input), /\/api\/v1\/people\/match$/);
    const body = JSON.parse(String(init?.body || "{}"));
    assert.equal(body.id, "p1");
    assert.equal(body.reveal_phone_number, undefined);
    assert.equal(body.poll_only, undefined);
    return jsonResponse(200, {
      person: {
        id: "p1",
        name: "Ada Lovelace",
        email: "ada@engines.test",
        email_status: "verified",
        title: "CTO",
      },
    });
  }) as typeof fetch;

  const person = await enrichApolloPerson({ apolloPersonId: "p1" });
  assert.equal(person?.workEmail, "ada@engines.test");
  assert.equal(person?.phone, null);
  assert.equal(person?.phoneStatus, "not_requested");
});

test("phone reveal is disabled by default in source even if a webhook exists", () => {
  process.env.APOLLO_WEBHOOK_URL = "https://crm.example.test/api/apollo/webhook";
  process.env.APOLLO_WEBHOOK_SECRET = "secret";
  assert.equal(canRevealPhoneNumbers(), false);
});

test("phone reveal can be enabled by server flag without a public webhook", () => {
  process.env.APOLLO_REVEAL_PHONE_NUMBER = "true";
  process.env.APOLLO_WEBHOOK_URL = "https://localhost:3001/api/apollo/webhook";
  process.env.APOLLO_WEBHOOK_SECRET = "secret";
  assert.equal(canRevealPhoneNumbers(), true);
  assert.equal(canUseApolloPhoneWebhook(), false);
  assert.equal(getPhoneRevealMode(), "poll");
});

test("explicit enrichment with reveal returns a found phone from the match response", async () => {
  process.env.APOLLO_REVEAL_PHONE_NUMBER = "true";
  globalThis.fetch = (async (_input: any, init?: any) => {
    const body = JSON.parse(String(init?.body || "{}"));
    assert.equal(body.reveal_phone_number, true);
    assert.equal(body.poll_only, true);
    assert.equal(body.webhook_url, undefined);
    return jsonResponse(200, {
      person: {
        id: "p1",
        name: "Ada Lovelace",
        email: "ada@engines.test",
        phone_numbers: [{ type: "mobile", sanitized_number: "+15550199" }],
      },
    });
  }) as typeof fetch;

  const person = await enrichApolloPerson({
    apolloPersonId: "p1",
    revealPhoneNumber: true,
  });
  assert.equal(person?.phone, "+15550199");
  assert.equal(person?.phoneType, "mobile");
  assert.equal(person?.phoneStatus, "found");
});

test("explicit enrichment with reveal and no phone is unavailable without a public webhook", async () => {
  process.env.APOLLO_REVEAL_PHONE_NUMBER = "true";
  globalThis.fetch = (async () =>
    jsonResponse(200, {
      person: { id: "p1", name: "Ada Lovelace", email: "ada@engines.test" },
    })) as typeof fetch;

  const person = await enrichApolloPerson({
    apolloPersonId: "p1",
    revealPhoneNumber: true,
  });
  assert.equal(person?.phone, null);
  assert.equal(person?.phoneStatus, "unavailable");
});

test("poll_only enrichment follows request_id until a mobile number is returned", async () => {
  process.env.APOLLO_REVEAL_PHONE_NUMBER = "true";
  let calls = 0;
  globalThis.fetch = (async (input: any, init?: any) => {
    calls += 1;
    if (calls === 1) {
      const body = JSON.parse(String(init?.body || "{}"));
      assert.match(String(input), /\/api\/v1\/people\/match$/);
      assert.equal(body.reveal_phone_number, true);
      assert.equal(body.poll_only, true);
      assert.equal(body.webhook_url, undefined);
      return jsonResponse(200, {
        status: "pending",
        request_id: "req-poll-1",
        retry_after_seconds: 0,
        person: { id: "p1", name: "Ada Lovelace", email: "ada@engines.test" },
      });
    }
    assert.equal(init?.method || "GET", "GET");
    assert.match(String(input), /\/api\/v1\/webhook_result\/req-poll-1$/);
    return jsonResponse(200, {
      webhook_result: {
        people: [
          {
            id: "p1",
            name: "Ada Lovelace",
            email: "ada@engines.test",
            phone_numbers: [{ type: "mobile", sanitized_number: "+15550199" }],
          },
        ],
      },
    });
  }) as typeof fetch;

  const person = await enrichApolloPerson({
    apolloPersonId: "p1",
    revealPhoneNumber: true,
    actor: { userId: 11, companyId: 22 },
  });
  assert.equal(calls, 2);
  assert.equal(person?.phone, "+15550199");
  assert.equal(person?.phoneStatus, "found");
});

test("poll_only enrichment times out when Apollo stays pending", async () => {
  process.env.APOLLO_REVEAL_PHONE_NUMBER = "true";
  globalThis.fetch = (async (input: any, init?: any) => {
    if (String(input).includes("/people/match")) {
      return jsonResponse(200, {
        status: "pending",
        request_id: "req-poll-timeout",
        retry_after_seconds: 0,
        person: { id: "p1", name: "Ada Lovelace", email: "ada@engines.test" },
      });
    }
    assert.match(String(input), /\/api\/v1\/webhook_result\/req-poll-timeout$/);
    return jsonResponse(200, { error: "result_pending", retry_after_seconds: 0 });
  }) as typeof fetch;

  const person = await enrichApolloPerson({
    apolloPersonId: "p1",
    revealPhoneNumber: true,
  });
  assert.equal(person?.phone, null);
  assert.equal(person?.phoneStatus, "timeout");
});

test("invalid Apollo request IDs are rejected", () => {
  assert.equal(isValidApolloRequestId("req-1"), true);
  assert.equal(isValidApolloRequestId("req-poll-1"), true);
  assert.equal(isValidApolloRequestId("bad id"), false);
  assert.equal(isValidApolloRequestId(""), false);
});

test("poll webhook result maps unknown request IDs to 404", async () => {
  process.env.APOLLO_REVEAL_PHONE_NUMBER = "true";
  globalThis.fetch = (async (input: any) => {
    if (String(input).includes("/people/match")) {
      return jsonResponse(200, {
        request_id: "req-unknown",
        person: { id: "p1", name: "Ada Lovelace" },
      });
    }
    return jsonResponse(404, { error: "request_id_unknown" });
  }) as typeof fetch;

  await assert.rejects(
    () => enrichApolloPerson({ apolloPersonId: "p1", revealPhoneNumber: true }),
    (error: any) => {
      assert.equal(error.statusCode, 404);
      assert.match(String(error.userMessage), /unknown/);
      return true;
    },
  );
});

test("poll_only enrichment surfaces Apollo 403 and 5xx errors", async () => {
  process.env.APOLLO_REVEAL_PHONE_NUMBER = "true";
  globalThis.fetch = (async () => jsonResponse(403, { error: "forbidden" })) as typeof fetch;
  await assert.rejects(
    () => enrichApolloPerson({ apolloPersonId: "p1", revealPhoneNumber: true }),
    (error: any) => {
      assert.equal(error.statusCode, 403);
      return true;
    },
  );

  globalThis.fetch = (async () => jsonResponse(500, { error: "boom" })) as typeof fetch;
  await assert.rejects(
    () => enrichApolloPerson({ apolloPersonId: "p1", revealPhoneNumber: true }),
    (error: any) => {
      assert.equal(error.statusCode, 502);
      return true;
    },
  );
});

test("match payload refuses reveal without poll_only or webhook", () => {
  assert.throws(
    () =>
      buildApolloMatchPayload(
        { apolloPersonId: "p1" },
        { revealPhoneNumber: true },
      ),
    /poll_only or a public webhook URL/,
  );
});

test("search does not request phone reveal", async () => {
  process.env.APOLLO_REVEAL_PHONE_NUMBER = "true";
  globalThis.fetch = (async (input: any, init?: any) => {
    assert.match(String(input), /\/api\/v1\/mixed_people\/api_search$/);
    const body = JSON.parse(String(init?.body || "{}"));
    assert.equal(body.reveal_phone_number, undefined);
    return jsonResponse(200, { people: [{ id: "p1", name: "Ada Lovelace" }] });
  }) as typeof fetch;

  const results = await searchApolloPeople({ contactName: "Ada" });
  assert.equal(results.length, 1);
  assert.equal(results[0].phone, null);
});

test("phone reveal pending is recorded for the requesting user only", async () => {
  process.env.APOLLO_REVEAL_PHONE_NUMBER = "true";
  process.env.APOLLO_WEBHOOK_URL = "https://crm.example.test/api/apollo/webhook";
  process.env.APOLLO_WEBHOOK_SECRET = "webhook-secret";

  globalThis.fetch = (async (_input: any, init?: any) => {
    const body = JSON.parse(String(init?.body || "{}"));
    assert.equal(body.reveal_phone_number, true);
    assert.equal(body.poll_only, undefined);
    assert.match(String(body.webhook_url), /token=webhook-secret/);
    return jsonResponse(200, {
      request_id: "req-1",
      person: { id: "p1", name: "Ada Lovelace", email: "ada@engines.test" },
    });
  }) as typeof fetch;

  const person = await enrichApolloPerson({
    apolloPersonId: "p1",
    revealPhoneNumber: true,
    actor: { userId: 11, companyId: 22 },
  });
  assert.equal(person?.phoneStatus, "pending");
  assert.equal(person?.requestId, "req-1");

  const own = getApolloPhoneRevealStatus({ requestId: "req-1", userId: 11, companyId: 22 });
  assert.equal(own?.status, "pending");
  const otherUser = getApolloPhoneRevealStatus({ requestId: "req-1", userId: 99, companyId: 22 });
  assert.equal(otherUser, null);
  const otherCompany = getApolloPhoneRevealStatus({ requestId: "req-1", userId: 11, companyId: 33 });
  assert.equal(otherCompany, null);
});

test("webhook delivery updates a pending reveal idempotently", () => {
  rememberApolloPhoneReveal({
    requestId: "req-1",
    apolloPersonId: "p1",
    userId: 11,
    companyId: 22,
    phone: null,
    phoneType: null,
    status: "pending",
  });

  const payload = {
    request_id: "req-1",
    people: [
      {
        id: "p1",
        phone_numbers: [{ type: "mobile", sanitized_number: "+15550199", raw_number: "+1 555 0199" }],
      },
    ],
  };
  const first = applyApolloPhoneWebhook(payload);
  const second = applyApolloPhoneWebhook(payload);
  assert.equal(first.ok, true);
  assert.equal(first.updated, 1);
  assert.equal(second.ok, true);
  assert.equal(second.updated, 1);
  const record = getApolloPhoneRevealStatus({ requestId: "req-1", userId: 11, companyId: 22 });
  assert.equal(record?.status, "found");
  assert.equal(record?.phone, "+15550199");
});

test("webhook payload for an unknown person is ignored", () => {
  const result = applyApolloPhoneWebhook({
    request_id: "missing",
    people: [{ id: "p-unknown", phone_numbers: [{ sanitized_number: "+15550000" }] }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.updated, 0);
});

test("webhook token verification rejects missing or wrong tokens", () => {
  process.env.APOLLO_WEBHOOK_SECRET = "expected-secret";
  const valid = new NextRequest("https://crm.example.test/api/apollo/webhook?token=expected-secret");
  const missing = new NextRequest("https://crm.example.test/api/apollo/webhook");
  const wrong = new NextRequest("https://crm.example.test/api/apollo/webhook?token=other");
  assert.equal(verifyApolloWebhookToken(valid), true);
  assert.equal(verifyApolloWebhookToken(missing), false);
  assert.equal(verifyApolloWebhookToken(wrong), false);
});

test("network timeouts become a 504 Apollo error", async () => {
  globalThis.fetch = (async () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  }) as typeof fetch;

  await assert.rejects(() => searchApolloPeople({ contactName: "Ada" }), (error: any) => {
    assert.equal(error.statusCode, 504);
    return true;
  });
});
