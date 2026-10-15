import 'dotenv/config';
import mongoose from 'mongoose';
import Company from './models/Company.js';
import CarWashCustomer from './modules/carwash/models/CarWashCustomer.js';
import { recomputeCustomerStatsForPlates } from './modules/carwash/services/customerStatsService.js';

const companyNameFilter = process.argv[2] || 'Lex';
const CHUNK_SIZE = 300;

await mongoose.connect(process.env.MONGO_URL, { serverSelectionTimeoutMS: 20000 });
console.log('Connected to', mongoose.connection.name);

const company = await Company.findOne({ companyName: new RegExp(companyNameFilter, 'i') }).select('_id companyName').lean();
if (!company) {
  console.error(`No company matching "${companyNameFilter}" found`);
  process.exit(1);
}
console.log('Repairing stats for company:', company.companyName, company._id.toString());

const totalCustomers = await CarWashCustomer.countDocuments({ business: company._id });
console.log(`Total customers to process: ${totalCustomers} (in chunks of ${CHUNK_SIZE})\n`);

const startedAt = Date.now();
let processed = 0, changed = 0, failed = 0, lastId = null;
const changedSamples = [];

while (processed < totalCustomers) {
  const filter = { business: company._id, ...(lastId ? { _id: { $gt: lastId } } : {}) };
  const chunk = await CarWashCustomer.find(filter, { _id: 1, plates: 1, name: 1, 'stats.outstanding': 1 })
    .sort({ _id: 1 }).limit(CHUNK_SIZE).lean();
  if (!chunk.length) break;
  lastId = chunk[chunk.length - 1]._id;

  const beforeMap = new Map(chunk.map((c) => [String(c._id), Number(c.stats?.outstanding || 0)]));
  const allPlates = [...new Set(chunk.flatMap((c) => c.plates || []))];

  try {
    if (allPlates.length) await recomputeCustomerStatsForPlates(company._id, allPlates);

    const afterDocs = await CarWashCustomer.find(
      { _id: { $in: chunk.map((c) => c._id) } },
      { _id: 1, name: 1, 'stats.outstanding': 1 }
    ).lean();
    for (const doc of afterDocs) {
      const before = beforeMap.get(String(doc._id)) || 0;
      const after = Number(doc.stats?.outstanding || 0);
      if (Math.abs(after - before) > 0.01) {
        changed++;
        if (changedSamples.length < 20) changedSamples.push({ name: doc.name, before, after });
      }
    }
  } catch (e) {
    failed += chunk.length;
    console.error('Chunk failed:', e?.message);
  }

  processed += chunk.length;
  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  const rate = processed / Math.max(elapsedSec, 1);
  const etaSec = rate > 0 ? Math.round((totalCustomers - processed) / rate) : 0;
  console.log(`  ...${processed}/${totalCustomers} (${changed} changed so far) — elapsed ${elapsedSec}s, ETA ~${etaSec}s`);
}

const totalElapsedSec = Math.round((Date.now() - startedAt) / 1000);
console.log(`\nDone in ${totalElapsedSec}s. processed=${processed} changed=${changed} failed=${failed}`);
console.log('\nSample corrections (first 20):');
for (const s of changedSamples) {
  console.log(`  ${s.name}: ${s.before} -> ${s.after}`);
}

await mongoose.disconnect();
process.exit(0);
