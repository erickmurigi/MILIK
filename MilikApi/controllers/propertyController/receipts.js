import RentPayment from "../../models/RentPayment.js";
import ledgerPostingService from "../../services/ledgerPostingService.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";

const resolveBusinessId = (req) => {
  const requested = req.body?.business || req.query?.business || null;
  const authenticated = req.user?.company?._id || req.user?.company || null;

  if (req.user?.isSystemAdmin || req.user?.superAdminAccess) {
    return requested || authenticated || null;
  }

  return authenticated || requested || null;
};

export async function createReceipt(req, res) {
  try {
    const business = resolveBusinessId(req);

    const actorUserId = await resolveAuditActorUserId({
      req,
      businessId: business,
      candidateUserIds: [req.body?.createdBy || null],
      fallbackErrorMessage: "No valid company user could be resolved for receipt creation.",
    });

    const receipt = await RentPayment.create({
      ...req.body,
      business,
      ledgerType: "receipts",
      status: "completed",
    });

    await ledgerPostingService.postEntry({
      business: receipt.business,
      property: receipt.property,
      landlord: receipt.landlord,
      tenant: receipt.tenant,
      unit: receipt.unit,
      category: "RENT_PAYMENT",
      direction: "credit",
      amount: receipt.amount,
      payer: "tenant",
      receiver: "manager",
      sourceTransactionType: "receipt",
      sourceTransactionId: receipt._id,
      transactionDate: receipt.date,
      statementPeriodStart: receipt.statementPeriodStart,
      statementPeriodEnd: receipt.statementPeriodEnd,
      status: "approved",
      createdBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: new Date(),
    });

    res.status(201).json(receipt);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
