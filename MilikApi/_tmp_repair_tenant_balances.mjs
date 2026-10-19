import 'dotenv/config';
import mongoose from 'mongoose';
import Tenant from './models/Tenant.js';
import { recomputeTenantFinancialState } from './controllers/propertyController/tenantInvoices.js';

const CHUNK_SIZE = 15;

await mongoose.connect(process.env.MONGO_URL, { serverSelectionTimeoutMS: 20000 });

// Pull every tenant's id/business/current balance into memory up front — a single
// query, not a long-lived cursor straddling slow per-document work (that's what
// caused the CarWash repair script's cursor-timeout crash earlier this session).
const tenants = await Tenant.find({}).select('_id business balance name').lean();
console.log(`Loaded ${tenants.length} tenants. Starting recompute...`);

const startedAt = Date.now();
let processed = 0;
let changed = 0;
let errors = 0;
const bigChanges = [];

for (let i = 0; i < tenants.length; i += CHUNK_SIZE) {
  const chunk = tenants.slice(i, i + CHUNK_SIZE);
  await Promise.all(chunk.map(async (t) => {
    try {
      const before = Number(t.balance || 0);
      await recomputeTenantFinancialState({ businessId: t.business, tenantId: t._id });
      const after = await Tenant.findById(t._id).select('balance').lean();
      const afterBalance = Number(after?.balance || 0);
      const delta = Math.round((afterBalance - before) * 100) / 100;
      if (Math.abs(delta) > 0.01) {
        changed++;
        if (Math.abs(delta) > 1000) {
          bigChanges.push({ tenant: t.name, id: String(t._id), before, after: afterBalance, delta });
        }
      }
    } catch (err) {
      errors++;
      console.error(`Failed tenant=${t._id} (${t.name}):`, err?.message);
    }
    processed++;
  }));

  const elapsedSec = (Date.now() - startedAt) / 1000;
  const rate = processed / elapsedSec;
  const etaSec = rate > 0 ? Math.round((tenants.length - processed) / rate) : 0;
  console.log(`Processed ${processed}/${tenants.length} | changed=${changed} errors=${errors} | elapsed=${elapsedSec.toFixed(0)}s eta=${etaSec}s`);
}

console.log('\n=== DONE ===');
console.log(`Total tenants: ${tenants.length}`);
console.log(`Balances corrected: ${changed}`);
console.log(`Errors: ${errors}`);
if (bigChanges.length) {
  console.log('\nLargest corrections (>1000 KES):');
  for (const c of bigChanges) {
    console.log(`  ${c.tenant} (${c.id}): ${c.before} -> ${c.after} (delta ${c.delta})`);
  }
}

await mongoose.disconnect();
process.exit(0);
