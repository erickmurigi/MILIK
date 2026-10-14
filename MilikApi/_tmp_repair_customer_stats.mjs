import 'dotenv/config';
import mongoose from 'mongoose';
import Company from './models/Company.js';
import CarWashCustomer from './modules/carwash/models/CarWashCustomer.js';
import { recomputeCustomerStats } from './modules/carwash/services/customerStatsService.js';

const companyNameFilter = process.argv[2] || 'Lex';

await mongoose.connect(process.env.MONGO_URL, { serverSelectionTimeoutMS: 20000 });
console.log('Connected to', mongoose.connection.name);

const company = await Company.findOne({ companyName: new RegExp(companyNameFilter, 'i') }).select('_id companyName').lean();
if (!company) {
  console.error(`No company matching "${companyNameFilter}" found`);
  process.exit(1);
}
console.log('Repairing stats for company:', company.companyName, company._id.toString());

const totalCustomers = await CarWashCustomer.countDocuments({ business: company._id });
console.log(`Total customers to process: ${totalCustomers}\n`);

const startedAt = Date.now();
const cursor = CarWashCustomer.find({ business: company._id }, { _id: 1, plates: 1, name: 1, 'stats.outstanding': 1 }).lean().cursor();
let processed = 0, changed = 0, failed = 0;
const changedSamples = [];

for await (const customer of cursor) {
  const plate = (customer.plates || [])[0];
  if (!plate) { processed++; continue; }
  const before = Number(customer.stats?.outstanding || 0);
  try {
    await recomputeCustomerStats(company._id, plate);
    const after = await CarWashCustomer.findById(customer._id).select('stats.outstanding').lean();
    const afterVal = Number(after?.stats?.outstanding || 0);
    if (Math.abs(afterVal - before) > 0.01) {
      changed++;
      if (changedSamples.length < 15) changedSamples.push({ name: customer.name, before, after: afterVal });
    }
    processed++;
  } catch (e) {
    failed++;
    console.error('Failed for', customer.name, e?.message);
  }
  if (processed % 100 === 0 || processed === totalCustomers) {
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    const rate = processed / Math.max(elapsedSec, 1);
    const etaSec = rate > 0 ? Math.round((totalCustomers - processed) / rate) : 0;
    console.log(`  ...${processed}/${totalCustomers} (${changed} changed so far) — elapsed ${elapsedSec}s, ETA ~${etaSec}s`);
  }
}

const totalElapsedSec = Math.round((Date.now() - startedAt) / 1000);
console.log(`\nDone in ${totalElapsedSec}s. processed=${processed} changed=${changed} failed=${failed}`);
console.log('\nSample corrections (first 15):');
for (const s of changedSamples) {
  console.log(`  ${s.name}: ${s.before} -> ${s.after}`);
}

await mongoose.disconnect();
process.exit(0);
