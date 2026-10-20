import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";

import {
  __resetAuthJwksCacheForTests,
  __setAuthTestPoolFactoryForTests,
  resolveAuthUserFromAccessToken,
} from "./auth";

function toBase64Url(input: Buffer | string): string {
  const value = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return value
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createJwt(payload: Record<string, unknown>, privateKey: any, kid = "test-kid"): string {
  const header = { alg: "RS256", typ: "JWT", kid };
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey);
  return `${signingInput}.${toBase64Url(signature)}`;
}

const originalEnv = {
  KEYCLOAK_URL: process.env.KEYCLOAK_URL,
  KEYCLOAK_REALM: process.env.KEYCLOAK_REALM,
  KEYCLOAK_CLIENT_ID: process.env.KEYCLOAK_CLIENT_ID,
};

const originalFetch = global.fetch;

const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = keyPair.publicKey.export({ format: "jwk" }) as Record<string, unknown>;

beforeEach(() => {
  process.env.KEYCLOAK_URL = "https://kc.example.com";
  process.env.KEYCLOAK_REALM = "acarsh";
  process.env.KEYCLOAK_CLIENT_ID = "acarsh-client";
  __resetAuthJwksCacheForTests();
  __setAuthTestPoolFactoryForTests(async () => ({
    query: async (sql: string) => {
      if (String(sql).includes("CompanyUsers")) {
        return [[{ CompanyId: 1, RoleId: 1, IsDefault: 1, IsActive: 1 }]];
      }
      return [
        [
          {
            UserId: 7,
            UserName: "tarun",
            RoleId: 1,
            RoleName: "Manager",
            MatchedBy: "KeycloakId",
          },
        ],
      ];
    },
  }));

  global.fetch = (async () =>
    ({
      ok: true,
      json: async () => ({
        keys: [{ ...jwk, kid: "test-kid", use: "sig", kty: "RSA", alg: "RS256" }],
      }),
    }) as any) as typeof fetch;
});

afterEach(() => {
  process.env.KEYCLOAK_URL = originalEnv.KEYCLOAK_URL;
  process.env.KEYCLOAK_REALM = originalEnv.KEYCLOAK_REALM;
  process.env.KEYCLOAK_CLIENT_ID = originalEnv.KEYCLOAK_CLIENT_ID;
  __setAuthTestPoolFactoryForTests(null);
  __resetAuthJwksCacheForTests();
  global.fetch = originalFetch;
});

test("resolveAuthUserFromAccessToken accepts valid Keycloak JWT", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = createJwt(
    {
      sub: "kc-sub-123",
      preferred_username: "tarun",
      email: "tarun@example.com",
      iss: "https://kc.example.com/realms/acarsh",
      aud: "acarsh-client",
      exp: now + 300,
      iat: now - 10,
    },
    keyPair.privateKey
  );

  const resolved = await resolveAuthUserFromAccessToken(token);
  assert.ok(resolved);
  assert.equal(resolved?.userId, 7);
  assert.equal(resolved?.roleId, 1);
  assert.equal(resolved?.companyId, 1);
});

test("resolveAuthUserFromAccessToken rejects invalid signature", async () => {
  const now = Math.floor(Date.now() / 1000);
  const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const token = createJwt(
    {
      sub: "kc-sub-123",
      preferred_username: "tarun",
      iss: "https://kc.example.com/realms/acarsh",
      aud: "acarsh-client",
      exp: now + 300,
      iat: now - 10,
    },
    otherKey.privateKey
  );

  const resolved = await resolveAuthUserFromAccessToken(token);
  assert.equal(resolved, null);
});

test("resolveAuthUserFromAccessToken rejects expired token", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = createJwt(
    {
      sub: "kc-sub-123",
      preferred_username: "tarun",
      iss: "https://kc.example.com/realms/acarsh",
      aud: "acarsh-client",
      exp: now - 1,
      iat: now - 120,
    },
    keyPair.privateKey
  );

  const resolved = await resolveAuthUserFromAccessToken(token);
  assert.equal(resolved, null);
});

test("resolveAuthUserFromAccessToken rejects invalid issuer", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = createJwt(
    {
      sub: "kc-sub-123",
      preferred_username: "tarun",
      iss: "https://evil.example.com/realms/acarsh",
      aud: "acarsh-client",
      exp: now + 300,
      iat: now - 10,
    },
    keyPair.privateKey
  );

  const resolved = await resolveAuthUserFromAccessToken(token);
  assert.equal(resolved, null);
});

test("resolveAuthUserFromAccessToken rejects invalid audience", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = createJwt(
    {
      sub: "kc-sub-123",
      preferred_username: "tarun",
      iss: "https://kc.example.com/realms/acarsh",
      aud: "different-client",
      exp: now + 300,
      iat: now - 10,
    },
    keyPair.privateKey
  );

  const resolved = await resolveAuthUserFromAccessToken(token);
  assert.equal(resolved, null);
});

