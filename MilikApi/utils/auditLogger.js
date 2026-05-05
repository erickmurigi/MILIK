import AuditLog from "../models/AuditLog.js";

const toId = (value) => (value?._id || value ? String(value?._id || value) : "");

const getActorName = (user = {}) =>
  [user?.surname, user?.otherNames].filter(Boolean).join(" ").trim() ||
  user?.name ||
  user?.email ||
  "";

export const logAuditEvent = async ({
  req = null,
  company,
  actor = null,
  action,
  category = "system",
  severity = "important",
  targetType = "",
  targetId = "",
  targetName = "",
  message,
  metadata = {},
}) => {
  try {
    const companyId = toId(company);
    if (!companyId || !action || !message) return null;

    const requestUser = req?.user || {};
    const actorPayload = actor || requestUser;
    const actorId = toId(actorPayload?.id || actorPayload?._id);

    return await AuditLog.create({
      company: companyId,
      actor: /^[a-f\d]{24}$/i.test(actorId) ? actorId : null,
      actorName: getActorName(actorPayload),
      actorEmail: actorPayload?.email || "",
      action,
      category,
      severity,
      targetType,
      targetId: toId(targetId),
      targetName,
      message,
      metadata,
      ipAddress: req?.ip || req?.headers?.["x-forwarded-for"] || "",
      userAgent: req?.headers?.["user-agent"] || "",
    });
  } catch (error) {
    console.warn("Audit log write failed:", error?.message || error);
    return null;
  }
};
