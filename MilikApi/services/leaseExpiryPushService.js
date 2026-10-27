import Lease from "../models/Lease.js";
import { sendPushToUsers, resolveUsersWithModuleAccess } from "../utils/pushNotify.js";

const THRESHOLDS = [
  { days: 30, field: "days30" },
  { days: 7,  field: "days7"  },
  { days: 1,  field: "days1"  },
];

// Daily digest, grouped by company, so a company with many leases crossing the same
// threshold today gets one notification instead of one per lease.
export const processLeaseExpiryPushReminders = async () => {
  const now = new Date();
  let sent = 0;

  for (const { days, field } of THRESHOLDS) {
    const windowStart = new Date(now.getTime() + (days - 1) * 24 * 60 * 60 * 1000);
    const windowEnd   = new Date(now.getTime() + (days + 1) * 24 * 60 * 60 * 1000);

    const leases = await Lease.find({
      status: "active",
      endDate: { $gte: windowStart, $lte: windowEnd },
      [`expiryRemindersSent.${field}`]: null,
    })
      .select("_id business endDate")
      .populate({ path: "tenant", select: "name" })
      .populate({ path: "unit", select: "unitNumber property", populate: { path: "property", select: "propertyName" } })
      .lean();

    if (!leases.length) continue;

    const byCompany = new Map();
    for (const lease of leases) {
      const key = String(lease.business);
      if (!byCompany.has(key)) byCompany.set(key, []);
      byCompany.get(key).push(lease);
    }

    for (const [companyId, companyLeases] of byCompany) {
      try {
        const userIds = await resolveUsersWithModuleAccess(companyId, "propertyMgmt");
        if (userIds.length) {
          const body = companyLeases.length === 1
            ? `${companyLeases[0].tenant?.name || "A tenant"}'s lease (${companyLeases[0].unit?.property?.propertyName || "unit"}) expires in ${days} day${days === 1 ? "" : "s"}`
            : `${companyLeases.length} leases expire within ${days} day${days === 1 ? "" : "s"}`;
          await sendPushToUsers(userIds, {
            title: "Lease expiring soon",
            body,
            data: { type: "lease_expiring", days },
          });
        }
        await Lease.updateMany(
          { _id: { $in: companyLeases.map((l) => l._id) } },
          { $set: { [`expiryRemindersSent.${field}`]: new Date() } }
        );
        sent += companyLeases.length;
      } catch (err) {
        console.error(`[LeaseExpiryPush] Error for company ${companyId}:`, err?.message);
      }
    }
  }

  return sent;
};
