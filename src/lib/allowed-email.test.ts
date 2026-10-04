import { describe, expect, it } from "vitest";
import { isAllowedEmail } from "./allowed-email";

describe("isAllowedEmail", () => {
  it("lets everyone in while ALLOWED_EMAILS is unset or empty (local dev, LAN-only)", () => {
    expect(isAllowedEmail("anyone@example.com", {})).toBe(true);
    expect(isAllowedEmail("anyone@example.com", { ALLOWED_EMAILS: " , " })).toBe(true);
  });

  it("admits only listed emails once set, ignoring case and spaces", () => {
    const env = { ALLOWED_EMAILS: "markrwatts@gmail.com, LadyEmmaWatts@gmail.com" };
    expect(isAllowedEmail("markrwatts@gmail.com", env)).toBe(true);
    expect(isAllowedEmail("ladyemmawatts@GMAIL.com", env)).toBe(true);
    expect(isAllowedEmail(" markrwatts@gmail.com ", env)).toBe(true);
    expect(isAllowedEmail("stranger@example.com", env)).toBe(false);
    expect(isAllowedEmail(null, env)).toBe(false);
    expect(isAllowedEmail("", env)).toBe(false);
  });
});
