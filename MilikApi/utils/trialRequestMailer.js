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
  const publicHomeUrl = buildPublicHomeUrl();
  const accessLink = `${publicHomeUrl}?demoAccess=${encodeURIComponent(accessToken)}`;
  const expiresLabel = demoExpiresAt
    ? new Date(demoExpiresAt).toLocaleString("en-KE", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "within 3 days";

  const subject = resumedDemo
    ? "Resume your MILIK demo workspace"
    : "Your MILIK demo workspace access link";

  const text = [
    resumedDemo
      ? "Your MILIK demo is still active. Use the access link below to re-enter your workspace."
      : "Your MILIK demo workspace is ready. Use the access link below to enter the workspace.",
    "",
    `Access link: ${accessLink}`,
    `Access expires: ${expiresLabel}`,
    "",
    "The workspace is read-only and separated from live company data.",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 720px;">
      <h2 style="margin: 0 0 16px; color: #0B3B2E;">${resumedDemo ? "Resume your demo" : "Your demo is ready"}</h2>
      <p style="margin: 0 0 16px;">
        ${resumedDemo
          ? "Your MILIK demo workspace is still active. Use the button below to continue without filling the request form again."
          : "Your MILIK demo workspace is ready. Use the button below to enter the guided read-only environment."}
      </p>
      <p style="margin: 0 0 20px;">
        <a href="${accessLink}" style="display: inline-block; background: #0B3B2E; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 999px; font-weight: 700;">${resumedDemo ? "Resume Demo" : "Open Demo Workspace"}</a>
      </p>
      <p style="margin: 0 0 8px;"><strong>Access expires:</strong> ${expiresLabel}</p>
      <p style="margin: 0; color: #475569;">This workspace stays read-only and separate from live company data.</p>
    </div>
  `;

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
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
