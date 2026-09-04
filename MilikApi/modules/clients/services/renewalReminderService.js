import ClientContract from "../models/ClientContract.js";
import Client from "../models/Client.js";
import Company from "../../../models/Company.js";
import { sendRenewalNoticeEmail, formatCurrency, formatDate } from "./clientEmailService.js";
import { sendAdHocSms } from "../../../services/communicationService.js";

const THRESHOLDS = [
  { days: 90, field: "days90" },
  { days: 60, field: "days60" },
  { days: 30, field: "days30" },
  { days: 7,  field: "days7"  },
];

// SMS fallback for renewal reminders. Previously a client with a phone but
// no email address never received any reminder at all (the old code did
// `if (!client?.email) continue;`, skipping the contract entirely). This
// only fires when the email channel didn't succeed, so a client with a
// working email isn't double-notified on every run — see processRenewalReminders.
const sendRenewalNoticeSms = async ({ contract, client, business, daysLeft }) => {
  const phone = String(client?.phone || "").trim();
  if (!phone) return false;

  const currency = contract.currency || "KES";
  const body =
    `Contract ${contract.contractNumber} renewal in ${daysLeft} day${daysLeft === 1 ? "" : "s"} ` +
    `(ends ${formatDate(contract.endDate)}). Current value: ${formatCurrency(contract.currentValue, currency)}. ` +
    `Please contact us to discuss renewal terms.`;

  const result = await sendAdHocSms({
    businessId: business,
    phone,
    body,
    templateKey: "client_renewal_reminder",
    recipientName: client?.name || "",
  });

  return Boolean(result?.messageId || result?.status);
};

export const processRenewalReminders = async () => {
  const now = new Date();
  let sent = 0;

  for (const { days, field } of THRESHOLDS) {
    const windowStart = new Date(now.getTime() + (days - 1) * 24 * 60 * 60 * 1000);
    const windowEnd   = new Date(now.getTime() + (days + 1) * 24 * 60 * 60 * 1000);

    const contracts = await ClientContract.find({
      status:   { $in: ["active", "pending_renewal"] },
      openEnded: { $ne: true },
      endDate:  { $gte: windowStart, $lte: windowEnd },
      [`remindersSent.${field}`]: null,
    })
      .select("_id business client contractNumber endDate currentValue baseValue escalationPercent currency remindersSent")
      .lean();

    for (const contract of contracts) {
      try {
        const [client, company] = await Promise.all([
          Client.findOne({ _id: contract.client, business: contract.business }).select("name email phone").lean(),
          Company.findById(contract.business).lean(),
        ]);

        if (!client) continue;

        let notified = false;

        if (client.email) {
          const result = await sendRenewalNoticeEmail(contract, client, company, days);
          if (result.success) notified = true;
        }

        // SMS fallback: only when the email channel wasn't available or didn't
        // succeed, so clients with a working email aren't SMS'd on top of it.
        if (!notified) {
          notified = await sendRenewalNoticeSms({ contract, client, business: contract.business, daysLeft: days });
        }

        if (notified) {
          await ClientContract.updateOne(
            { _id: contract._id },
            { $set: { [`remindersSent.${field}`]: new Date() } }
          );
          sent++;
        }
      } catch (err) {
        console.error(`[RenewalReminder] Error for contract ${contract._id}:`, err?.message);
      }
    }
  }

  return sent;
};
