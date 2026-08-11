import RentPayment from "../../models/RentPayment.js";
import ledgerPostingService from "../../services/ledgerPostingService.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import { resolveBusinessId } from "../../utils/requestContext.js";

export async function createReceipt(req, res) {
  try {
    const business = resolveBusinessId(req);

    const actorUserId = await resolveAuditActorUserId({
      req,
      businessId: business,
      candidateUserIds: [req.body?.createdBy || null],
      fallbackErrorMessage: "No valid company user could be resolved for receipt creation.",
    });

    const body = req.body || {};
    const receipt = await RentPayment.create({
      amount:               body.amount,
      date:                 body.date,
      paymentMethod:        body.paymentMethod,
      referenceNumber:      body.referenceNumber,
      description:          body.description,
      notes:                body.notes,
      tenant:               body.tenant,
      property:             body.property,
      unit:                 body.unit,
      landlord:             body.landlord,
      statementPeriodStart: body.statementPeriodStart,
      statementPeriodEnd:   body.statementPeriodEnd,
      paymentType:          body.paymentType,
      cashbookAccountId:    body.cashbookAccountId,
      allocations:          body.allocations,
      allocationSummary:    body.allocationSummary,
      receiptDescription:   body.receiptDescription,
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
      notes: receipt.description || `Receipt — ${receipt.receiptNumber || String(receipt._id).slice(-6)}`,
      status: "approved",
      createdBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: new Date(),
    });

    res.status(201).json(receipt);
  } catch (err) {
    console.error("[createReceipt]", err);
    const status = err.statusCode || (err.name === "ValidationError" ? 400 : 500);
    res.status(status).json({ message: err.statusCode ? err.message : "Receipt creation failed" });
  }
}
