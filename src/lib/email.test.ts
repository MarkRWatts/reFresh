import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escapeHtml, renderBrandedEmail, sendAppInviteEmail } from "./email";

const HOSTILE = "<a href=x>Hi</a>";
const ESCAPED = "&lt;a href=x&gt;Hi&lt;/a&gt;";

describe("escapeHtml", () => {
  it("escapes markup and attribute-breaking characters", () => {
    expect(escapeHtml(`<b class="x">Tom & Jerry's</b>`)).toBe(
      "&lt;b class=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/b&gt;",
    );
  });
});

describe("renderBrandedEmail", () => {
  it("escapes the plain-text inputs in the HTML, and leaves the text part as typed", () => {
    const { html, text } = renderBrandedEmail({
      heading: `${HOSTILE} invited you`,
      bodyHtml: "<p>Trusted body</p>",
      bodyText: "Trusted body",
      ctaLabel: HOSTILE,
      ctaUrl: `https://refresh.example.com/invite/1"><a href="https://evil.example`,
      footerText: `Sent by ${HOSTILE}`,
    });
    expect(html).not.toContain(HOSTILE);
    expect(html).not.toContain('href="https://evil.example');
    expect(html).toContain(`${ESCAPED} invited you`);
    expect(html).toContain(`Sent by ${ESCAPED}`);
    expect(html).toContain("<p>Trusted body</p>");
    expect(text).toContain(`${HOSTILE} invited you`);
  });
});

describe("sendAppInviteEmail", () => {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response("{}"));

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("escapes the inviter's name in the HTML", async () => {
    await sendAppInviteEmail({ to: "friend@example.com", inviterName: HOSTILE });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.html).not.toContain(HOSTILE);
    expect(body.html).toContain(`${ESCAPED} invited you to try re:Fresh`);
    expect(body.html).toContain(`sent from re:Fresh by ${ESCAPED}.`);
  });
});
