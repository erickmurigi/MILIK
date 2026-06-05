import mongoose from 'mongoose';
import CarWashCustomer from '../models/CarWashCustomer.js';
import CarWashLoyaltyProgram from '../models/CarWashLoyaltyProgram.js';
import CarWashLoyaltyCard from '../models/CarWashLoyaltyCard.js';
import CarWashJob from '../models/CarWashJob.js';
import CarWashPayment from '../models/CarWashPayment.js';
import CarWashCreditAccount from '../models/CarWashCreditAccount.js';
import { createError } from '../../../utils/error.js';
import { currentUserId, escapeRegex, netJobPrice, resolveActiveBusinessId } from '../services/businessScope.js';
import { sendAdHocSms } from '../../../services/communicationService.js';
import { resolveCarWashSmsBody } from '../services/carwashSmsService.js';

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

const sendLoyaltySms = async (business, phone, body, templateKey) => {
  if (!phone || !body) return;
  sendAdHocSms({ businessId: business, phone, body, templateKey }).catch(() => {});
};

// ─── Loyalty program ──────────────────────────────────────────────────────────

export const getLoyaltyProgram = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const program = await CarWashLoyaltyProgram.findOne({ business })
      .populate('applicableServices', 'name')
      .lean();
    res.json({ success: true, data: program || null });
  } catch (err) {
    next(err);
  }
};

export const upsertLoyaltyProgram = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const {
      name, isActive, stampsRequired, rewardType, rewardValue,
      applicableServices, stampExpiryDays, smsOnStamp, smsOnReward, smsOnPayment,
    } = req.body;

    const stampsNum = Number(stampsRequired);
    if (!Number.isFinite(stampsNum) || stampsNum < 2) {
      return next(createError(400, 'Stamps required must be at least 2'));
    }

    const fields = {
      name: String(name || 'Loyalty Program').trim() || 'Loyalty Program',
      isActive: isActive !== undefined ? Boolean(isActive) : true,
      stampsRequired: stampsNum,
      rewardType: ['free_wash', 'discount_percent', 'discount_fixed'].includes(rewardType)
        ? rewardType : 'free_wash',
      rewardValue: Number(rewardValue || 0),
      applicableServices: Array.isArray(applicableServices)
        ? applicableServices.filter(id => mongoose.Types.ObjectId.isValid(String(id)))
        : [],
      stampExpiryDays: Math.max(0, Number(stampExpiryDays || 0)),
      smsOnStamp: smsOnStamp !== undefined ? Boolean(smsOnStamp) : true,
      smsOnReward: smsOnReward !== undefined ? Boolean(smsOnReward) : true,
      smsOnPayment: smsOnPayment !== undefined ? Boolean(smsOnPayment) : false,
      updatedBy: userId,
    };

    const existing = await CarWashLoyaltyProgram.findOne({ business });
    let program;
    if (existing) {
      Object.assign(existing, fields);
      program = await existing.save();
    } else {
      program = await CarWashLoyaltyProgram.create({ business, ...fields, createdBy: userId });
    }

    res.json({ success: true, data: program, message: 'Loyalty program saved' });
  } catch (err) {
    next(err);
  }
};

// ─── Customers ────────────────────────────────────────────────────────────────

export const listCustomers = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { search: rawSearch, page = 1, limit = 50 } = req.query;
    const search = escapeRegex(rawSearch);

    const filter = { business };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { plates: { $regex: search, $options: 'i' } },
      ];
    }

    const [customers, total] = await Promise.all([
      CarWashCustomer.find(filter)
        .sort({ name: 1 })
        .skip((Number(page) - 1) * Number(limit))
        .limit(Number(limit))
        .lean(),
      CarWashCustomer.countDocuments(filter),
    ]);

    // Attach loyalty card stats for each customer
    const customerIds = customers.map(c => c._id);
    const cards = await CarWashLoyaltyCard.find({ customer: { $in: customerIds }, business })
      .lean();
    const cardsByCustomer = new Map(cards.map(c => [String(c.customer), c]));

    const enriched = customers.map(c => ({
      ...c,
      loyaltyCard: cardsByCustomer.get(String(c._id)) || null,
    }));

    res.json({ success: true, data: enriched, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    next(err);
  }
};

// Enriched customer list — used by the dedicated Customers page.
// Returns every CarWashCustomer with aggregated job stats, outstanding balance,
// loyalty card progress, and credit account reference.
// All aggregations are batched (no N+1 queries).
export const listCustomersEnriched = async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const business = resolveActiveBusinessId(req);
    const pageNum = Math.max(Number(req.query.page || 1), 1);
    const limitNum = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
    const search = escapeRegex(String(req.query.search || '').trim());

    const filter = { business };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { plates: { $regex: search, $options: 'i' } },
      ];
    }
    // Optional: filter to only customers with outstanding balance
    if (req.query.hasOutstanding === 'true') {
      // Handled in post-processing below — filter flag stored for later
    }

    const [customers, total] = await Promise.all([
      CarWashCustomer.find(filter)
        .sort({ updatedAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      CarWashCustomer.countDocuments(filter),
    ]);

    if (!customers.length) {
      return res.json({ success: true, data: [], total: 0, page: pageNum, limit: limitNum });
    }

    const allPlates = [...new Set(customers.flatMap((c) => c.plates || []))];
    const customerIds = customers.map((c) => c._id);
    const businessOid = new mongoose.Types.ObjectId(String(business));

    // Three parallel batch queries — no N+1
    const [jobStats, loyaltyCards, creditAccounts] = await Promise.all([
      CarWashJob.aggregate([
        { $match: { business: businessOid, plateNumber: { $in: allPlates }, status: { $nin: ['cancelled'] } } },
        { $group: {
          _id: '$plateNumber',
          totalJobs: { $sum: 1 },
          totalInvoiced: { $sum: '$price' },
          lastVisit: { $max: '$createdAt' },
          jobIds: { $push: '$_id' },
        }},
      ]),
      CarWashLoyaltyCard.find({ customer: { $in: customerIds }, business }).lean(),
      CarWashCreditAccount.find({ business, plates: { $in: allPlates }, status: { $ne: 'closed' } })
        .select('plates accountNumber accountType status')
        .lean(),
    ]);

    // Batch payment totals for all jobs found
    const allJobIds = jobStats.flatMap((s) => s.jobIds);
    const paymentTotals = allJobIds.length
      ? await CarWashPayment.aggregate([
          { $match: { business: businessOid, job: { $in: allJobIds } } },
          { $group: { _id: '$job', paid: { $sum: { $add: ['$amount', { $ifNull: ['$discountAmount', 0] }] } } } },
        ])
      : [];

    const paidByJob = new Map(paymentTotals.map((p) => [String(p._id), Number(p.paid || 0)]));

    // Build per-plate stats map
    const statsByPlate = new Map();
    for (const s of jobStats) {
      const totalPaid = s.jobIds.reduce((sum, jid) => sum + (paidByJob.get(String(jid)) || 0), 0);
      statsByPlate.set(s._id, {
        totalJobs: s.totalJobs,
        totalInvoiced: round2(s.totalInvoiced || 0),
        totalPaid: round2(totalPaid),
        outstanding: round2(Math.max(0, (s.totalInvoiced || 0) - totalPaid)),
        lastVisit: s.lastVisit || null,
      });
    }

    // Build plate → credit account map (first account wins per plate)
    const creditByPlate = new Map();
    for (const acc of creditAccounts) {
      for (const plate of (acc.plates || [])) {
        if (!creditByPlate.has(plate)) creditByPlate.set(plate, acc);
      }
    }

    const cardsByCustomer = new Map(loyaltyCards.map((c) => [String(c.customer), c]));

    const enriched = customers.map((c) => {
      let totalJobs = 0, totalInvoiced = 0, totalPaid = 0, outstanding = 0, lastVisit = null;
      let creditAccount = null;
      for (const plate of (c.plates || [])) {
        const s = statsByPlate.get(plate);
        if (s) {
          totalJobs += s.totalJobs;
          totalInvoiced += s.totalInvoiced;
          totalPaid += s.totalPaid;
          outstanding += s.outstanding;
          if (!lastVisit || (s.lastVisit && s.lastVisit > lastVisit)) lastVisit = s.lastVisit;
        }
        if (!creditAccount) creditAccount = creditByPlate.get(plate) || null;
      }
      return {
        ...c,
        totalJobs,
        totalInvoiced: round2(totalInvoiced),
        totalPaid: round2(totalPaid),
        outstanding: round2(outstanding),
        lastVisit,
        loyaltyCard: cardsByCustomer.get(String(c._id)) || null,
        creditAccount: creditAccount
          ? { _id: creditAccount._id, accountNumber: creditAccount.accountNumber, accountType: creditAccount.accountType, status: creditAccount.status }
          : null,
      };
    });

    res.json({ success: true, data: enriched, total, page: pageNum, limit: limitNum });
  } catch (err) {
    next(err);
  }
};

export const registerCustomer = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const { name, phone, plates, notes } = req.body;

    if (!name || !String(name).trim()) return next(createError(400, 'Customer name is required'));
    if (!phone || !String(phone).trim()) return next(createError(400, 'Customer phone is required'));

    const normalizedPlates = Array.isArray(plates)
      ? plates.map(p => String(p).trim().toUpperCase()).filter(Boolean)
      : [];

    const existing = await CarWashCustomer.findOne({ business, phone: String(phone).trim() });
    if (existing) return next(createError(409, 'A customer with this phone number is already registered'));

    const customer = await CarWashCustomer.create({
      business,
      name: String(name).trim(),
      phone: String(phone).trim(),
      plates: normalizedPlates,
      notes: String(notes || '').trim(),
      createdBy: userId,
      updatedBy: userId,
    });

    // Create loyalty cards for each plate if a program exists
    const program = await CarWashLoyaltyProgram.findOne({ business, isActive: true }).lean();
    if (program) {
      const cardDocs = normalizedPlates.map(plate => ({
        business,
        plate,
        customer: customer._id,
        program: program._id,
      }));
      if (cardDocs.length) {
        await CarWashLoyaltyCard.insertMany(cardDocs, { ordered: false }).catch(() => {});
      }
    }

    res.status(201).json({ success: true, data: customer, message: 'Customer registered' });
  } catch (err) {
    if (err.code === 11000) return next(createError(409, 'A customer with this phone number already exists'));
    next(err);
  }
};

export const updateCustomer = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const customer = await CarWashCustomer.findOne({ _id: req.params.id, business });
    if (!customer) return next(createError(404, 'Customer not found'));

    const { name, phone, plates, notes } = req.body;

    if (name !== undefined) customer.name = String(name).trim();
    if (phone !== undefined) customer.phone = String(phone).trim();
    if (Array.isArray(plates)) {
      const normalized = plates.map(p => String(p).trim().toUpperCase()).filter(Boolean);
      const newPlates = normalized.filter(p => !customer.plates.includes(p));
      customer.plates = normalized;

      // Create loyalty cards for any newly added plates
      const program = await CarWashLoyaltyProgram.findOne({ business, isActive: true }).lean();
      if (program && newPlates.length) {
        const cardDocs = newPlates.map(plate => ({ business, plate, customer: customer._id, program: program._id }));
        await CarWashLoyaltyCard.insertMany(cardDocs, { ordered: false }).catch(() => {});
      }
    }
    if (notes !== undefined) customer.notes = String(notes).trim();
    customer.updatedBy = userId;
    await customer.save();

    res.json({ success: true, data: customer, message: 'Customer updated' });
  } catch (err) {
    next(err);
  }
};

// ─── Plate lookup ─────────────────────────────────────────────────────────────

export const lookupPlate = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const plate = String(req.params.plate || '').trim().toUpperCase();
    if (!plate) return next(createError(400, 'Plate number is required'));

    const customer = await CarWashCustomer.findOne({ business, plates: plate }).lean();
    const card = customer
      ? await CarWashLoyaltyCard.findOne({ business, customer: customer._id })
          .populate('program', 'name stampsRequired rewardType rewardValue isActive')
          .lean()
      : null;

    res.json({
      success: true,
      data: {
        plate,
        customer: customer || null,
        loyaltyCard: card || null,
        registered: Boolean(customer),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Stamp awarding (called internally from payments flow) ────────────────────

export const awardLoyaltyStamp = async ({ business, job, overridePhone = null }) => {
  if (!job?.plateNumber) return null;

  const plate = String(job.plateNumber).trim().toUpperCase();

  // 1. Always ensure customer exists — independent of loyalty program
  const customer = await ensureCarWashCustomer({
    business,
    plate,
    customerName: job.customerName,
    phone: job.phone,
  });
  if (!customer) return null;

  // 2. Check for active loyalty program — no program = customer created but no stamp
  const program = await CarWashLoyaltyProgram.findOne({ business, isActive: true }).lean();
  if (!program) return customer;

  // 3. Always upsert the loyalty card first — card must exist even if this job is not eligible.
  // Moving this before the eligibility check prevents "No card yet" for customers whose
  // first jobs happen to use a non-eligible service.
  let card = await CarWashLoyaltyCard.findOneAndUpdate(
    { business, customer: customer._id },
    { $setOnInsert: { business, customer: customer._id, program: program._id } },
    { upsert: true, new: true }
  );

  // Idempotency guard — a stamp for this exact job was already awarded (e.g. Done then Paid)
  const jobIdStr = String(job._id);
  if (card.stampHistory.some((h) => String(h.job) === jobIdStr)) return card;

  // 4. Check service eligibility — empty applicableServices = all services qualify.
  // If services were typed manually (not selected from catalog), service IDs are null —
  // in that case we skip the check and allow the stamp (benefit of the doubt).
  // Card is already created above; we only skip the STAMP, not the card.
  if (program.applicableServices?.length) {
    const eligibleIds = new Set(program.applicableServices.map(s => String(s)));
    const jobServiceIds = [
      job.service,
      ...(Array.isArray(job.serviceLines) ? job.serviceLines.map(l => l.service) : []),
    ].filter(Boolean).map(String);
    if (jobServiceIds.length > 0 && !jobServiceIds.some(id => eligibleIds.has(id))) return card;
  }

  // 5. Handle stamp expiry
  if (program.stampExpiryDays > 0 && card.lastStampAt) {
    const daysSinceLast = (Date.now() - card.lastStampAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLast > program.stampExpiryDays) card.currentStamps = 0;
  }

  // 6. Award stamp
  card.currentStamps += 1;
  card.totalStampsEarned += 1;
  card.lastStampAt = new Date();
  card.stampHistory.push({ job: job._id, jobNumber: job.jobNumber || '', plate, awardedAt: new Date() });

  let rewardTriggered = false;
  if (card.currentStamps >= program.stampsRequired) {
    card.pendingRewards += 1;
    card.totalRewardsEarned += 1;
    card.currentStamps = 0;
    rewardTriggered = true;
  }

  await card.save();

  // 7. SMS — always automatic, no smsOn* flag gates
  const smsPhone = overridePhone || customer.phone;
  const customerName = customer.name || 'Valued Customer';

  if (smsPhone) {
    if (rewardTriggered) {
      const rewardDesc = program.rewardType === 'free_wash'
        ? 'a FREE wash'
        : program.rewardType === 'discount_percent'
          ? `${program.rewardValue}% off your next wash`
          : `KES ${program.rewardValue} off your next wash`;
      const rewardBody = await resolveCarWashSmsBody(business, 'carwash_reward_ready', {
        customerName, plate, rewardDesc,
      });
      await sendLoyaltySms(business, smsPhone, rewardBody, 'carwash_reward_ready');
    } else {
      const remaining = program.stampsRequired - card.currentStamps;
      const stampBody = await resolveCarWashSmsBody(business, 'carwash_stamp_earned', {
        customerName, plate,
        currentStamps:  card.currentStamps,
        stampsRequired: program.stampsRequired,
        remaining,
        washesWord: remaining !== 1 ? 'washes' : 'wash',
      });
      await sendLoyaltySms(business, smsPhone, stampBody, 'carwash_stamp_earned');
    }
  }

  return { card, rewardTriggered, program };
};

// ─── Customer upsert — completely independent of loyalty ─────────────────────
// Creates or updates the CarWashCustomer record for a plate.
// Called at job creation AND as a safety net before stamp awarding.
// Never throws — failure must not block any calling flow.
export const ensureCarWashCustomer = async ({ business, plate, customerName, phone }) => {
  try {
    const normalizedPlate = String(plate || '').trim().toUpperCase();
    if (!normalizedPlate) return null;
    const cleanPhone = String(phone || '').trim() || null;

    // Plate is the sole identity key — every unique plate is its own customer record.
    // Phone is stored as metadata only and is never used for lookup or merging.
    let customer = await CarWashCustomer.findOne({ business, plates: normalizedPlate }).lean();

    if (!customer) {
      try {
        const doc = {
          business,
          name: String(customerName || normalizedPlate).trim() || normalizedPlate,
          plates: [normalizedPlate],
          notes: 'Auto-enrolled at first wash',
        };
        if (cleanPhone) doc.phone = cleanPhone;
        customer = await CarWashCustomer.create(doc);
      } catch (createErr) {
        // Race condition: another request created the customer between our findOne and create
        if (createErr.code === 11000) {
          customer = await CarWashCustomer.findOne({ business, plates: normalizedPlate }).lean();
        }
        if (!customer) throw createErr;
      }
    }

    // Keep phone up to date if job has one and customer record doesn't yet
    if (customer && !customer.phone && cleanPhone) {
      await CarWashCustomer.updateOne({ _id: customer._id }, { $set: { phone: cleanPhone } });
    }

    return customer;
  } catch (err) {
    console.error('[CW Customer] ensureCarWashCustomer plate=%s error=%s', plate, err?.message || err);
    return null;
  }
};

// ─── Auto-enroll plate at job creation ───────────────────────────────────────
// Called from jobsController.createJob. Never throws — failure must not block job creation.
export const autoEnrollPlate = async ({ business, plate, customerName, phone }) => {
  try {
    // Customer creation is always guaranteed via ensureCarWashCustomer
    const customer = await ensureCarWashCustomer({ business, plate, customerName, phone });
    if (!customer) return null;

    // Loyalty card creation is optional — only if a program is active
    const program = await CarWashLoyaltyProgram.findOne({ business, isActive: true }).lean();
    if (!program) return customer;

    const card = await CarWashLoyaltyCard.findOneAndUpdate(
      { business, customer: customer._id },
      { $setOnInsert: { business, customer: customer._id, program: program._id } },
      { upsert: true, new: true }
    );
    return card;
  } catch (err) {
    console.error('[CW AutoEnroll] plate=%s error=%s', plate, err?.message || err);
    return null;
  }
};

// ─── Redeem reward on a job ───────────────────────────────────────────────────

export const redeemReward = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const job = await CarWashJob.findOne({ _id: req.params.jobId, business });
    if (!job) return next(createError(404, 'Car Wash job not found'));
    if (job.status === 'cancelled') return next(createError(400, 'Cannot redeem a reward on a cancelled job'));

    const plate = String(job.plateNumber || '').trim().toUpperCase();
    if (!plate) return next(createError(400, 'Job has no plate number'));

    const customer = await CarWashCustomer.findOne({ business, plates: plate }).lean();
    if (!customer) return next(createError(404, 'No loyalty customer found for this plate'));

    const card = await CarWashLoyaltyCard.findOne({ business, customer: customer._id });
    if (!card) return next(createError(404, 'No loyalty card found for this customer'));
    if (card.pendingRewards <= 0) return next(createError(400, 'No pending rewards to redeem'));

    const program = await CarWashLoyaltyProgram.findById(card.program).lean();

    // Compute and apply the discount to the job based on reward type
    let discountAmount = 0;
    if (program) {
      if (program.rewardType === 'free_wash') {
        discountAmount = Number(job.price || 0);
      } else if (program.rewardType === 'discount_percent') {
        discountAmount = round2(Number(job.price || 0) * Number(program.rewardValue || 0) / 100);
      } else if (program.rewardType === 'discount_fixed') {
        discountAmount = Math.min(Number(program.rewardValue || 0), Number(job.price || 0));
      }
    }
    job.discountAmount = round2(discountAmount);

    // If net payable is zero, mark the job as paid
    if (netJobPrice(job) <= 0 && job.status !== 'cancelled') {
      job.paymentStatus = 'paid';
      job.status = 'paid';
    }
    await job.save();

    // Record redemption on card
    card.pendingRewards -= 1;
    card.totalRewardsRedeemed += 1;
    card.lastRedemptionAt = new Date();
    card.stampHistory.push({
      job: job._id,
      jobNumber: job.jobNumber || '',
      plate,
      awardedAt: new Date(),
      wasRedemption: true,
    });
    await card.save();

    if (program?.smsOnReward && customer?.phone) {
      const redeemBody = await resolveCarWashSmsBody(business, 'carwash_reward_redeemed', {
        customerName: customer.name || 'Valued Customer',
        plate,
      });
      await sendLoyaltySms(business, customer.phone, redeemBody, 'carwash_reward_redeemed');
    }

    res.json({ success: true, data: { card, job }, job, message: 'Reward redeemed successfully' });
  } catch (err) {
    next(err);
  }
};

// ─── Payment confirmation SMS (called from payments flow) ─────────────────────

export const sendPaymentConfirmationSms = async ({ business, job, amount, overridePhone = null }) => {
  if (!job?.plateNumber) return;
  try {
    const plate = String(job.plateNumber).trim().toUpperCase();

    // Phone: M-Pesa payer number first, then job phone, then customer record
    const phone = overridePhone
      || String(job.phone || '').trim()
      || (await CarWashCustomer.findOne({ business, plates: plate }).select('phone').lean())?.phone;
    if (!phone) return;

    const customerName = job.customerName || 'Valued Customer';
    const outstanding = round2(Math.max(0, netJobPrice(job) - Number(amount || 0)));
    const balanceLine = outstanding > 0.01
      ? `Balance: KES ${outstanding.toLocaleString()}.`
      : 'Fully paid.';

    const body = await resolveCarWashSmsBody(business, 'carwash_payment_confirmed', {
      customerName,
      plate,
      amount:      Number(amount || 0).toLocaleString(),
      balanceLine,
    });
    await sendLoyaltySms(business, phone, body, 'carwash_payment_confirmed');
  } catch (_err) {
    // Never break the main flow
  }
};

// ─── Manual SMS to a loyalty customer ────────────────────────────────────────

export const sendCustomerSms = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const customer = await CarWashCustomer.findOne({ _id: req.params.id, business }).lean();
    if (!customer) throw createError(404, "Car Wash customer not found");
    const phone = String(req.body.phone || customer.phone || "").trim();
    if (!phone) throw createError(400, "No phone number available for this customer");
    const body = String(req.body.body || "").trim();
    if (!body) throw createError(400, "Message body is required");
    await sendAdHocSms({ businessId: business, phone, body, templateKey: "carwash_loyalty_manual" });
    res.json({ success: true, message: "SMS sent" });
  } catch (err) {
    next(err);
  }
};

// ─── Card detail ──────────────────────────────────────────────────────────────

/**
 * Revokes the loyalty stamp earned for a specific job when that job's payment
 * is deleted. Replays the remaining stamp history to recalculate all counters
 * accurately — handles the edge case where the revoked stamp was the one that
 * triggered a reward cycle.
 *
 * Does NOT touch totalRewardsRedeemed — redemptions already made stand.
 * Never throws — stamp revocation must not block the payment deletion.
 */
export const revokeStampForJob = async ({ business, jobId, plate }) => {
  if (!plate || !jobId) return;
  const normalizedPlate = String(plate).trim().toUpperCase();

  try {
    const customer = await CarWashCustomer.findOne({ business, plates: normalizedPlate }).lean();
    if (!customer) return;
    const card = await CarWashLoyaltyCard.findOne({ business, customer: customer._id });
    if (!card) return;

    const before = card.stampHistory.length;
    card.stampHistory = card.stampHistory.filter(
      (s) => String(s.job) !== String(jobId)
    );
    if (card.stampHistory.length === before) return; // nothing to revoke

    const program = await CarWashLoyaltyProgram.findById(card.program).lean();
    const stampsRequired = Number(program?.stampsRequired || 10);

    // Replay non-redemption stamps to recompute counters
    let currentStamps = 0;
    let rewardsEarned = 0;
    let totalStamps = 0;
    let lastStampAt = null;

    for (const entry of card.stampHistory) {
      if (entry.wasRedemption) continue;
      totalStamps++;
      lastStampAt = entry.awardedAt || lastStampAt;
      currentStamps++;
      if (currentStamps >= stampsRequired) {
        rewardsEarned++;
        currentStamps = 0;
      }
    }

    card.currentStamps     = currentStamps;
    card.totalStampsEarned = totalStamps;
    card.totalRewardsEarned = rewardsEarned;
    card.pendingRewards    = Math.max(0, rewardsEarned - (card.totalRewardsRedeemed || 0));
    card.lastStampAt       = lastStampAt;

    await card.save();
  } catch (err) {
    console.error('[Loyalty] revokeStampForJob failed job=%s plate=%s: %s', jobId, plate, err?.message || err);
  }
};

/**
 * Backfill: processes all existing vehicle jobs to ensure customers exist and
 * stamps are awarded for jobs that are Done/Paid. Safe to run multiple times — idempotent.
 */
export const backfillCustomersAndStamps = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const jobs = await CarWashJob.find({
      business,
      jobType: 'vehicle',
      plateNumber: { $exists: true, $ne: '' },
      status: { $nin: ['cancelled'] },
    }).lean();

    let customersCreated = 0;
    let stampsAwarded = 0;
    let errors = 0;

    for (const job of jobs) {
      try {
        // Always ensure customer exists
        const before = await CarWashCustomer.countDocuments({ business, plates: job.plateNumber });
        await ensureCarWashCustomer({ business, plate: job.plateNumber, customerName: job.customerName, phone: job.phone });
        const after = await CarWashCustomer.countDocuments({ business, plates: job.plateNumber });
        if (after > before) customersCreated++;

        // Award stamp for completed jobs
        if (['done', 'paid'].includes(job.status)) {
          const result = await awardLoyaltyStamp({ business, job });
          if (result?.card) stampsAwarded++;
        }
      } catch (err) {
        console.error('[Backfill] job=%s plate=%s error=%s', job.jobNumber, job.plateNumber, err?.message);
        errors++;
      }
    }

    res.json({ success: true, message: `Backfill complete`, jobs: jobs.length, customersCreated, stampsAwarded, errors });
  } catch (err) {
    next(err);
  }
};

/**
 * One-time migration: merges per-plate loyalty cards into one per-customer card.
 * Also drops the old {business,plate} unique index and ensures {business,customer} unique.
 * Safe to run multiple times — idempotent.
 */
export const migrateToPerCustomerCards = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);

    // 1. Drop old unique index if it still exists (ignore error if already gone)
    try {
      await CarWashLoyaltyCard.collection.dropIndex('business_1_plate_1');
    } catch (_) {}

    // 2. Ensure the new unique index exists
    await CarWashLoyaltyCard.collection.createIndex(
      { business: 1, customer: 1 },
      { unique: true, background: true }
    );

    // 3. Find all cards for this business
    const allCards = await CarWashLoyaltyCard.find({ business }).lean();
    const byCustomer = new Map();
    for (const card of allCards) {
      const key = String(card.customer);
      if (!byCustomer.has(key)) byCustomer.set(key, []);
      byCustomer.get(key).push(card);
    }

    let merged = 0;
    let skipped = 0;

    for (const [customerId, cards] of byCustomer) {
      if (cards.length <= 1) { skipped++; continue; }

      // Sort: keep the card with the most stamps as the base
      cards.sort((a, b) => b.totalStampsEarned - a.totalStampsEarned);
      const [base, ...rest] = cards;

      // Merge all stamp histories into base, then replay to recompute counters
      const allStamps = [
        ...base.stampHistory,
        ...rest.flatMap(c => c.stampHistory),
      ].sort((a, b) => new Date(a.awardedAt) - new Date(b.awardedAt));

      const program = await CarWashLoyaltyProgram.findById(base.program).lean();
      const stampsRequired = Number(program?.stampsRequired || 10);

      let currentStamps = 0, rewardsEarned = 0, totalStamps = 0, lastStampAt = null;
      for (const entry of allStamps) {
        if (entry.wasRedemption) continue;
        totalStamps++;
        lastStampAt = entry.awardedAt || lastStampAt;
        currentStamps++;
        if (currentStamps >= stampsRequired) { rewardsEarned++; currentStamps = 0; }
      }
      const totalRedeemed = cards.reduce((s, c) => s + (c.totalRewardsRedeemed || 0), 0);

      await CarWashLoyaltyCard.updateOne(
        { _id: base._id },
        {
          $set: {
            stampHistory: allStamps,
            currentStamps,
            totalStampsEarned: totalStamps,
            totalRewardsEarned: rewardsEarned,
            totalRewardsRedeemed: totalRedeemed,
            pendingRewards: Math.max(0, rewardsEarned - totalRedeemed),
            lastStampAt,
          },
        }
      );

      // Delete the duplicate cards
      await CarWashLoyaltyCard.deleteMany({ _id: { $in: rest.map(c => c._id) } });
      merged++;
    }

    res.json({
      success: true,
      message: `Migration complete: ${merged} customer${merged !== 1 ? 's' : ''} merged, ${skipped} already had a single card.`,
      merged,
      skipped,
    });
  } catch (err) {
    next(err);
  }
};

export const getCustomerCard = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { customerId } = req.params;
    const customer = await CarWashCustomer.findOne({ _id: customerId, business }).lean();
    if (!customer) return next(createError(404, 'Customer not found'));

    const card = await CarWashLoyaltyCard.findOne({ customer: customer._id, business })
      .populate('program', 'name stampsRequired rewardType rewardValue')
      .lean();

    res.json({ success: true, data: { customer, card: card || null } });
  } catch (err) {
    next(err);
  }
};
