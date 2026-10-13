import mongoose from "mongoose";
import SaleProject from "../models/SaleProject.js";
import SaleListing from "../models/SaleListing.js";
import SaleDeal from "../models/SaleDeal.js";
import SalePayment from "../models/SalePayment.js";
import SaleCommission from "../models/SaleCommission.js";
import SaleOwnerCommission from "../models/SaleOwnerCommission.js";
import PaymentVoucher from "../../../models/PaymentVoucher.js";
import { round2 } from "../../../utils/math.js";

const toId = (v) => new mongoose.Types.ObjectId(String(v));
const inPeriod = (date, start, end) => date && date >= start && date <= end;

// Gathers everything that happened for one owner (optionally scoped to one project) in a period, and
// folds it into a flat, running-balance line list — the same shape LandlordStatement uses, but written
// from scratch rather than reusing landlordStatementService.js, which is tightly wired to PMS-only models.
export const generateOwnerStatementData = async ({ businessId, ownerId, projectId = null, periodStart, periodEnd }) => {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);

  const projectFilter = { business: businessId, owner: ownerId };
  if (projectId) projectFilter._id = projectId;
  const projects = await SaleProject.find(projectFilter).select("_id name").lean();
  const projectIds = projects.map((p) => p._id);
  const projectNameById = new Map(projects.map((p) => [String(p._id), p.name]));

  if (!projectIds.length) {
    return { lines: [], totals: { grossProceeds: 0, companyCommission: 0, brokerCommission: 0, rechargedExpenses: 0, netBalance: 0 } };
  }

  const listings = await SaleListing.find({ business: businessId, project: { $in: projectIds } }).select("_id project title unitNumber").lean();
  const listingIds = listings.map((l) => l._id);
  const listingById = new Map(listings.map((l) => [String(l._id), l]));

  const deals = await SaleDeal.find({ business: businessId, listing: { $in: listingIds } }).select("_id listing dealNumber").lean();
  const dealIds = deals.map((d) => d._id);
  const dealById = new Map(deals.map((d) => [String(d._id), d]));
  const projectForDeal = (dealId) => {
    const deal = dealById.get(String(dealId));
    const listing = deal && listingById.get(String(deal.listing));
    return listing?.project || null;
  };

  const [payments, ownerCommissions, brokerCommissions, vouchers] = await Promise.all([
    SalePayment.find({
      business: businessId, deal: { $in: dealIds }, status: "paid",
      paymentDate: { $gte: start, $lte: end },
    }).select("amount paymentDate deal paymentNumber").lean(),
    SaleOwnerCommission.find({ business: businessId, owner: ownerId, deal: { $in: dealIds } }).select("tierReleases commissionNumber deal").lean(),
    SaleCommission.find({ business: businessId, owner: ownerId, deal: { $in: dealIds } }).select("tierReleases commissionNumber commissionAmount releaseSchedule status updatedAt deal").lean(),
    PaymentVoucher.find({
      business: businessId, saleOwner: ownerId, category: "sale_owner_expense",
      status: { $in: ["approved", "paid"] }, ...(projectId ? { saleProject: projectId } : { saleProject: { $in: projectIds } }),
    }).select("amount narration payeeName dueDate paidDate voucherNo saleProject").lean(),
  ]);

  const rawLines = [];

  for (const payment of payments) {
    const deal = dealById.get(String(payment.deal));
    rawLines.push({
      transactionDate: payment.paymentDate, category: "proceeds", direction: "credit", amount: round2(payment.amount),
      description: `Payment ${payment.paymentNumber || ""} — ${deal?.dealNumber || "deal"}`.trim(),
      deal: payment.deal, project: projectForDeal(payment.deal),
      sourceTransactionType: "property_sale_payment", sourceTransactionId: String(payment._id),
    });
  }

  for (const oc of ownerCommissions) {
    for (const tier of oc.tierReleases || []) {
      if (!inPeriod(tier.accruedAt, start, end)) continue;
      rawLines.push({
        transactionDate: tier.accruedAt, category: "company_commission", direction: "debit", amount: round2(tier.amount),
        description: `Company commission (${tier.thresholdPct}% paid) — ${oc.commissionNumber}`,
        deal: oc.deal, project: projectForDeal(oc.deal),
        sourceTransactionType: "property_sale_owner_commission_tier", sourceTransactionId: `${oc._id}:tier:${tier._id}`,
      });
    }
  }

  // The owner's cost is incurred the moment a broker's commission is RELEASED/accrued — not when the
  // company actually disburses cash to the broker, those are two different events on two different
  // ledgers (the owner's statement vs. the company's own payable). A staged commission releases via its
  // tierReleases; a legacy/immediate-mode one (no releaseSchedule) has no tiers at all — for that case,
  // the single moment it was manually approved (status >= "approved", the point postPropertySaleCommissionAccrual
  // actually posts the full amount) IS its one release event.
  for (const bc of brokerCommissions) {
    if (bc.releaseSchedule?.length) {
      for (const tier of bc.tierReleases || []) {
        if (!inPeriod(tier.accruedAt, start, end)) continue;
        rawLines.push({
          transactionDate: tier.accruedAt, category: "broker_commission", direction: "debit", amount: round2(tier.amount),
          description: `Broker commission (${tier.thresholdPct}% paid) — ${bc.commissionNumber}`,
          deal: bc.deal, project: projectForDeal(bc.deal),
          sourceTransactionType: "property_sale_commission_tier", sourceTransactionId: `${bc._id}:tier:${tier._id}`,
        });
      }
    } else if (["approved", "paid"].includes(bc.status) && inPeriod(bc.updatedAt, start, end)) {
      rawLines.push({
        transactionDate: bc.updatedAt, category: "broker_commission", direction: "debit", amount: round2(bc.commissionAmount),
        description: `Broker commission — ${bc.commissionNumber}`,
        deal: bc.deal, project: projectForDeal(bc.deal),
        sourceTransactionType: "property_sale_commission", sourceTransactionId: String(bc._id),
      });
    }
  }

  for (const v of vouchers) {
    const effectiveDate = v.paidDate || v.dueDate;
    if (!inPeriod(effectiveDate, start, end)) continue;
    rawLines.push({
      transactionDate: effectiveDate, category: "expense", direction: "debit", amount: round2(v.amount),
      description: `${v.voucherNo || "Expense"} — ${v.narration || v.payeeName || "recharged expense"}`.trim(),
      deal: null, project: v.saleProject,
      sourceTransactionType: "payment_voucher", sourceTransactionId: String(v._id),
    });
  }

  rawLines.sort((a, b) => new Date(a.transactionDate) - new Date(b.transactionDate));

  let runningBalance = 0;
  const lines = rawLines.map((line, i) => {
    runningBalance = round2(runningBalance + (line.direction === "credit" ? line.amount : -line.amount));
    return { ...line, lineNumber: i + 1, runningBalance, metadata: { projectName: projectNameById.get(String(line.project)) || null } };
  });

  const sumBy = (category) => round2(lines.filter((l) => l.category === category).reduce((s, l) => s + l.amount, 0));
  const grossProceeds = sumBy("proceeds");
  const companyCommission = sumBy("company_commission");
  const brokerCommission = sumBy("broker_commission");
  const rechargedExpenses = sumBy("expense");
  const netBalance = round2(grossProceeds - companyCommission - brokerCommission - rechargedExpenses);

  return { lines, totals: { grossProceeds, companyCommission, brokerCommission, rechargedExpenses, netBalance } };
};
