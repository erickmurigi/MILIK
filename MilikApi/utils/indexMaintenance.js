import Company from "../models/Company.js";
import Landlord from "../models/Landlord.js";
import ProcessedStatement from "../models/ProcessedStatement.js";

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

  if (
    await dropStaleIndexIfNeeded(
      ProcessedStatement,
      "business_1_sourceStatement_1",
      (index) => Boolean(index?.unique) && !index?.partialFilterExpression
    )
  ) {
    dropped.push("processedstatements.business_1_sourceStatement_1");
  }

  await Company.syncIndexes();
  await Landlord.syncIndexes();
  await ProcessedStatement.syncIndexes();

  return {
    dropped,
    synced: ["Company", "Landlord", "ProcessedStatement"],
  };
}

export default syncCriticalIndexes;
