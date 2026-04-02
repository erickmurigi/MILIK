import { buildAppLoginUrl, buildPublicHomeUrl } from "./onboardingAccess.js";
import { buildSmtpTransporter, hasSmtpConfig, resolveMailSender } from "./smtpMailer.js";

export async function sendUserOnboardingEmail({ user, company, temporaryPassword }) {
  if (!hasSmtpConfig()) {
    return {
      attempted: false,
      sent: false,
      skipped: true,
      error: "SMTP environment variables are incomplete",
    };
  }

  const transporter = buildSmtpTransporter();
  const appUrl = buildAppLoginUrl();
  const publicUrl = buildPublicHomeUrl();
  const name = [user?.otherNames, user?.surname].filter(Boolean).join(" ") || user?.email || "Milik User";
  const companyName = company?.companyName || "your company";
  const subject = `Your Milik workspace is ready - ${companyName}`;
  const from = resolveMailSender("ONBOARDING_FROM_EMAIL", "TRIAL_FROM_EMAIL");

  const text = [
    `Hello ${name},`,
    "",
    `Your Milik access for ${companyName} is ready.`,
    `App URL: ${appUrl}`,
    `Username: ${user?.email || ""}`,
    `Temporary Password: ${temporaryPassword || ""}`,
    "",
    "Use the temporary password to sign in, then change it immediately on your first login.",
    `Public overview: ${publicUrl}`,
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.6; max-width: 720px;">
      <h2 style="margin: 0 0 16px; color: #0B3B2E;">Your Milik workspace is ready</h2>
      <p>Hello <strong>${name}</strong>,</p>
      <p>Your Milik access for <strong>${companyName}</strong> has been prepared.</p>
      <table cellpadding="8" cellspacing="0" border="0" style="border-collapse: collapse; width: 100%; max-width: 640px;">
        <tr><td style="font-weight: 700; width: 180px;">App URL</td><td><a href="${appUrl}">${appUrl}</a></td></tr>
        <tr><td style="font-weight: 700;">Username</td><td>${user?.email || ""}</td></tr>
        <tr><td style="font-weight: 700;">Temporary password</td><td>${temporaryPassword || ""}</td></tr>
      </table>
      <p style="margin-top: 18px;">Please sign in with the temporary password and change it immediately on your first login.</p>
      <p style="margin-top: 18px;"><a href="${appUrl}" style="display: inline-block; background: #0B3B2E; color: #ffffff; padding: 12px 18px; border-radius: 999px; text-decoration: none; font-weight: 700;">Open Milik App</a></p>
      <p style="color: #475569; font-size: 14px;">Want the product overview first? <a href="${publicUrl}">View the public landing page</a>.</p>
    </div>
  `;

  await transporter.sendMail({
    from,
    to: user?.email,
    subject,
    text,
    html,
  });

  return { attempted: true, sent: true, skipped: false, error: null, appUrl };
}
