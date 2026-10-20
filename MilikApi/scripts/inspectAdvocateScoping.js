// Read-only diagnostic: for every SaleAdvocate linked to a User, reports whether that User's company
// context actually matches the advocate's business, and how many projects/listings/deals would resolve
// as "theirs" under the scoping logic in middleware/advocateScope.js — to root-cause "an advocate logs
// in and sees none of their listings/deals" without guessing.
//
//   node scripts/inspectAdvocateScoping.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import SaleAdvocate from "../modules/propertySale/models/SaleAdvocate.js";
import SaleProject from "../modules/propertySale/models/SaleProject.js";
import SaleListing from "../modules/propertySale/models/SaleListing.js";
import SaleDeal from "../modules/propertySale/models/SaleDeal.js";
import SalePayment from "../modules/propertySale/models/SalePayment.js";
import SaleCommission from "../modules/propertySale/models/SaleCommission.js";
import SaleOwner from "../modules/propertySale/models/SaleOwner.js";
import User from "../models/User.js";
import { ownListingIds, ownAdvocateDealIds, ownAdvocateProjectIds } from "../modules/propertySale/middleware/advocateScope.js";

dotenv.config();

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  await mongoose.connect(mongoUrl);

  const advocates = await SaleAdvocate.find({}).lean();
  console.log(`Found ${advocates.length} SaleAdvocate record(s) total.\n`);

  for (const adv of advocates) {
    console.log(`── ${adv.fullName} (${adv.advocateNumber}) — business=${adv.business} — _id=${adv._id}`);
    const userIds = Array.isArray(adv.userIds) ? adv.userIds : [];
    if (!userIds.length) {
      console.log("   userIds: (not linked — no portal login for this advocate)\n");
      continue;
    }

    for (const uid of userIds) {
      const user = await User.findById(uid).select(
        "email profile locked isActive company primaryCompany accessibleCompanies companyAssignments"
      ).lean();
      if (!user) {
        console.log(`   userId: ${uid} — ORPHANED, no such User exists`);
        continue;
      }

      console.log(`   linked user: ${user.email} (profile=${user.profile}, locked=${!!user.locked}, isActive=${user.isActive !== false})`);
      const userCompanyIds = [
        user.company?.toString(),
        user.primaryCompany?.toString(),
        ...(Array.isArray(user.accessibleCompanies) ? user.accessibleCompanies.map((c) => c?.toString()) : []),
      ].filter(Boolean);
      const businessMatches = userCompanyIds.includes(String(adv.business));
      console.log(`   user's company context: company=${user.company} primaryCompany=${user.primaryCompany} accessibleCompanies=[${(user.accessibleCompanies || []).join(", ")}]`);
      console.log(`   >>> advocate.business is in user's accessible companies: ${businessMatches ? "YES" : "NO <-- would break attachAdvocateScope's business lookup"}`);

      const assignment = (user.companyAssignments || []).find((a) => a?.company?.toString() === String(adv.business));
      if (assignment) {
        const grants = assignment.permissions?.propertySale || {};
        console.log(`   companyAssignments[propertySale] moduleAccess=${assignment.moduleAccess?.propertySale || "(none)"}`);
        console.log(`   companyAssignments[pms] moduleAccess=${assignment.moduleAccess?.pms || "(none)"}`);
        console.log(`   explicit grants on "sale-deals": ${JSON.stringify(grants["sale-deals"] || {})}`);
        console.log(`   explicit grants on "sale-listings": ${JSON.stringify(grants["sale-listings"] || {})}`);
      } else {
        console.log("   >>> NO companyAssignments entry for advocate.business on this user at all <-- would deny every propertySale route for this business");
      }
    }

    // Use the REAL exported helpers (fake req carrying just the resolved advocate id) so this diagnostic
    // can never drift from what the live scoping logic actually does.
    const fakeReq = { saleAdvocateId: String(adv._id) };
    const listingIds = await ownListingIds(fakeReq, adv.business);
    const dealIds = await ownAdvocateDealIds(fakeReq, adv.business);
    const projectIds = await ownAdvocateProjectIds(fakeReq, adv.business);
    const ownerIds = projectIds.length ? await SaleProject.distinct("owner", { business: adv.business, _id: { $in: projectIds } }) : [];

    const dealsWithOwnAdvocate = await SaleDeal.countDocuments({ business: adv.business, advocate: adv._id });
    const paymentCount = await SalePayment.countDocuments({ business: adv.business, deal: { $in: dealIds } });
    const totalPaymentCountForBusiness = await SalePayment.countDocuments({ business: adv.business });
    const commissionCount = await SaleCommission.countDocuments({ business: adv.business, deal: { $in: dealIds } });
    const owners = ownerIds.length ? await SaleOwner.find({ _id: { $in: ownerIds } }).select("fullName ownerNumber").lean() : [];
    console.log(`   resolves to: ${projectIds.length} project(s), ${listingIds.length} listing(s), ${dealIds.length} deal(s) (${dealsWithOwnAdvocate} with deal.advocate set directly), ${paymentCount} payment(s) in-scope, ${commissionCount} commission(s) in-scope`);
    console.log(`   owners now visible: ${owners.map((o) => `${o.fullName} (${o.ownerNumber})`).join(", ") || "(none)"}`);
    console.log(`   (for reference: business has ${totalPaymentCountForBusiness} payment(s) total — that's what an UNSCOPED list would leak)\n`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
