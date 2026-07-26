import {
  buildCompanySmtpTransporter,
  resolveCompanyMailSender,
  buildCompanyInternalCopyRecipients,
  isEmailEnabled,
} from "../../../utils/smtpMailer.js";
import { getPrimaryEmailProfile, getRawEmailProfiles } from "../../../utils/companyModules.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const escapeHtml = (value = "") =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatCurrency = (value, currency = "KES") => {
  const amount = Number(value || 0);
  return `${currency} ${amount.toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });
};

/**
 * Resolve the primary SMTP profile from a Company document.
 * Returns null when no usable profile is found.
 */
const resolveEmailProfile = (company) => {
  const profiles = getRawEmailProfiles(company?.communication || {});
  const profile = getPrimaryEmailProfile(
    profiles,
    company?.communication?.defaultEmailProfileId || null
  );
  return profile?.enabled ? profile : null;
};

// ─── Invoice email ───────────────────────────────────────────────────────────

/**
 * Build and send an invoice email to the client.
 * Returns { success: true } on send, or { success: false, reason } if SMTP is not configured.
 * Never throws — errors are logged and returned as { success: false, reason }.
 */
export const sendInvoiceEmail = async (invoice, client, company) => {
  if (!isEmailEnabled()) {
    return { success: false, reason: "email_globally_disabled" };
  }

  const profile = resolveEmailProfile(company);
  if (!profile) {
    console.warn("[clientEmailService] No active email profile for business", company?._id);
    return { success: false, reason: "smtp_not_configured" };
  }

  const toEmail = String(client?.email || "").trim();
  if (!toEmail) {
    return { success: false, reason: "client_email_missing" };
  }

  const currency = invoice.currency || "KES";
  const vatRate = Number(invoice.vatRate || 0);
  const subtotal = Number(invoice.subtotal || 0);
  const vatAmount = Number(invoice.vatAmount || 0);
  const total = Number(invoice.total || 0);
  const paidAmount = Number(invoice.paidAmount || 0);
  const balanceDue = Math.max(0, total - paidAmount);

  const companyName = escapeHtml(company?.name || "");
  const companyAddress = escapeHtml(
    [company?.address?.line1, company?.address?.city, company?.address?.country]
      .filter(Boolean)
      .join(", ")
  );

  // Line items table rows
  const lineItemRows = (Array.isArray(invoice.lineItems) ? invoice.lineItems : [])
    .map(
      (item) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.description)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:center;">${Number(item.quantity || 0)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatCurrency(item.unitPrice, currency)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatCurrency(item.amount, currency)}</td>
      </tr>`
    )
    .join("");

  const periodLine =
    invoice.periodStart && invoice.periodEnd
      ? `<tr><td style="padding:4px 10px;color:#6b7280;">Period</td><td style="padding:4px 10px;">${formatDate(invoice.periodStart)} – ${formatDate(invoice.periodEnd)}</td></tr>`
      : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;font-size:14px;color:#111827;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">

          <!-- Header -->
          <tr>
            <td style="background:#1e3a5f;padding:24px 32px;">
              ${company?.logoUrl ? `<img src="${escapeHtml(company.logoUrl)}" alt="${companyName}" style="max-height:48px;margin-bottom:8px;display:block;" />` : ""}
              <div style="color:#ffffff;font-size:20px;font-weight:bold;">${companyName}</div>
              ${companyAddress ? `<div style="color:#93c5fd;font-size:12px;margin-top:4px;">${companyAddress}</div>` : ""}
            </td>
          </tr>

          <!-- Invoice title -->
          <tr>
            <td style="padding:24px 32px 8px;">
              <div style="font-size:22px;font-weight:bold;color:#1e3a5f;">TAX INVOICE</div>
            </td>
          </tr>

          <!-- Invoice meta -->
          <tr>
            <td style="padding:0 32px 20px;">
              <table cellpadding="0" cellspacing="0">
                <tr><td style="padding:4px 10px;color:#6b7280;min-width:120px;">Invoice No.</td><td style="padding:4px 10px;font-weight:bold;">${escapeHtml(invoice.invoiceNumber)}</td></tr>
                <tr><td style="padding:4px 10px;color:#6b7280;">Issue Date</td><td style="padding:4px 10px;">${formatDate(invoice.issueDate)}</td></tr>
                <tr><td style="padding:4px 10px;color:#6b7280;">Due Date</td><td style="padding:4px 10px;color:#dc2626;font-weight:bold;">${formatDate(invoice.dueDate)}</td></tr>
                ${periodLine}
              </table>
            </td>
          </tr>

          <!-- Bill to -->
          <tr>
            <td style="padding:0 32px 20px;">
              <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Bill To</div>
              <div style="font-weight:bold;">${escapeHtml(client?.name || "")}</div>
              ${client?.email ? `<div style="color:#4b5563;">${escapeHtml(client.email)}</div>` : ""}
              ${client?.phone ? `<div style="color:#4b5563;">${escapeHtml(client.phone)}</div>` : ""}
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:0 32px 16px;">
              <p style="margin:0;color:#374151;">Dear ${escapeHtml(client?.name || "Client")},</p>
              <p style="margin:8px 0 0;color:#374151;">Please find your invoice details below. Kindly settle the balance due by the due date above.</p>
            </td>
          </tr>

          <!-- Line items -->
          <tr>
            <td style="padding:0 32px 0;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:4px;overflow:hidden;">
                <thead>
                  <tr style="background:#f9fafb;">
                    <th style="padding:8px 10px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;border-bottom:1px solid #e5e7eb;">Description</th>
                    <th style="padding:8px 10px;text-align:center;font-size:12px;color:#6b7280;text-transform:uppercase;border-bottom:1px solid #e5e7eb;">Qty</th>
                    <th style="padding:8px 10px;text-align:right;font-size:12px;color:#6b7280;text-transform:uppercase;border-bottom:1px solid #e5e7eb;">Unit Price</th>
                    <th style="padding:8px 10px;text-align:right;font-size:12px;color:#6b7280;text-transform:uppercase;border-bottom:1px solid #e5e7eb;">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  ${lineItemRows}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- Totals -->
          <tr>
            <td style="padding:16px 32px 24px;">
              <table align="right" cellpadding="0" cellspacing="0" style="min-width:280px;">
                <tr>
                  <td style="padding:4px 10px;color:#6b7280;">Subtotal</td>
                  <td style="padding:4px 10px;text-align:right;">${formatCurrency(subtotal, currency)}</td>
                </tr>
                ${vatRate > 0 ? `
                <tr>
                  <td style="padding:4px 10px;color:#6b7280;">VAT (${vatRate}%)</td>
                  <td style="padding:4px 10px;text-align:right;">${formatCurrency(vatAmount, currency)}</td>
                </tr>` : ""}
                <tr style="border-top:2px solid #1e3a5f;">
                  <td style="padding:8px 10px;font-weight:bold;">Total</td>
                  <td style="padding:8px 10px;text-align:right;font-weight:bold;font-size:16px;">${formatCurrency(total, currency)}</td>
                </tr>
                ${paidAmount > 0 ? `
                <tr>
                  <td style="padding:4px 10px;color:#16a34a;">Amount Paid</td>
                  <td style="padding:4px 10px;text-align:right;color:#16a34a;">${formatCurrency(paidAmount, currency)}</td>
                </tr>
                <tr>
                  <td style="padding:4px 10px;font-weight:bold;color:#dc2626;">Balance Due</td>
                  <td style="padding:4px 10px;text-align:right;font-weight:bold;color:#dc2626;">${formatCurrency(balanceDue, currency)}</td>
                </tr>` : ""}
              </table>
            </td>
          </tr>

          <!-- Notes -->
          ${invoice.notes ? `
          <tr>
            <td style="padding:0 32px 24px;">
              <div style="background:#f9fafb;border-left:3px solid #1e3a5f;padding:10px 14px;color:#374151;font-size:13px;">
                <strong>Notes:</strong> ${escapeHtml(invoice.notes)}
              </div>
            </td>
          </tr>` : ""}

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:16px 32px;text-align:center;color:#6b7280;font-size:12px;border-top:1px solid #e5e7eb;">
              Thank you for your business.<br />
              ${companyName}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `Invoice ${invoice.invoiceNumber}`,
    ``,
    `Dear ${client?.name || "Client"},`,
    `Please find your invoice details below.`,
    ``,
    `Invoice No.: ${invoice.invoiceNumber}`,
    `Issue Date:  ${formatDate(invoice.issueDate)}`,
    `Due Date:    ${formatDate(invoice.dueDate)}`,
    ``,
    `Subtotal:    ${formatCurrency(subtotal, currency)}`,
    vatRate > 0 ? `VAT (${vatRate}%): ${formatCurrency(vatAmount, currency)}` : "",
    `Total:       ${formatCurrency(total, currency)}`,
    paidAmount > 0 ? `Amount Paid: ${formatCurrency(paidAmount, currency)}` : "",
    paidAmount > 0 ? `Balance Due: ${formatCurrency(balanceDue, currency)}` : "",
    ``,
    `Thank you for your business.`,
    companyName,
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  try {
    const transporter = buildCompanySmtpTransporter(profile);
    await transporter.sendMail({
      from: resolveCompanyMailSender(profile),
      to: toEmail,
      subject: `Invoice ${invoice.invoiceNumber} from ${company?.name || ""}`,
      text,
      html,
      replyTo: profile?.replyTo || undefined,
      ...buildCompanyInternalCopyRecipients(profile),
    });
    return { success: true };
  } catch (err) {
    console.error("[clientEmailService] Failed to send invoice email:", err.message);
    return { success: false, reason: err.message };
  }
};

// ─── Renewal notice email ────────────────────────────────────────────────────

/**
 * Send a contract renewal notice to the client.
 * Returns { success: true } or { success: false, reason }.
 */
export const sendRenewalNoticeEmail = async (contract, client, company, daysLeft) => {
  if (!isEmailEnabled()) {
    return { success: false, reason: "email_globally_disabled" };
  }

  const profile = resolveEmailProfile(company);
  if (!profile) {
    console.warn("[clientEmailService] No active email profile for renewal notice, business", company?._id);
    return { success: false, reason: "smtp_not_configured" };
  }

  const toEmail = String(client?.email || "").trim();
  if (!toEmail) {
    return { success: false, reason: "client_email_missing" };
  }

  const companyName = company?.name || "";
  const currency = contract.currency || "KES";
  const proposedValue = Math.round(
    Number(contract.currentValue || 0) * (1 + Number(contract.escalationPercent || 0) / 100) * 100
  ) / 100;

  const subject = `Contract Renewal Notice – ${contract.contractNumber} (${daysLeft} days remaining)`;

  const text = [
    `Dear ${client?.name || "Client"},`,
    ``,
    `This is a reminder that your contract with ${companyName} is due for renewal.`,
    ``,
    `Contract Number: ${contract.contractNumber}`,
    `Contract End Date: ${formatDate(contract.endDate)}`,
    `Days Remaining: ${daysLeft}`,
    `Current Value: ${formatCurrency(contract.currentValue, currency)}`,
    `Proposed Renewed Value: ${formatCurrency(proposedValue, currency)} (${contract.escalationPercent}% escalation)`,
    ``,
    `Please get in touch with us to discuss the renewal terms.`,
    ``,
    `Regards,`,
    companyName,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Contract Renewal Notice</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;font-size:14px;color:#111827;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr>
            <td style="background:#1e3a5f;padding:20px 28px;">
              <div style="color:#ffffff;font-size:18px;font-weight:bold;">${escapeHtml(companyName)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <div style="font-size:18px;font-weight:bold;color:#1e3a5f;margin-bottom:16px;">Contract Renewal Notice</div>
              <p style="margin:0 0 16px;">Dear ${escapeHtml(client?.name || "Client")},</p>
              <p style="margin:0 0 20px;color:#374151;">
                This is a reminder that your contract with <strong>${escapeHtml(companyName)}</strong> is due for renewal in <strong>${daysLeft} day${daysLeft !== 1 ? "s" : ""}</strong>.
              </p>
              <table cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;width:100%;margin-bottom:20px;">
                <tr>
                  <td style="padding:8px 14px;color:#6b7280;min-width:160px;">Contract Number</td>
                  <td style="padding:8px 14px;font-weight:bold;">${escapeHtml(contract.contractNumber)}</td>
                </tr>
                <tr style="background:#ffffff;">
                  <td style="padding:8px 14px;color:#6b7280;">End Date</td>
                  <td style="padding:8px 14px;color:#dc2626;font-weight:bold;">${formatDate(contract.endDate)}</td>
                </tr>
                <tr>
                  <td style="padding:8px 14px;color:#6b7280;">Current Value</td>
                  <td style="padding:8px 14px;">${formatCurrency(contract.currentValue, currency)}</td>
                </tr>
                <tr style="background:#ffffff;">
                  <td style="padding:8px 14px;color:#6b7280;">Proposed Renewed Value</td>
                  <td style="padding:8px 14px;font-weight:bold;">${formatCurrency(proposedValue, currency)} <span style="color:#6b7280;font-size:12px;">(${contract.escalationPercent}% escalation)</span></td>
                </tr>
              </table>
              <p style="margin:0 0 8px;color:#374151;">Please get in touch with us to discuss the renewal terms at your earliest convenience.</p>
              <p style="margin:0;color:#374151;">Regards,<br /><strong>${escapeHtml(companyName)}</strong></p>
            </td>
          </tr>
          <tr>
            <td style="background:#f9fafb;padding:12px 28px;text-align:center;color:#9ca3af;font-size:12px;border-top:1px solid #e5e7eb;">
              ${escapeHtml(companyName)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  try {
    const transporter = buildCompanySmtpTransporter(profile);
    await transporter.sendMail({
      from: resolveCompanyMailSender(profile),
      to: toEmail,
      subject,
      text,
      html,
      replyTo: profile?.replyTo || undefined,
      ...buildCompanyInternalCopyRecipients(profile),
    });
    return { success: true };
  } catch (err) {
    console.error("[clientEmailService] Failed to send renewal notice:", err.message);
    return { success: false, reason: err.message };
  }
};
