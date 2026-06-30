import mongoose from "mongoose";
import Company from "../models/Company.js";
import Landlord from "../models/Landlord.js";
import Tenant from "../models/Tenant.js";
import ProcessedStatement from "../models/ProcessedStatement.js";
import CarWashCustomer from "../modules/carwash/models/CarWashCustomer.js";

async function readIndexes(model) {
  try {
    return await model.collection.indexes();
  } catch (error) {
    if (error?.code === 26 || error?.codeName === "NamespaceNotFound") {
      return [];
    }
    throw error;
  }
}

async function dropStaleIndexIfNeeded(model, indexName, shouldDrop) {
  const indexes = await readIndexes(model);
  const index = indexes.find((item) => item?.name === indexName);

  if (!index) return false;
  if (typeof shouldDrop === "function" && !shouldDrop(index)) return false;

  await model.collection.dropIndex(indexName);
  return true;
}

export async function syncCriticalIndexes() {
  const dropped = [];

  if (
    await dropStaleIndexIfNeeded(
      Company,
      "registrationNo_1",
      (index) => Boolean(index?.unique) && !index?.partialFilterExpression
    )
  ) {
    dropped.push("companies.registrationNo_1");
  }

  if (await dropStaleIndexIfNeeded(Company, "accessKeys.adminKey_1", () => true)) {
    dropped.push("companies.accessKeys.adminKey_1");
  }

  if (await dropStaleIndexIfNeeded(Company, "accessKeys.normalKey_1", () => true)) {
    dropped.push("companies.accessKeys.normalKey_1");
  }

  if (
    await dropStaleIndexIfNeeded(
      Landlord,
      "idNumber_1",
      (index) => Boolean(index?.unique) && !Object.prototype.hasOwnProperty.call(index?.key || {}, "company")
    )
  ) {
    dropped.push("landlords.idNumber_1");
  }

  // Landlord regId and idNumber indexes must use partialFilterExpression.
  // sparse:true still indexes null — drop so Landlord.syncIndexes() recreates correctly.
  if (
    await dropStaleIndexIfNeeded(
      Landlord,
      "company_1_regId_1",
      (index) => Boolean(index?.unique) && !index?.partialFilterExpression
    )
  ) {
    dropped.push("landlords.company_1_regId_1");
  }

  if (
    await dropStaleIndexIfNeeded(
      Landlord,
      "company_1_idNumber_1",
      (index) => Boolean(index?.unique) && !index?.partialFilterExpression
    )
  ) {
    dropped.push("landlords.company_1_idNumber_1");
  }

  if (
    await dropStaleIndexIfNeeded(
      ProcessedStatement,
      "business_1_sourceStatement_1",
      (index) => Boolean(index?.unique) && !index?.partialFilterExpression
    )
  ) {
    dropped.push("processedstatements.business_1_sourceStatement_1");
  }

  // Drop old phone index if it lacks partialFilterExpression.
  // sparse:true alone still indexes null values — partialFilterExpression is required
  // to truly allow multiple customers with no phone number per business.
  if (
    await dropStaleIndexIfNeeded(
      CarWashCustomer,
      "business_1_phone_1",
      (index) => Boolean(index?.unique) && !index?.partialFilterExpression
    )
  ) {
    dropped.push("carwashcustomers.business_1_phone_1");
  }

  // Fix Tenant idNumber index — must use partialFilterExpression so multiple tenants
  // can have idNumber: null without conflicting. sparse:true alone still indexes null
  // values; only partialFilterExpression truly excludes them from the index.
  // syncIndexes() does NOT detect partialFilterExpression differences, so we use raw
  // MongoDB drop + createIndex to guarantee the correct index spec is in place.
  try {
    const tenantCol = mongoose.connection.db.collection("tenants");
    const tenantIndexes = await tenantCol.indexes();
    const stale = tenantIndexes.find(
      (i) => i.name === "business_1_idNumber_1" && !i.partialFilterExpression
    );
    if (stale) {
      await tenantCol.dropIndex("business_1_idNumber_1");
      await tenantCol.createIndex(
        { business: 1, idNumber: 1 },
        { unique: true, partialFilterExpression: { idNumber: { $type: "string", $ne: "" } } }
      );
      dropped.push("tenants.business_1_idNumber_1 (rebuilt partialFilterExpression)");
      console.log("[indexMaintenance] Rebuilt tenants.business_1_idNumber_1 with partialFilterExpression.");
    }
  } catch (e) {
    console.warn("[indexMaintenance] Could not fix Tenant idNumber index:", e?.message);
  }

  await Company.syncIndexes();
  await Landlord.syncIndexes();
  await Tenant.syncIndexes();
  await ProcessedStatement.syncIndexes();
  await CarWashCustomer.syncIndexes();

  return {
    dropped,
    synced: ["Company", "Landlord", "Tenant", "ProcessedStatement", "CarWashCustomer"],
  };
}

export default syncCriticalIndexes;
