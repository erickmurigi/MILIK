import mongoose from "mongoose";
import SaleProject from "../models/SaleProject.js";
import SaleListing from "../models/SaleListing.js";
import SaleDeal from "../models/SaleDeal.js";
import SalePayment from "../models/SalePayment.js";
import SaleCommission from "../models/SaleCommission.js";
import SaleOwnerCommission from "../models/SaleOwnerCommission.js";
import SaleOwnerPayout from "../models/SaleOwnerPayout.js";
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
  // A human label for which plot/unit a line belongs to — an owner with several plots under one
  // project can't tell "DL-00007" apart from "DL-00009" on sight, so every proceeds/commission
  // description below leads with this instead of (or alongside) the internal deal number.
  const listingLabelForDeal = (dealId) => {
    const deal = dealById.get(String(dealId));
    const listing = deal && listingById.get(String(deal.listing));
    if (listing?.title) return listing.title;
    if (listing?.unitNumber) return `Unit ${listing.unitNumber}`;
    return deal?.dealNumber || "Deal";
  };

  const [payments, ownerCommissions, brokerCommissions, vouchers, ownerPayouts] = await Promise.all([
    SalePayment.find({
      business: businessId, deal: { $in: dealIds }, status: "paid",
      paymentDate: { $gte: start, $lte: end },
    }).select("amount paymentDate deal paymentNumber").lean(),
    SaleOwnerCommission.find({ business: businessId, owner: ownerId, deal: { $in: dealIds } }).select("tierReleases commissionNumber commissionRate commissionType status deal").lean(),
    SaleCommission.find({ business: businessId, owner: ownerId, deal: { $in: dealIds } }).select("tierReleases commissionNumber commissionAmount commissionRate commissionType releaseSchedule status updatedAt deal").lean(),
    // saleProject is optional on the voucher (an owner-level recharge — e.g. a legal fee covering the
    // relationship generally, not one plot — has no project at all) — when the statement isn't scoped
    // to one specific project, a project-less voucher must still show up here. `$in` with `null` in the
    // list matches both an explicit null and a missing field, so this doesn't silently drop them the
    // way a bare `saleProject: {$in: projectIds}` (no null) used to. When the statement IS scoped to one
    // project, a project-less (owner-general) recharge deliberately stays out of it — it isn't that
    // project's cost to show.
    PaymentVoucher.find({
      business: businessId, saleOwner: ownerId, category: "sale_owner_expense",
      status: { $in: ["approved", "paid"] }, ...(projectId ? { saleProject: projectId } : { saleProject: { $in: [...projectIds, null] } }),
    }).select("amount narration payeeName dueDate paidDate voucherNo saleProject").lean(),
    // Money actually paid out to the owner (company cashbook or advocate trust) — so a statement run
    // after a payout reflects what's really still outstanding, not the full gross balance forever.
    SaleOwnerPayout.find({ business: businessId, owner: ownerId, status: { $ne: "cancelled" } }).select("amount cgtAmount date payoutNumber deal").lean(),
  ]);

  const rawLines = [];

  // "3%" for a percentage-rate commission, "KES 50,000" for a flat one — shown inline so the owner can
  // verify the deduction without cross-checking the Commissions page, since the rate genuinely does vary
  // per agent/deal and does get corrected after the fact (see recalculateCommissionRate).
  const rateLabel = (rate, type) => (type === "flat" ? `KES ${Number(rate || 0).toLocaleString()}` : `${rate}%`);

  // Every line below reads "{Plot} — what happened · reference" — the same shape, category to
  // category, so an owner skimming several plots down the page can scan the dash-separated
  // explanation without having to parse each category's own phrasing style.
  for (const payment of payments) {
    const deal = dealById.get(String(payment.deal));
    rawLines.push({
      transactionDate: payment.paymentDate, category: "proceeds", direction: "credit", amount: round2(payment.amount),
      description: `${listingLabelForDeal(payment.deal)} — Payment received from buyer · ${payment.paymentNumber || deal?.dealNumber || "—"}`,
      deal: payment.deal, project: projectForDeal(payment.deal),
      sourceTransactionType: "property_sale_payment", sourceTransactionId: String(payment._id),
    });
  }

  for (const oc of ownerCommissions) {
    // A cancelled deal's commission keeps its tierReleases array for audit history on the commission
    // record itself (dealsController.cancelDeal deliberately doesn't clear it), but the GL impact of
    // every one of those tiers has already been reversed — so none of them are a real cost to the owner
    // any more, and must not leak back into a statement as if they still were.
    if (oc.status === "cancelled") continue;
    for (const tier of oc.tierReleases || []) {
      if (!inPeriod(tier.accruedAt, start, end)) continue;
      rawLines.push({
        transactionDate: tier.accruedAt, category: "company_commission", direction: "debit", amount: round2(tier.amount),
        // thresholdPct is the tier's configured milestone, not necessarily the buyer's exact cumulative
        // %paid at this moment — a single payment can jump past several tiers at once (e.g. 10% -> 60%
        // crosses both a 30% and a 50% tier in the same pass), so "passed the Nth% milestone" is the
        // honest claim; "buyer has paid N%" would be flatly wrong whenever that happens.
        description: `${listingLabelForDeal(oc.deal)} — Agency commission released at ${rateLabel(oc.commissionRate, oc.commissionType)}, passed the ${tier.thresholdPct}% payment milestone · ${oc.commissionNumber}`,
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
    // Same reasoning as the owner-commission loop above: "cancelled" means every tier's GL impact was
    // already reversed on cancellation, even though the tierReleases array itself is kept for history.
    // "reversed" is a different, narrower case (a mistaken PAYOUT corrected after the fact) where the
    // accrual itself deliberately stays live — see reversePropertySaleCommissionPayout — so it is NOT
    // excluded here.
    if (bc.status === "cancelled") continue;
    if (bc.releaseSchedule?.length) {
      for (const tier of bc.tierReleases || []) {
        if (!inPeriod(tier.accruedAt, start, end)) continue;
        rawLines.push({
          transactionDate: tier.accruedAt, category: "broker_commission", direction: "debit", amount: round2(tier.amount),
          description: `${listingLabelForDeal(bc.deal)} — Broker commission released at ${rateLabel(bc.commissionRate, bc.commissionType)}, passed the ${tier.thresholdPct}% payment milestone · ${bc.commissionNumber}`,
          deal: bc.deal, project: projectForDeal(bc.deal),
          sourceTransactionType: "property_sale_commission_tier", sourceTransactionId: `${bc._id}:tier:${tier._id}`,
        });
      }
    } else if (["approved", "paid"].includes(bc.status) && inPeriod(bc.updatedAt, start, end)) {
      rawLines.push({
        transactionDate: bc.updatedAt, category: "broker_commission", direction: "debit", amount: round2(bc.commissionAmount),
        description: `${listingLabelForDeal(bc.deal)} — Broker commission at ${rateLabel(bc.commissionRate, bc.commissionType)} (full release) · ${bc.commissionNumber}`,
        deal: bc.deal, project: projectForDeal(bc.deal),
        sourceTransactionType: "property_sale_commission", sourceTransactionId: String(bc._id),
      });
    }
  }

  for (const v of vouchers) {
    const effectiveDate = v.paidDate || v.dueDate;
    if (!inPeriod(effectiveDate, start, end)) continue;
    const projLabel = v.saleProject ? projectNameById.get(String(v.saleProject)) : null;
    const what = v.narration || (v.payeeName ? `Paid to ${v.payeeName}` : "Recharged expense");
    rawLines.push({
      transactionDate: effectiveDate, category: "expense", direction: "debit", amount: round2(v.amount),
      description: `${projLabel ? `${projLabel} — ` : ""}${what}${v.voucherNo ? ` · ${v.voucherNo}` : ""}`,
      deal: null, project: v.saleProject,
      sourceTransactionType: "payment_voucher", sourceTransactionId: String(v._id),
    });
  }

  for (const p of ownerPayouts) {
    if (!inPeriod(p.date, start, end)) continue;
    // The owner's entitlement is reduced by the FULL claim settled (cash paid + any CGT withheld on
    // their behalf), not just the cash they physically received — otherwise a withheld-CGT portion would
    // never leave their statement balance even though it's gone for good.
    const cgt = round2(p.cgtAmount || 0);
    rawLines.push({
      transactionDate: p.date, category: "owner_payout", direction: "debit", amount: round2(p.amount + cgt),
      description: `Paid out to owner${p.payoutNumber ? ` · ${p.payoutNumber}` : ""}${cgt > 0 ? ` (incl. KES ${cgt.toLocaleString()} CGT withheld)` : ""}`,
      deal: p.deal || null, project: p.deal ? projectForDeal(p.deal) : null,
      sourceTransactionType: "property_sale_owner_payout", sourceTransactionId: String(p._id),
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
  const ownerPayoutsTotal = sumBy("owner_payout");
  const netBalance = round2(grossProceeds - companyCommission - brokerCommission - rechargedExpenses - ownerPayoutsTotal);

  return { lines, totals: { grossProceeds, companyCommission, brokerCommission, rechargedExpenses, ownerPayouts: ownerPayoutsTotal, netBalance } };
};
