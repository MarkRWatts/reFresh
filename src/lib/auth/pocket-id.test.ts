import { describe, expect, it, vi } from "vitest";
import {
  POCKET_ID_PROVIDER_ID,
  REQUIRED_GROUP,
  getPocketIdUserInfo,
  hasRequiredGroup,
  pocketIdConfig,
} from "./pocket-id";

function fakeJwt(claims: Record<string, unknown>): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.sig`;
}

describe("pocketIdConfig", () => {
  it("is off unless both the client ID and secret are set, so dev works without Pocket ID", () => {
    expect(pocketIdConfig({})).toBeNull();
    expect(pocketIdConfig({ POCKET_ID_CLIENT_ID: "refresh" })).toBeNull();
    expect(pocketIdConfig({ POCKET_ID_CLIENT_SECRET: "s3cret" })).toBeNull();
    expect(pocketIdConfig({ POCKET_ID_CLIENT_ID: " ", POCKET_ID_CLIENT_SECRET: "s3cret" })).toBeNull();
  });

  it("registers Pocket ID over OIDC discovery with PKCE, asking for groups", () => {
    const env = { POCKET_ID_CLIENT_ID: "refresh", POCKET_ID_CLIENT_SECRET: "s3cret" };
    expect(pocketIdConfig(env)).toEqual(
      expect.objectContaining({
        providerId: POCKET_ID_PROVIDER_ID,
        discoveryUrl: "https://id.markrwatts.com/.well-known/openid-configuration",
        clientId: "refresh",
        clientSecret: "s3cret",
        scopes: ["openid", "email", "profile", "groups"],
        pkce: true,
      }),
    );
  });
});

describe("hasRequiredGroup", () => {
  it("admits a profile whose groups claim includes the app's group", () => {
    expect(REQUIRED_GROUP).toBe("refresh");
    expect(hasRequiredGroup({ groups: ["admins", "refresh"] })).toBe(true);
  });

  it("refuses anything else", () => {
    expect(hasRequiredGroup({ groups: ["admins"] })).toBe(false);
    expect(hasRequiredGroup({ groups: [] })).toBe(false);
    expect(hasRequiredGroup({ groups: "refresh" })).toBe(false);
    expect(hasRequiredGroup({ groups: ["Refresh"] })).toBe(false);
    expect(hasRequiredGroup({})).toBe(false);
    expect(hasRequiredGroup(undefined)).toBe(false);
    expect(hasRequiredGroup(null)).toBe(false);
  });
});

describe("getPocketIdUserInfo", () => {
  const idClaims = {
    sub: "sub-1",
    email: "markrwatts@gmail.com",
    email_verified: true,
    name: "Mark Watts",
    picture: "https://id.markrwatts.com/pic.png",
  };

  it("uses the ID token's claims, including groups, without calling userinfo", async () => {
    const fetchImpl = vi.fn();
    const info = await getPocketIdUserInfo(
      { idToken: fakeJwt({ ...idClaims, groups: ["refresh"] }), accessToken: "at" },
      fetchImpl,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(info).toMatchObject({
      id: "sub-1",
      sub: "sub-1",
      email: "markrwatts@gmail.com",
      emailVerified: true,
      name: "Mark Watts",
      groups: ["refresh"],
    });
    // Pocket ID's picture lives on the LAN-only host: never the app's avatar.
    expect(info?.image).toBeUndefined();
  });

  it("fills a missing groups claim from userinfo for the same subject", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ sub: "sub-1", groups: ["refresh"] }));
    const info = await getPocketIdUserInfo({ idToken: fakeJwt(idClaims), accessToken: "at" }, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith("https://id.markrwatts.com/api/oidc/userinfo", {
      headers: { Authorization: "Bearer at" },
    });
    expect(info?.groups).toEqual(["refresh"]);
    expect(info?.email).toBe("markrwatts@gmail.com");
  });

  it("ignores userinfo for a different subject, or that fails", async () => {
    const tokens = { idToken: fakeJwt(idClaims), accessToken: "at" };
    const other = vi.fn(async () => Response.json({ sub: "someone-else", groups: ["refresh"] }));
    expect((await getPocketIdUserInfo(tokens, other))?.groups).toBeUndefined();

    const failing = vi.fn(async () => new Response("nope", { status: 500 }));
    expect((await getPocketIdUserInfo(tokens, failing))?.groups).toBeUndefined();

    const throwing = vi.fn(async () => {
      throw new Error("network down");
    });
    const info = await getPocketIdUserInfo(tokens, throwing);
    expect(info?.id).toBe("sub-1");
    expect(info?.groups).toBeUndefined();
  });

  it("returns null without a subject", async () => {
    expect(await getPocketIdUserInfo({}, vi.fn())).toBeNull();
    expect(await getPocketIdUserInfo({ idToken: "not-a-jwt" }, vi.fn())).toBeNull();
  });
});
