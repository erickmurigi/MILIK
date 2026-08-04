import ClientContract from "../models/ClientContract.js";
import Client from "../models/Client.js";
import Company from "../../../models/Company.js";
import { sendRenewalNoticeEmail } from "./clientEmailService.js";

const THRESHOLDS = [
  { days: 90, field: "days90" },
  { days: 60, field: "days60" },
  { days: 30, field: "days30" },
  { days: 7,  field: "days7"  },
];

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

        if (!client?.email) continue;

        const result = await sendRenewalNoticeEmail(contract, client, company, days);
        if (result.success) {
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
