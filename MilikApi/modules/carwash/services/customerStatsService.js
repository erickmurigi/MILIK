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

/**
 * Batched version of recomputeCustomerStats for many plates at once (e.g. bulk
 * job deletion) — one customer lookup, one job aggregation, one payment
 * aggregation, one bulkWrite, instead of ~4 round trips per plate.
 *
 * Fire-and-forget safe — never throws; failures are logged and ignored.
 */
export const recomputeCustomerStatsForPlates = async (business, plates) => {
  const normalizedPlates = [...new Set((plates || []).map((p) => String(p).trim().toUpperCase()).filter(Boolean))];
  if (!normalizedPlates.length || !business) return;
  try {
    const businessOid = new mongoose.Types.ObjectId(String(business));

    const customers = await CarWashCustomer.find(
      { business: businessOid, plates: { $in: normalizedPlates } },
      { _id: 1, plates: 1 }
    ).lean();
    if (!customers.length) return;

    const allPlates = [...new Set(
      customers.flatMap((c) => (c.plates || []).map((p) => String(p).trim().toUpperCase()).filter(Boolean))
    )];

    const jobAgg = allPlates.length
      ? await CarWashJob.aggregate([
          { $match: { business: businessOid, plateNumber: { $in: allPlates }, status: { $nin: ['cancelled'] } } },
          { $group: {
            _id:          '$plateNumber',
            totalJobs:    { $sum: 1 },
            totalInvoiced:{ $sum: { $subtract: ['$price', { $ifNull: ['$discountAmount', 0] }] } },
            lastVisit:    { $max: '$createdAt' },
            jobIds:       { $push: '$_id' },
          }},
        ])
      : [];
    const plateStatsMap = new Map(jobAgg.map((r) => [r._id, r]));

    const allJobIds = jobAgg.flatMap((r) => r.jobIds);
    const payAgg = allJobIds.length
      ? await CarWashPayment.aggregate([
          { $match: { business: businessOid, job: { $in: allJobIds } } },
          { $group: { _id: '$job', total: { $sum: '$amount' } } },
        ])
      : [];
    const paidByJob = new Map(payAgg.map((r) => [String(r._id), r.total]));

    const ops = customers.map((customer) => {
      const custPlates = (customer.plates || []).map((p) => String(p).trim().toUpperCase()).filter(Boolean);
      let totalJobs = 0, totalInvoiced = 0, totalPaid = 0, lastVisit = null;
      for (const p of custPlates) {
        const row = plateStatsMap.get(p);
        if (!row) continue;
        totalJobs += row.totalJobs;
        totalInvoiced += row.totalInvoiced || 0;
        if (row.lastVisit && (!lastVisit || row.lastVisit > lastVisit)) lastVisit = row.lastVisit;
        for (const jobId of row.jobIds) totalPaid += paidByJob.get(String(jobId)) || 0;
      }
      totalInvoiced = round2(totalInvoiced);
      totalPaid = round2(totalPaid);
      const outstanding = round2(Math.max(0, totalInvoiced - totalPaid));
      return {
        updateOne: {
          filter: { _id: customer._id },
          update: { $set: {
            'stats.totalJobs':     totalJobs,
            'stats.totalInvoiced': totalInvoiced,
            'stats.totalPaid':     totalPaid,
            'stats.outstanding':   outstanding,
            'stats.lastVisit':     lastVisit,
          } },
        },
      };
    });

    if (ops.length) await CarWashCustomer.bulkWrite(ops, { ordered: false });
  } catch (err) {
    console.error('[CW CustomerStats] batch recompute failed: %s', err?.message || err);
  }
};
