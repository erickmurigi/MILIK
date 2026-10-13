// Expense items used to carry `category` as one of 5 fixed strings (maintenance/utilities/staffing/
// supplies/other). That's now an admin-configurable list (CompanySettings.expenseCategories) and
// `expenseItem.category` is an ObjectId pointing into it. This backfills every company: creates a
// matching category record for each legacy string value actually in use (skipping ones that already
// exist, so this is safe to re-run), then repoints each expense item at the new category's _id.
// Uses the raw collection (not the Mongoose model), so it works regardless of whether the model file's
// schema has already been updated to the new ObjectId type.
//
// Dry run by default: node scripts/migrateExpenseItemCategories.js
// Apply the change:   node scripts/migrateExpenseItemCategories.js --apply
import "dotenv/config";
import mongoose from "mongoose";

const apply = process.argv.includes("--apply");

const LABELS = { maintenance: "Maintenance", utilities: "Utilities", staffing: "Staffing", supplies: "Supplies", other: "Other" };

await mongoose.connect(process.env.MONGO_URL, { serverSelectionTimeoutMS: 30000 });
const settingsColl = mongoose.connection.db.collection("companysettings");

const docs = await settingsColl.find({ "expenseItems.0": { $exists: true } }).toArray();
console.log(`Company settings documents with expense items: ${docs.length}`);

let companiesTouched = 0;
let itemsMigrated = 0;
let categoriesCreated = 0;

for (const doc of docs) {
  const existingCategories = Array.isArray(doc.expenseCategories) ? [...doc.expenseCategories] : [];
  const items = Array.isArray(doc.expenseItems) ? doc.expenseItems : [];
  const legacyValues = [...new Set(items.filter((i) => typeof i.category === "string" && i.category).map((i) => i.category))];
  if (!legacyValues.length) continue;

  const nameToId = new Map(existingCategories.map((c) => [String(c.name).toLowerCase(), c._id]));
  const newCategories = [];
  for (const value of legacyValues) {
    const label = LABELS[value] || (value.charAt(0).toUpperCase() + value.slice(1));
    if (nameToId.has(label.toLowerCase())) continue;
    const _id = new mongoose.Types.ObjectId();
    nameToId.set(label.toLowerCase(), _id);
    newCategories.push({ _id, name: label, description: "", isActive: true, createdAt: new Date() });
  }

  const updatedItems = items.map((item) => {
    if (typeof item.category !== "string" || !item.category) return item;
    const label = LABELS[item.category] || (item.category.charAt(0).toUpperCase() + item.category.slice(1));
    return { ...item, category: nameToId.get(label.toLowerCase()) };
  });

  console.log(`Company ${doc._id}: ${legacyValues.length} legacy value(s) in use, ${newCategories.length} new category record(s), ${updatedItems.length} item(s) to repoint`);
  companiesTouched += 1;
  categoriesCreated += newCategories.length;
  itemsMigrated += updatedItems.length;

  if (apply) {
    await settingsColl.updateOne(
      { _id: doc._id },
      { $set: { expenseCategories: [...existingCategories, ...newCategories], expenseItems: updatedItems } }
    );
  }
}

console.log(`\nCompanies touched: ${companiesTouched}`);
console.log(`Category records created: ${categoriesCreated}`);
console.log(`Expense items repointed: ${itemsMigrated}`);
if (!apply) console.log("\nDry run only. Re-run with --apply to write these changes.");

await mongoose.disconnect();
