// Shared branded-email chrome + send plumbing for any transactional email
// the app sends (magic-link sign-in and household invites today). One
// layout keeps them in the same palette/voice without each call site
// re-inventing table-based HTML-email markup. Sends via Resend's plain HTTP
// API (no SDK dependency) against the refresh.markrwatts.com domain — see
// DEPLOYMENT.md for the DNS/verification setup.

const BRAND = {
  cream: "#fafaf9",
  tagCream: "#f4f4f1",
  emerald: "#059669",
  emeraldDeep: "#065f46",
  zinc: "#27272a",
  zincSoft: "#71717a",
};

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Downsized copies of the brand assets (public/brand/email-*.png), served
// from the app itself. Mail clients fetch these unauthenticated, which
// works because /brand is carved out of the Cloudflare Access gate by a
// path-scoped Bypass application — see DEPLOYMENT.md's Going public notes.
// Retina-sized at 2x their displayed 56px/26px.
const EMAIL_ASSET_BASE = (process.env.AUTH_URL ?? "https://refresh.markrwatts.com").replace(/\/$/, "");

export function renderBrandedEmail({
  heading,
  bodyHtml,
  bodyText,
  ctaLabel,
  ctaUrl,
  footerText = "If you didn't request this, you can safely ignore this email.",
}: {
  heading: string;
  bodyHtml: string;
  bodyText: string;
  ctaLabel: string;
  ctaUrl: string;
  footerText?: string;
}): { html: string; text: string } {
  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body style="margin:0; padding:0; background:${BRAND.cream}; font-family:${FONT_STACK};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.cream};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; background:${BRAND.tagCream}; border-radius:24px;">
            <tr>
              <td style="padding:32px 32px 8px;">
                <table role="presentation" cellpadding="0" cellspacing="0" align="center">
                  <tr>
                    <td style="vertical-align:middle;">
                      <img src="${EMAIL_ASSET_BASE}/brand/email-icon.png" alt="re:Fresh" width="56" height="56" style="display:block; width:56px; height:56px; border-radius:12px;" />
                    </td>
                    <td style="vertical-align:middle; padding-left:12px;">
                      <img src="${EMAIL_ASSET_BASE}/brand/email-wordmark.png" alt="" height="26" style="display:block; height:26px; width:auto;" />
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 0;">
                <h1 style="margin:0 0 16px; font-size:22px; line-height:1.3; color:${BRAND.zinc};">${heading}</h1>
                <div style="font-size:15px; line-height:1.6; color:${BRAND.zinc};">${bodyHtml}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px; text-align:center;">
                <a href="${ctaUrl}" style="display:inline-block; background:${BRAND.emerald}; color:#ffffff; font-weight:700; font-size:15px; text-decoration:none; padding:14px 32px; border-radius:999px;">${ctaLabel}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0; text-align:center;">
                <p style="margin:0; font-size:12px; line-height:1.5; color:${BRAND.zincSoft}; word-break:break-all;">
                  Or paste this link into your browser:<br />
                  <a href="${ctaUrl}" style="color:${BRAND.zincSoft};">${ctaUrl}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px; text-align:center;">
                <p style="margin:0; font-size:12px; line-height:1.5; color:${BRAND.zincSoft};">
                  ${footerText}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `${heading}\n\n${bodyText}\n\n${ctaLabel}: ${ctaUrl}\n\n${footerText}`;

  return { html, text };
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
}) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "re:Fresh <noreply@refresh.markrwatts.com>",
      to,
      subject,
      html,
      text,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend send failed: ${res.status} ${await res.text()}`);
  }
}
