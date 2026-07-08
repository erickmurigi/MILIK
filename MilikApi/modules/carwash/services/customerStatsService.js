import mongoose from 'mongoose';
import CarWashCustomer from '../models/CarWashCustomer.js';
import CarWashJob from '../models/CarWashJob.js';
import CarWashPayment from '../models/CarWashPayment.js';

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

/**
 * Recomputes and persists denormalized stats for the customer that owns `plate`.
 * Aggregates across ALL plates on the customer record so multi-plate customers
 * get accurate totals.
 *
 * Fire-and-forget safe — never throws; failures are logged and ignored.
 * Call after any job or payment mutation that could change a customer's totals.
 */
export const recomputeCustomerStats = async (business, plate) => {
  if (!plate || !business) return;
  try {
    const businessOid = new mongoose.Types.ObjectId(String(business));
    const normalizedPlate = String(plate).trim().toUpperCase();

    // Resolve the customer and all their plates in one query
    const customer = await CarWashCustomer.findOne(
      { business: businessOid, plates: normalizedPlate },
      { _id: 1, plates: 1 }
    ).lean();
    if (!customer) return;

    const plates = (customer.plates || [])
      .map((p) => String(p).trim().toUpperCase())
      .filter(Boolean);

    if (!plates.length) {
      await CarWashCustomer.updateOne(
        { _id: customer._id },
        { $set: { 'stats.totalJobs': 0, 'stats.totalInvoiced': 0, 'stats.totalPaid': 0, 'stats.outstanding': 0, 'stats.lastVisit': null } }
      );
      return;
    }

    // Single aggregation over all plates for this customer
    const jobAgg = await CarWashJob.aggregate([
      { $match: { business: businessOid, plateNumber: { $in: plates }, status: { $nin: ['cancelled'] } } },
      { $group: {
        _id:          null,
        totalJobs:    { $sum: 1 },
        totalInvoiced:{ $sum: { $subtract: ['$price', { $ifNull: ['$discountAmount', 0] }] } },
        lastVisit:    { $max: '$createdAt' },
        jobIds:       { $push: '$_id' },
      }},
    ]);

    const totalJobs     = jobAgg[0]?.totalJobs     || 0;
    const totalInvoiced = round2(jobAgg[0]?.totalInvoiced || 0);
    const lastVisit     = jobAgg[0]?.lastVisit     || null;
    const jobIds        = jobAgg[0]?.jobIds        || [];

    let totalPaid = 0;
    if (jobIds.length) {
      const payAgg = await CarWashPayment.aggregate([
        { $match: { business: businessOid, job: { $in: jobIds } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]);
      totalPaid = round2(payAgg[0]?.total || 0);
    }

    const outstanding = round2(Math.max(0, totalInvoiced - totalPaid));

    await CarWashCustomer.updateOne(
      { _id: customer._id },
      {
        $set: {
          'stats.totalJobs':      totalJobs,
          'stats.totalInvoiced':  totalInvoiced,
          'stats.totalPaid':      totalPaid,
          'stats.outstanding':    outstanding,
          'stats.lastVisit':      lastVisit,
        },
      }
    );
  } catch (err) {
    console.error('[CW CustomerStats] recompute failed plate=%s: %s', plate, err?.message || err);
  }
};
