function normalizedEnv(value: string | undefined): string {
  return String(value || "").trim();
}

export function getKeycloakRealmBaseUrl(): string | null {
  const baseUrl = normalizedEnv(process.env.KEYCLOAK_URL).replace(/\/$/, "");
  const realm = normalizedEnv(process.env.KEYCLOAK_REALM);
  if (!baseUrl || !realm) return null;
  return `${baseUrl}/realms/${realm}`;
}

export function getKeycloakIssuer(): string | null {
  return getKeycloakRealmBaseUrl();
}

export function getKeycloakJwksUrl(): string | null {
  const realmBaseUrl = getKeycloakRealmBaseUrl();
  if (!realmBaseUrl) return null;
  return `${realmBaseUrl}/protocol/openid-connect/certs`;
}

export function getKeycloakClientId(): string | null {
  const clientId = normalizedEnv(process.env.KEYCLOAK_CLIENT_ID);
  return clientId || null;
}

const realmBaseUrl = getKeycloakRealmBaseUrl() || "";

export const keycloak = {
  authorizeUrl: `${realmBaseUrl}/protocol/openid-connect/auth`,
  tokenUrl: `${realmBaseUrl}/protocol/openid-connect/token`,
  issuer: getKeycloakIssuer,
  jwksUrl: getKeycloakJwksUrl,
  clientId: getKeycloakClientId,
};
