import { buildLandlordPortalLoginUrl } from "./onboardingAccess.js";
import { buildSmtpTransporter, hasSmtpConfig, resolveMailSender } from "./smtpMailer.js";

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function sendLandlordPortalInviteEmail({ landlord, company, temporaryPassword }) {
  if (!hasSmtpConfig()) {
    return { attempted: false, sent: false, skipped: true, error: "SMTP environment variables are incomplete" };
  }

  const transporter = buildSmtpTransporter();
  const portalUrl = buildLandlordPortalLoginUrl();
  const name = landlord?.landlordName || "Landlord";
  const companyName = company?.companyName || "your property manager";
  const subject = `Your ${companyName} landlord portal access`;
  const from = resolveMailSender("ONBOARDING_FROM_EMAIL", "TRIAL_FROM_EMAIL");

  const text = [
    `Hello ${name},`,
    "",
    `You now have landlord portal access for ${companyName}.`,
    `Portal URL: ${portalUrl}`,
    `Company Code: ${company?.companyCode || ""}`,
    `Landlord Code: ${landlord?.landlordCode || ""}`,
    `Temporary Password: ${temporaryPassword || ""}`,
    "",
    "Use the temporary password to sign in, then change it from your profile.",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.6; max-width: 720px;">
      <h2 style="margin: 0 0 16px; color: #0B3B2E;">Your landlord portal is ready</h2>
      <p>Hello <strong>${esc(name)}</strong>,</p>
      <p>You now have self-service access to your statements, units, and tenants for <strong>${esc(companyName)}</strong>.</p>
      <table cellpadding="8" cellspacing="0" border="0" style="border-collapse: collapse; width: 100%; max-width: 640px;">
        <tr><td style="font-weight: 700; width: 180px;">Portal URL</td><td><a href="${portalUrl}">${esc(portalUrl)}</a></td></tr>
        <tr><td style="font-weight: 700;">Company Code</td><td>${esc(company?.companyCode || "")}</td></tr>
        <tr><td style="font-weight: 700;">Landlord Code</td><td>${esc(landlord?.landlordCode || "")}</td></tr>
        <tr><td style="font-weight: 700;">Temporary password</td><td>${esc(temporaryPassword || "")}</td></tr>
      </table>
      <p style="margin-top: 18px;">Please sign in with the temporary password above and change it from your profile.</p>
      <p style="margin-top: 18px;"><a href="${portalUrl}" style="display: inline-block; background: #0B3B2E; color: #ffffff; padding: 12px 18px; border-radius: 999px; text-decoration: none; font-weight: 700;">Open Landlord Portal</a></p>
    </div>
  `;

  try {
    await transporter.sendMail({ from, to: landlord?.email, subject, text, html });
    return { attempted: true, sent: true, skipped: false, error: null, portalUrl };
  } catch (mailErr) {
    return { attempted: true, sent: false, skipped: false, error: mailErr.message };
  }
}
