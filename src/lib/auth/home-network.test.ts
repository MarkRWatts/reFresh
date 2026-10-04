import { describe, expect, it } from "vitest";
import { isHomeNetworkRequest } from "./home-network";

describe("isHomeNetworkRequest", () => {
  it("is true for a request that reached the app without passing Cloudflare (LAN via Caddy, or localhost)", () => {
    expect(isHomeNetworkRequest(new Headers({ "x-forwarded-for": "192.168.1.20" }))).toBe(true);
    expect(isHomeNetworkRequest(new Headers())).toBe(true);
  });

  it("is false for a request that came through the Cloudflare tunnel", () => {
    expect(isHomeNetworkRequest(new Headers({ "cf-connecting-ip": "203.0.113.7" }))).toBe(false);
  });
});
