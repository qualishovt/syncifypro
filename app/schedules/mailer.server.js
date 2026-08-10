/**
 * schedules/mailer.server.js
 *
 * Email delivery for scheduled runs, via Resend's REST API. Ported from
 * ReportifyPro. Gated on RESEND_API_KEY — unset means the send is skipped
 * (not an error), so schedules still advance without an email provider.
 */

import { Buffer } from "node:buffer";

export async function sendScheduleEmail({ to, subject, text, attachment }) {
  const recipients = String(to || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!recipients.length) return { sent: false, skipped: true, reason: "no recipients" };

  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, skipped: true, reason: "RESEND_API_KEY not set" };
  const from = process.env.SCHEDULE_FROM_EMAIL || "SyncifyPro <onboarding@resend.dev>";

  const content = Buffer.isBuffer(attachment.body)
    ? attachment.body.toString("base64")
    : Buffer.from(String(attachment.body), "utf8").toString("base64");

  let res;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: recipients,
        subject,
        text: text || subject,
        attachments: [{ filename: attachment.filename, content }],
      }),
    });
  } catch (e) {
    return { sent: false, error: `network: ${e?.message || e}` };
  }
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    return { sent: false, error: `Resend ${res.status}: ${msg.slice(0, 200)}` };
  }
  return { sent: true, recipients: recipients.length };
}

/** Plain notification email (no attachment) — schedule success/failure alerts. */
export async function sendNotificationEmail({ to, subject, text }) {
  const recipients = String(to || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!recipients.length) return { sent: false, skipped: true, reason: "no recipients" };

  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, skipped: true, reason: "RESEND_API_KEY not set" };
  const from = process.env.SCHEDULE_FROM_EMAIL || "SyncifyPro <onboarding@resend.dev>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: recipients, subject, text: text || subject }),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      return { sent: false, error: `Resend ${res.status}: ${msg.slice(0, 200)}` };
    }
    return { sent: true, recipients: recipients.length };
  } catch (e) {
    return { sent: false, error: `network: ${e?.message || e}` };
  }
}
