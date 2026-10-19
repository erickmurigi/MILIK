import 'dotenv/config';
import mongoose from 'mongoose';
import Tenant from './models/Tenant.js';

await mongoose.connect(process.env.MONGO_URL, { serverSelectionTimeoutMS: 20000 });
const total = await Tenant.countDocuments({});
const active = await Tenant.countDocuments({ status: 'active' });
console.log('total tenants:', total, 'active:', active);
await mongoose.disconnect();
process.exit(0);
