import mongoose from "mongoose";
import dotenv from "dotenv";
import TenantInvoice from "../models/TenantInvoice.js";

dotenv.config();

const MONTH_LOOKUP = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const ACTIVE_STATUSES = new Set(["pending", "paid", "partially_paid"]);

const getArg = (name) => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : "";
};

const hasFlag = (name) => process.argv.includes(`--${name}`);

const normalizeDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const parsePeriodLabel = (raw = "") => {
  const value = String(raw || "").trim();
  if (!value) return null;

  const directMatch = value.match(/\b([A-Za-z]{3,9})\s+(20\d{2})\b/);
  if (!directMatch) return null;

  const monthKey = String(directMatch[1] || "").trim().toLowerCase();
  const month = MONTH_LOOKUP[monthKey];
  const year = Number(directMatch[2]);

  if (!Number.isInteger(month) || !Number.isInteger(year)) return null;
  return { month, year, label: `${directMatch[1]} ${year}` };
};

const resolveIntendedPeriod = (invoice = {}) => {
  const metadataLabel = String(invoice?.metadata?.periodLabel || "").trim();
  const fromMetadata = parsePeriodLabel(metadataLabel);
  if (fromMetadata) return fromMetadata;

  const description = String(invoice?.description || "").trim();
  const fromDescription = parsePeriodLabel(description);
  if (fromDescription) return fromDescription;

  return null;
};

const isShiftPattern = (invoiceDate, dueDate, createdAt, intendedPeriod) => {
  if (!invoiceDate || !dueDate || !createdAt || !intendedPeriod) return false;

  const invoiceMonth = invoiceDate.getMonth();
  const invoiceYear = invoiceDate.getFullYear();
  const dueMonth = dueDate.getMonth();
  const dueYear = dueDate.getFullYear();
  const createdMonth = createdAt.getMonth();
  const createdYear = createdAt.getFullYear();

  const matchesIntended = dueMonth === intendedPeriod.month && dueYear === intendedPeriod.year;
  const createdMatchesIntended = createdMonth === intendedPeriod.month && createdYear === intendedPeriod.year;

  if (!matchesIntended || !createdMatchesIntended) return false;

  const previousMonth = intendedPeriod.month === 0 ? 11 : intendedPeriod.month - 1;
  const previousMonthYear = intendedPeriod.month === 0 ? intendedPeriod.year - 1 : intendedPeriod.year;

  return (
    invoiceDate.getDate() === 1 &&
    dueDate.getDate() === 5 &&
    invoiceMonth === previousMonth &&
    invoiceYear === previousMonthYear
  );
};

const buildMonthStart = (year, month) => new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
const buildMonthDueDate = (year, month) => new Date(Date.UTC(year, month, 5, 23, 59, 59, 999));

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) {
    throw new Error("MONGO_URL is required.");
  }

  const businessId = getArg("business");
  const fromArg = getArg("from");
  const toArg = getArg("to");
  const apply = hasFlag("apply");

  const query = {
    category: { $in: ["RENT_CHARGE", "UTILITY_CHARGE"] },
    status: { $in: Array.from(ACTIVE_STATUSES) },
    $or: [
      { "metadata.sourceTransactionType": { $exists: false } },
      { "metadata.sourceTransactionType": { $ne: "meter_reading" } },
    ],
  };

  if (businessId) query.business = businessId;
  if (fromArg || toArg) {
    query.createdAt = {};
    if (fromArg) query.createdAt.$gte = new Date(`${fromArg}T00:00:00.000Z`);
    if (toArg) query.createdAt.$lte = new Date(`${toArg}T23:59:59.999Z`);
  }

  await mongoose.connect(mongoUrl);

  const invoices = await TenantInvoice.find(query)
    .sort({ createdAt: 1, invoiceDate: 1 })
    .lean();

  const candidates = [];

  for (const invoice of invoices) {
    const intendedPeriod = resolveIntendedPeriod(invoice);
    if (!intendedPeriod) continue;

    const invoiceDate = normalizeDate(invoice.invoiceDate);
    const dueDate = normalizeDate(invoice.dueDate);
    const createdAt = normalizeDate(invoice.createdAt);
    if (!isShiftPattern(invoiceDate, dueDate, createdAt, intendedPeriod)) continue;

    const correctedInvoiceDate = buildMonthStart(intendedPeriod.year, intendedPeriod.month);
    const correctedDueDate = buildMonthDueDate(intendedPeriod.year, intendedPeriod.month);

    candidates.push({
      _id: String(invoice._id),
      invoiceNumber: invoice.invoiceNumber,
      business: String(invoice.business || ""),
      storedInvoiceDate: invoiceDate?.toISOString() || null,
      storedDueDate: dueDate?.toISOString() || null,
      createdAt: createdAt?.toISOString() || null,
      intendedPeriod: intendedPeriod.label,
      correctedInvoiceDate: correctedInvoiceDate.toISOString(),
      correctedDueDate: correctedDueDate.toISOString(),
    });
  }

  console.log(`Detected ${candidates.length} shifted monthly invoice(s).`);
  if (candidates.length > 0) {
    console.table(
      candidates.slice(0, 25).map((item) => ({
        invoiceNumber: item.invoiceNumber,
        intendedPeriod: item.intendedPeriod,
        storedInvoiceDate: item.storedInvoiceDate?.slice(0, 10),
        correctedInvoiceDate: item.correctedInvoiceDate.slice(0, 10),
        storedDueDate: item.storedDueDate?.slice(0, 10),
        correctedDueDate: item.correctedDueDate.slice(0, 10),
      }))
    );
  }

  if (!apply || candidates.length === 0) {
    console.log(apply ? "Nothing to update." : "Dry run only. Re-run with --apply to persist fixes.");
    await mongoose.disconnect();
    return;
  }

  const bulkOps = candidates.map((item) => ({
    updateOne: {
      filter: { _id: item._id },
      update: {
        $set: {
          invoiceDate: new Date(item.correctedInvoiceDate),
          dueDate: new Date(item.correctedDueDate),
          "metadata.periodShiftFixedAt": new Date(),
          "metadata.periodShiftFixedBy": "fixShiftedMonthlyInvoices",
        },
      },
    },
  }));

  const result = await TenantInvoice.bulkWrite(bulkOps, { ordered: false });
  console.log(`Updated ${result.modifiedCount || 0} invoice(s).`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Shifted invoice cleanup failed:", error);
  try {
    await mongoose.disconnect();
  } catch (_error) {
    // ignore disconnect cleanup issue
  }
  process.exit(1);
});
