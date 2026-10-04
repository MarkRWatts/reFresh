import { describe, expect, it } from "vitest";
import { signOtpFlow, verifyOtpFlow } from "./otp-flow-token";

const SECRET = "test-secret";

describe("otp flow token", () => {
  it("round-trips the email and gives each mint its own flow id", () => {
    const a = verifyOtpFlow(signOtpFlow("a.b@x.com", SECRET), SECRET);
    const b = verifyOtpFlow(signOtpFlow("a.b@x.com", SECRET), SECRET);
    expect(a?.email).toBe("a.b@x.com");
    expect(a?.flowId).not.toBe(b?.flowId);
  });

  it("rejects a bare email, a tampered email and a different secret", () => {
    expect(verifyOtpFlow("victim@x.com", SECRET)).toBeNull();
    const token = signOtpFlow("me@x.com", SECRET);
    const [id, , sig] = token.split(".");
    const forged = `${id}.${Buffer.from("victim@x.com").toString("base64url")}.${sig}`;
    expect(verifyOtpFlow(forged, SECRET)).toBeNull();
    expect(verifyOtpFlow(token, "other-secret")).toBeNull();
    expect(verifyOtpFlow(undefined, SECRET)).toBeNull();
  });
});
