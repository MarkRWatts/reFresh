import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Message = { to: string; subject: string; html: string; text: string };
const sendEmail = vi.fn<(message: Message) => Promise<void>>(async () => {});
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail,
}));

const { deliverSignInOTP, sendSignInOTP } = await import("./otp-email");

beforeEach(() => {
  sendEmail.mockClear();
  vi.stubEnv("AUTH_URL", "https://refresh.example.com");
  vi.stubEnv("ALLOWED_EMAILS", "markrwatts@gmail.com,ladyemmawatts@gmail.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the sign-in code email", () => {
  it("emails the code, branded, to an address ALLOWED_EMAILS admits", async () => {
    expect(await deliverSignInOTP({ email: "ladyemmawatts@gmail.com", otp: "123456", type: "sign-in" })).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const message = sendEmail.mock.calls[0][0];
    expect(message.to).toBe("ladyemmawatts@gmail.com");
    expect(message.subject).toBe("123456 is your re:Fresh sign-in code");
    expect(message.html).toContain("123456");
    expect(message.text).toContain("Your code: 123456");
    expect(message.text).toContain("https://refresh.example.com/signin");
  });

  it("silently sends nothing to an address ALLOWED_EMAILS would refuse", async () => {
    expect(await deliverSignInOTP({ email: "stranger@example.com", otp: "123456", type: "sign-in" })).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends nothing for any OTP type but sign-in", async () => {
    expect(
      await deliverSignInOTP({ email: "markrwatts@gmail.com", otp: "123456", type: "email-verification" }),
    ).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns before the send, and swallows a failed send", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    sendEmail.mockRejectedValueOnce(new Error("Resend down"));
    await expect(sendSignInOTP({ email: "markrwatts@gmail.com", otp: "123456", type: "sign-in" })).resolves.toBeUndefined();
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    // Never the code or the address in the log.
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/123456|markrwatts/);
    error.mockRestore();
  });
});
