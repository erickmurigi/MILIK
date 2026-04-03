import {
  buildSmtpTransporter,
  hasSmtpConfig,
  resolveMailSender,
  resolvePrimaryNotificationRecipient,
} from "./smtpMailer.js";
import { buildPublicHomeUrl } from "./onboardingAccess.js";

function buildMailUnavailableResponse(error) {
  return {
    attempted: false,
    sent: false,
    skipped: true,
    error,
  };
}

export async function sendTrialRequestNotification(trialRequest) {
  if (!hasSmtpConfig()) {
    return buildMailUnavailableResponse("SMTP environment variables are incomplete");
  }

  const to = resolvePrimaryNotificationRecipient();
  if (!to) {
    return buildMailUnavailableResponse("No notification recipient is configured for trial requests");
  }

  const transporter = buildSmtpTransporter();
  const from = resolveMailSender("TRIAL_FROM_EMAIL");
  const company = trialRequest?.company || "Not provided";
  const phone = trialRequest?.phone || "Not provided";
  const role = trialRequest?.role === "landlord" ? "Landlord" : "Property Manager";
  const portfolioSize = trialRequest?.portfolioSize || "Not provided";
  const city = trialRequest?.city || "Not provided";
  const country = trialRequest?.country || "Not provided";
  const notes = trialRequest?.notes || "Not provided";

  const subject = `New Milik demo request - ${trialRequest?.name || "Unknown lead"}`;

  const text = [
    "A new Milik demo/free trial request was submitted.",
    "",
    `Name: ${trialRequest?.name || ""}`,
    `Email: ${trialRequest?.email || ""}`,
    `Phone: ${phone}`,
    `Company: ${company}`,
    `Role: ${role}`,
    `Portfolio Size: ${portfolioSize}`,
    `City: ${city}`,
    `Country: ${country}`,
    `Notes: ${notes}`,
    `Submitted At: ${new Date().toISOString()}`,
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 720px;">
      <h2 style="margin: 0 0 16px; color: #0B3B2E;">New Milik Demo Request</h2>
      <table cellpadding="8" cellspacing="0" border="0" style="border-collapse: collapse; width: 100%; max-width: 680px;">
        <tr><td style="font-weight: 700; width: 180px;">Name</td><td>${trialRequest?.name || ""}</td></tr>
        <tr><td style="font-weight: 700;">Email</td><td>${trialRequest?.email || ""}</td></tr>
        <tr><td style="font-weight: 700;">Phone</td><td>${phone}</td></tr>
        <tr><td style="font-weight: 700;">Company</td><td>${company}</td></tr>
        <tr><td style="font-weight: 700;">Role</td><td>${role}</td></tr>
        <tr><td style="font-weight: 700;">Portfolio Size</td><td>${portfolioSize}</td></tr>
        <tr><td style="font-weight: 700;">City</td><td>${city}</td></tr>
        <tr><td style="font-weight: 700;">Country</td><td>${country}</td></tr>
        <tr><td style="font-weight: 700;">Notes</td><td>${notes}</td></tr>
      </table>
    </div>
  `;

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
    replyTo: trialRequest?.email || undefined,
  });

  return { attempted: true, sent: true, skipped: false, error: null, recipient: to };
}

export async function sendTrialAccessEmail({ trialRequest, accessToken, demoExpiresAt, resumedDemo = false }) {
  if (!hasSmtpConfig()) {
    return buildMailUnavailableResponse("SMTP environment variables are incomplete");
  }

  const to = String(trialRequest?.email || "").trim();
  if (!to) {
    return buildMailUnavailableResponse("No recipient email was supplied for demo access");
  }

  const transporter = buildSmtpTransporter();
  const from = resolveMailSender("TRIAL_FROM_EMAIL");
  const replyTo = resolvePrimaryNotificationRecipient() || undefined;
  const publicHomeUrl = buildPublicHomeUrl();
  const accessLink = `${publicHomeUrl}?demoAccess=${encodeURIComponent(accessToken)}`;
  const expiresLabel = demoExpiresAt
    ? new Date(demoExpiresAt).toLocaleString("en-KE", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "within 3 days";

  const subject = resumedDemo
    ? "Resume your MILIK workspace"
    : "Your MILIK demo workspace is ready";

  const text = [
    resumedDemo
      ? "Your MILIK demo workspace is still active. Use the secure link below to resume your remaining demo time."
      : "Your MILIK demo workspace is ready. Use the secure link below to open the guided read-only workspace.",
    "",
    `Open workspace: ${accessLink}`,
    `Access expires: ${expiresLabel}`,
    "",
    "This workspace is read-only and kept separate from live company data.",
    "If the button does not open directly, copy and paste the full link into your browser.",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 720px; margin: 0 auto;">
      <div style="border: 1px solid #dbe6df; border-radius: 18px; overflow: hidden; background: #ffffff;">
        <div style="padding: 22px 28px; background: linear-gradient(135deg, #0B3B2E 0%, #0E4C3D 100%); color: #ffffff;">
          <div style="font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 700; opacity: 0.88;">MILIK</div>
          <h2 style="margin: 10px 0 0; font-size: 24px; line-height: 1.25; color: #ffffff;">${resumedDemo ? "Resume your demo workspace" : "Your demo workspace is ready"}</h2>
          <p style="margin: 12px 0 0; color: rgba(255,255,255,0.88); font-size: 14px;">
            ${resumedDemo
              ? "Your 3-day demo window is still active. Use the secure link below to return directly to the MILIK dashboard."
              : "Enter the guided MILIK dashboard preview using the secure access link below. The environment remains read-only and separated from live company data."}
          </p>
        </div>
        <div style="padding: 24px 28px 28px; background: #ffffff;">
          <div style="margin: 0 0 18px; padding: 14px 16px; border-radius: 14px; background: #f6faf8; border: 1px solid #dbe9e2;">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 700; color: #4a6b5e;">Access window</div>
            <div style="margin-top: 6px; font-size: 15px; font-weight: 700; color: #0B3B2E;">Available until ${expiresLabel}</div>
          </div>

          <p style="margin: 0 0 18px;">
            <a href="${accessLink}" style="display: inline-block; background: #0B3B2E; color: #ffffff !important; text-decoration: none; padding: 13px 22px; border-radius: 999px; font-weight: 700;">${resumedDemo ? "Resume Demo" : "Open Demo Workspace"}</a>
          </p>

          <p style="margin: 0 0 10px; color: #334155; font-size: 14px;">If the button does not open directly, use this secure link:</p>
          <p style="margin: 0 0 18px; word-break: break-word; font-size: 13px; color: #0B3B2E;">${accessLink}</p>

          <div style="padding: 14px 16px; border-radius: 14px; background: #fff8f1; border: 1px solid #f6d2bb;">
            <div style="font-size: 12px; font-weight: 700; color: #c2410c; text-transform: uppercase; letter-spacing: 0.12em;">Important</div>
            <p style="margin: 8px 0 0; font-size: 13px; color: #7c2d12;">
              This demo workspace is read-only. It is designed for guided evaluation and does not mix with live company transactions or production records.
            </p>
          </div>
        </div>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
    replyTo,
    headers: {
      "X-Auto-Response-Suppress": "OOF, AutoReply",
      "Auto-Submitted": "auto-generated",
    },
  });

  return {
    attempted: true,
    sent: true,
    skipped: false,
    error: null,
    recipient: to,
    accessLink,
  };
}

export default sendTrialRequestNotification;
