import {
  buildSmtpTransporter,
  hasSmtpConfig,
  resolveMailSender,
  resolvePrimaryNotificationRecipient,
} from "./smtpMailer.js";

function buildMailUnavailableResponse(error) {
  return {
    attempted: false,
    sent: false,
    skipped: true,
    error,
  };
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  const moduleLabels = {
    property_management: "Property Management",
    car_wash: "Car Wash",
    human_resources: "Human Resources",
    inventory_pos: "Inventory & POS",
    property_sales: "Property Sales",
  };
  const selectedModulesText = Array.isArray(trialRequest?.selectedModules) && trialRequest.selectedModules.length > 0
    ? trialRequest.selectedModules.map((m) => moduleLabels[m] || m).join(", ")
    : "Not specified";

  const subject = `New Milik demo request - ${trialRequest?.name || "Unknown lead"}`;

  const text = [
    "A new Milik demo/free trial request was submitted.",
    "",
    `Name: ${trialRequest?.name || ""}`,
    `Email: ${trialRequest?.email || ""}`,
    `Phone: ${phone}`,
    `Company: ${company}`,
    `Modules Selected: ${selectedModulesText}`,
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
        <tr><td style="font-weight: 700; width: 180px;">Name</td><td>${escHtml(trialRequest?.name)}</td></tr>
        <tr><td style="font-weight: 700;">Email</td><td>${escHtml(trialRequest?.email)}</td></tr>
        <tr><td style="font-weight: 700;">Phone</td><td>${escHtml(phone)}</td></tr>
        <tr><td style="font-weight: 700;">Company</td><td>${escHtml(company)}</td></tr>
        <tr style="background:#f0fdf4;"><td style="font-weight: 700;">Modules Selected</td><td style="font-weight:600;color:#0B3B2E;">${escHtml(selectedModulesText)}</td></tr>
        <tr><td style="font-weight: 700;">Role</td><td>${escHtml(role)}</td></tr>
        <tr><td style="font-weight: 700;">Portfolio Size</td><td>${escHtml(portfolioSize)}</td></tr>
        <tr><td style="font-weight: 700;">City</td><td>${escHtml(city)}</td></tr>
        <tr><td style="font-weight: 700;">Country</td><td>${escHtml(country)}</td></tr>
        <tr><td style="font-weight: 700;">Notes</td><td>${escHtml(notes)}</td></tr>
      </table>
    </div>
  `;

  try {
    await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
      replyTo: trialRequest?.email || undefined,
    });
  } catch (mailErr) {
    return { attempted: true, sent: false, skipped: false, error: mailErr.message };
  }

  return { attempted: true, sent: true, skipped: false, error: null, recipient: to };
}

export default sendTrialRequestNotification;
