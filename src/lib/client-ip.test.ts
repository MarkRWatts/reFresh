import { describe, expect, it } from "vitest";
import { clientIpFromHeaders } from "./client-ip";

describe("clientIpFromHeaders", () => {
  it("prefers cf-connecting-ip", () => {
    const h = new Headers({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "10.0.0.1, 203.0.113.9" });
    expect(clientIpFromHeaders(h)).toBe("203.0.113.9");
  });

  it("falls back to a single-valued x-forwarded-for", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "192.168.1.20" }))).toBe("192.168.1.20");
  });

  it("refuses a multi-valued x-forwarded-for (client-prependable)", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "1.2.3.4, 192.168.1.20" }))).toBeNull();
  });

  it("refuses garbage and returns null with no headers", () => {
    expect(clientIpFromHeaders(new Headers({ "cf-connecting-ip": "not an ip" }))).toBeNull();
    expect(clientIpFromHeaders(new Headers())).toBeNull();
  });
});
