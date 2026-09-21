// Income and expenses grouped by a journal-line tag (project, unit, deal, agent, cost centre, property).
// Reads only the ledger, so it works for any company; a tag simply has no rows until something is tagged with it.
import mongoose from "mongoose";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import Property from "../../models/Property.js";
import SaleProject from "../../modules/propertySale/models/SaleProject.js";
import SaleDeal from "../../modules/propertySale/models/SaleDeal.js";
import SaleListing from "../../modules/propertySale/models/SaleListing.js";
import SaleAgent from "../../modules/propertySale/models/SaleAgent.js";
import { resolveBusinessId } from "../../utils/requestContext.js";
import { createError } from "../../utils/error.js";
import { round2 } from "../../utils/math.js";

// how each grouping reads the ledger entry, and how its ids are named
const GROUPINGS = {
  project:    { field: "dimensions.saleProject", model: SaleProject, label: (r) => [r.projectNumber, r.name].filter(Boolean).join(" · ") },
  deal:       { field: "dimensions.saleDeal",    model: SaleDeal,    label: (r) => r.dealNumber },
  listing:    { field: "dimensions.saleListing", model: SaleListing, label: (r) => [r.listingNumber, r.unitNumber ? `Unit ${r.unitNumber}` : r.title].filter(Boolean).join(" · ") },
  agent:      { field: "dimensions.saleAgent",   model: SaleAgent,   label: (r) => [r.agentNumber, r.fullName].filter(Boolean).join(" · ") },
  property:   { field: "property",               model: Property,    label: (r) => r.propertyName || r.name },
  costCentre: { field: "dimensions.costCentre",  model: null,        label: null },
};

const parseDate = (value, endOfDay) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999); else d.setHours(0, 0, 0, 0);
  return d;
};

export const getTagSummaryReport = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "A valid business id is required."));

    const by = String(req.query.by || "project");
    const grouping = GROUPINGS[by];
    if (!grouping) return next(createError(400, `Group by one of: ${Object.keys(GROUPINGS).join(", ")}.`));

    const now = new Date();
    const startDate = parseDate(req.query.startDate || new Date(now.getFullYear(), now.getMonth(), 1), false);
    const endDate = parseDate(req.query.endDate || now, true);
    if (!startDate || !endDate) return next(createError(400, "Invalid report dates supplied."));
    if (startDate > endDate) return next(createError(400, "Start date cannot be after end date."));

    const businessOid = new mongoose.Types.ObjectId(String(businessId));
    const tagged = by === "costCentre" ? { $nin: [null, ""] } : { $type: "objectId" };

    // Sum debits and credits per (tag, account). Reversed entries stay in: their reversal entry offsets them.
    const rows = await FinancialLedgerEntry.aggregate([
      { $match: { business: businessOid, status: { $in: ["approved", "reversed"] }, transactionDate: { $gte: startDate, $lte: endDate }, [grouping.field]: tagged } },
      {
        $group: {
          _id: { tag: `$${grouping.field}`, account: "$accountId" },
          debit: { $sum: { $cond: [{ $gt: ["$debit", 0] }, "$debit", { $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "debit"] }, { $ifNull: ["$amount", 0] }, 0] }] } },
          credit: { $sum: { $cond: [{ $gt: ["$credit", 0] }, "$credit", { $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "credit"] }, { $ifNull: ["$amount", 0] }, 0] }] } },
        },
      },
    ]).allowDiskUse(true);

    const accountIds = [...new Set(rows.map((r) => String(r._id.account)))];
    const tagIds = by === "costCentre" ? [] : [...new Set(rows.map((r) => String(r._id.tag)))];
    const [accounts, tagDocs] = await Promise.all([
      ChartOfAccount.find({ _id: { $in: accountIds }, business: businessId, type: { $in: ["income", "expense"] } }).select("_id type").lean(),
      grouping.model && tagIds.length ? grouping.model.find({ _id: { $in: tagIds }, business: businessId }).lean() : [],
    ]);
    const typeById = new Map(accounts.map((a) => [String(a._id), a.type]));
    const labelById = new Map(tagDocs.map((d) => [String(d._id), grouping.label(d) || String(d._id)]));

    const byTag = new Map();
    for (const row of rows) {
      const type = typeById.get(String(row._id.account));
      if (!type) continue; // balance-sheet accounts are not part of a profit and loss
      const key = String(row._id.tag);
      const item = byTag.get(key) || { key, label: by === "costCentre" ? key : labelById.get(key) || "Removed record", income: 0, expenses: 0 };
      if (type === "income") item.income += row.credit - row.debit;
      else item.expenses += row.debit - row.credit;
      byTag.set(key, item);
    }

    const list = [...byTag.values()]
      .map((r) => ({ ...r, income: round2(r.income), expenses: round2(r.expenses), net: round2(r.income - r.expenses) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const totals = list.reduce((t, r) => ({ income: t.income + r.income, expenses: t.expenses + r.expenses }), { income: 0, expenses: 0 });

    return res.status(200).json({
      success: true,
      by,
      startDate,
      endDate,
      rows: list,
      totals: { income: round2(totals.income), expenses: round2(totals.expenses), net: round2(totals.income - totals.expenses) },
    });
  } catch (error) {
    next(error);
  }
};
