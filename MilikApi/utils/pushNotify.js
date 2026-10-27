import { Expo } from "expo-server-sdk";
import PushToken from "../models/PushToken.js";
import User from "../models/User.js";

const expo = new Expo();

// Fire-and-forget by design — a notification failing to send must never break the business
// flow that triggered it (a payment posting, a lead being created, etc.), same spirit as the
// SMS senders elsewhere in the codebase.
export const sendPushToUsers = async (userIds, { title, body, data = {} } = {}) => {
  try {
    const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
    if (!ids.length || !title || !body) return;

    const tokenDocs = await PushToken.find({ user: { $in: ids } }).select("token user").lean();
    if (!tokenDocs.length) return;

    const messages = [];
    for (const { token } of tokenDocs) {
      if (!Expo.isExpoPushToken(token)) continue;
      messages.push({ to: token, sound: "default", title, body, data });
    }
    if (!messages.length) return;

    const chunks = expo.chunkPushNotifications(messages);
    const deadTokens = [];

    for (const chunk of chunks) {
      try {
        const receipts = await expo.sendPushNotificationsAsync(chunk);
        receipts.forEach((receipt, i) => {
          if (receipt.status === "error" && receipt.details?.error === "DeviceNotRegistered") {
            deadTokens.push(chunk[i].to);
          }
        });
      } catch (err) {
        console.error("[Push] Chunk send failed:", err?.message || err);
      }
    }

    if (deadTokens.length) {
      await PushToken.deleteMany({ token: { $in: deadTokens } }).catch(() => {});
    }
  } catch (err) {
    console.error("[Push] sendPushToUsers failed:", err?.message || err);
  }
};

// Users of a company who can see a given module — the stand-in for "the relevant staff
// member" wherever a record has no single assigned owner (properties have no per-property
// manager field; most modules are role/access based, not individually assigned).
export const resolveUsersWithModuleAccess = async (companyId, moduleKey, levels = ["View only", "Full access"]) => {
  if (!companyId || !moduleKey) return [];
  const users = await User.find({
    isActive: true,
    $or: [
      { company: companyId, [`moduleAccess.${moduleKey}`]: { $in: levels } },
      {
        companyAssignments: {
          $elemMatch: { company: companyId, [`moduleAccess.${moduleKey}`]: { $in: levels } },
        },
      },
    ],
  }).select("_id").lean();
  return users.map((u) => String(u._id));
};

// Every active user tied to a company — used where there's no finer-grained signal to
// target on (e.g. carwash access is rights-based, not a single moduleAccess flag).
export const resolveActiveCompanyUsers = async (companyId) => {
  if (!companyId) return [];
  const users = await User.find({
    isActive: true,
    $or: [{ company: companyId }, { accessibleCompanies: companyId }],
  }).select("_id").lean();
  return users.map((u) => String(u._id));
};

// Car wash is branch-staffed (User.companyAssignments[].carwashBranch) — prefer the users
// pinned to this job's branch; fall back to every active user of the company when the
// branch isn't staffed (single-branch setups, or a job with no branch set).
export const resolveCarwashRecipients = async (companyId, branchId) => {
  if (branchId) {
    const branchUsers = await User.find({
      isActive: true,
      companyAssignments: { $elemMatch: { company: companyId, carwashBranch: branchId } },
    }).select("_id").lean();
    if (branchUsers.length) return branchUsers.map((u) => String(u._id));
  }
  return resolveActiveCompanyUsers(companyId);
};
