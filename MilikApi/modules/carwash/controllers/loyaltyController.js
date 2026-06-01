import mongoose from 'mongoose';
import CarWashCustomer from '../models/CarWashCustomer.js';
import CarWashLoyaltyProgram from '../models/CarWashLoyaltyProgram.js';
import CarWashLoyaltyCard from '../models/CarWashLoyaltyCard.js';
import CarWashJob from '../models/CarWashJob.js';
import { createError } from '../../../utils/error.js';
import { currentUserId, escapeRegex, resolveActiveBusinessId } from '../services/businessScope.js';
import { sendAdHocSms } from '../../../services/communicationService.js';

const sendLoyaltySms = (business, phone, body, templateKey) =>
  sendAdHocSms({ businessId: business, phone, body, templateKey }).catch(() => {});

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
  const program = await CarWashLoyaltyProgram.findOne({ business, isActive: true }).lean();
  if (!program) return null;

  // Check service eligibility — for multi-service jobs, any qualifying line is enough
  if (program.applicableServices?.length) {
    const eligibleIds = new Set(program.applicableServices.map(s => String(s)));
    const jobServiceIds = [
      job.service,
      ...(Array.isArray(job.serviceLines) ? job.serviceLines.map(l => l.service) : []),
    ].filter(Boolean).map(String);
    if (!jobServiceIds.some(id => eligibleIds.has(id))) return null;
  }

  // Resolve customer by plate — one card per customer, not per plate
  let customer = await CarWashCustomer.findOne({ business, plates: plate }).lean();
  if (!customer) {
    // Inline enroll — mirrors autoEnrollPlate's logic
    try {
      const cleanPhone = String(job.phone || '').trim() || null;
      customer = await CarWashCustomer.create({
        business,
        name: String(job.customerName || plate).trim() || plate,
        phone: cleanPhone,
        plates: [plate],
        notes: 'Auto-enrolled at payment',
      });
    } catch (err) {
      if (err.code === 11000) {
        customer = await CarWashCustomer.findOne({
          business,
          $or: [{ plates: plate }, ...(job.phone ? [{ phone: String(job.phone).trim() }] : [])],
        }).lean();
        if (customer) {
          await CarWashCustomer.updateOne({ _id: customer._id }, { $addToSet: { plates: plate } });
        }
      }
      if (!customer) return null;
    }
  }

  let card = await CarWashLoyaltyCard.findOneAndUpdate(
    { business, customer: customer._id },
    { $setOnInsert: { business, customer: customer._id, program: program._id } },
    { upsert: true, new: true }
  );

  // Handle stamp expiry
  if (program.stampExpiryDays > 0 && card.lastStampAt) {
    const daysSinceLast = (Date.now() - card.lastStampAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLast > program.stampExpiryDays) {
      card.currentStamps = 0;
    }
  }

  // Award stamp
  card.currentStamps += 1;
  card.totalStampsEarned += 1;
  card.lastStampAt = new Date();
  card.stampHistory.push({
    job: job._id,
    jobNumber: job.jobNumber || '',
    plate,
    awardedAt: new Date(),
  });

  let rewardTriggered = false;
  if (card.currentStamps >= program.stampsRequired) {
    card.pendingRewards += 1;
    card.totalRewardsEarned += 1;
    card.currentStamps = 0;
    rewardTriggered = true;
  }

  await card.save();

  // Fetch latest customer record for name + fallback phone (customer was resolved earlier)
  const smsCustomer = await CarWashCustomer.findById(card.customer).lean();
  const customerName = smsCustomer?.name || customer?.name || 'Valued Customer';
  // M-Pesa override phone takes priority — it's the number that actually paid.
  // Fall back to the loyalty-registered phone for manual payments.
  const smsPhone = overridePhone || smsCustomer?.phone || customer?.phone;

  if (rewardTriggered && program.smsOnReward && smsPhone) {
    const rewardDesc = program.rewardType === 'free_wash'
      ? 'a FREE wash'
      : program.rewardType === 'discount_percent'
        ? `${program.rewardValue}% off your next wash`
        : `KES ${program.rewardValue} off your next wash`;
    const body = `Hi ${customerName}! 🎉 Congratulations! You've earned ${rewardDesc} for vehicle ${plate}. Redeem it on your next visit. Thank you for your loyalty!`;
    await sendLoyaltySms(business, smsPhone, body, 'carwash_reward_ready');
  } else if (!rewardTriggered && program.smsOnStamp && smsPhone) {
    const remaining = program.stampsRequired - card.currentStamps;
    const body = `Hi ${customerName}! You've earned stamp ${card.currentStamps}/${program.stampsRequired} for ${plate}. ${remaining} more wash${remaining !== 1 ? 'es' : ''} to go for your reward! 🚗`;
    await sendLoyaltySms(business, smsPhone, body, 'carwash_stamp_earned');
  }

  return { card, rewardTriggered, program };
};

// ─── Auto-enroll plate at job creation ───────────────────────────────────────
// Called from jobsController.createJob. Never throws — failure must not block job creation.
export const autoEnrollPlate = async ({ business, plate, customerName, phone }) => {
  try {
    const normalizedPlate = String(plate || '').trim().toUpperCase();
    if (!normalizedPlate) return null;

    const program = await CarWashLoyaltyProgram.findOne({ business, isActive: true }).lean();
    if (!program) return null;

    // Card existence checked after we know the customer

    const cleanPhone = String(phone || '').trim() || null;

    // 1. Try to find customer by plate
    let customer = await CarWashCustomer.findOne({ business, plates: normalizedPlate }).lean();

    // 2. Try to find customer by phone and add plate to their record
    if (!customer && cleanPhone) {
      const byPhone = await CarWashCustomer.findOne({ business, phone: cleanPhone }).lean();
      if (byPhone) {
        await CarWashCustomer.updateOne({ _id: byPhone._id }, { $addToSet: { plates: normalizedPlate } });
        customer = byPhone;
      }
    }

    // 3. Auto-create a minimal customer record for first-time plates
    if (!customer) {
      try {
        customer = await CarWashCustomer.create({
          business,
          name: String(customerName || normalizedPlate).trim() || normalizedPlate,
          phone: cleanPhone,
          plates: [normalizedPlate],
          notes: 'Auto-enrolled at first wash',
        });
      } catch (createErr) {
        if (createErr.code === 11000) {
          // Phone duplicate — find by phone and add this plate
          if (cleanPhone) {
            const existing = await CarWashCustomer.findOneAndUpdate(
              { business, phone: cleanPhone },
              { $addToSet: { plates: normalizedPlate } },
              { new: true }
            ).lean();
            customer = existing;
          }
          // For any other 11000 (e.g. non-sparse phone index with null), try finding by plate
          if (!customer) {
            customer = await CarWashCustomer.findOne({ business, plates: normalizedPlate }).lean();
          }
        }
        if (!customer) throw createErr;
      }
    }

    // 4. If the customer has no phone yet and we now have one from M-Pesa, update it.
    if (customer && !customer.phone && cleanPhone) {
      await CarWashCustomer.updateOne({ _id: customer._id }, { phone: cleanPhone });
    }

    // Card already exists for this customer — nothing more to do
    const existingCard = await CarWashLoyaltyCard.findOne({ business, customer: customer._id }).lean();
    if (existingCard) return existingCard;

    // Upsert by customer (one card per customer per business)
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
    const job = await CarWashJob.findOne({ _id: req.params.jobId, business }).lean();
    if (!job) return next(createError(404, 'Car Wash job not found'));

    const plate = String(job.plateNumber || '').trim().toUpperCase();
    if (!plate) return next(createError(400, 'Job has no plate number'));

    const customer = await CarWashCustomer.findOne({ business, plates: plate }).lean();
    if (!customer) return next(createError(404, 'No loyalty customer found for this plate'));

    const card = await CarWashLoyaltyCard.findOne({ business, customer: customer._id });
    if (!card) return next(createError(404, 'No loyalty card found for this customer'));
    if (card.pendingRewards <= 0) return next(createError(400, 'No pending rewards to redeem'));

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

    const program = await CarWashLoyaltyProgram.findById(card.program).lean();
    if (program?.smsOnReward && customer?.phone) {
      const body = `Hi ${customer.name || 'Valued Customer'}! Your loyalty reward has been redeemed for ${plate}. Thank you for your continued support! 🚗✨`;
      await sendLoyaltySms(business, customer.phone, body, 'carwash_reward_redeemed');
    }

    res.json({ success: true, data: card, message: 'Reward redeemed successfully' });
  } catch (err) {
    next(err);
  }
};

// ─── Payment confirmation SMS (called from payments flow) ─────────────────────

export const sendPaymentConfirmationSms = async ({ business, job, amount, overridePhone = null }) => {
  if (!job?.plateNumber) return;
  try {
    const plate = String(job.plateNumber).trim().toUpperCase();
    const program = await CarWashLoyaltyProgram.findOne({ business, isActive: true }).lean();
    if (!program?.smsOnPayment) return;

    // Prefer M-Pesa payer's number — it's the number that actually transacted.
    // Fall back to the loyalty customer's registered phone for manual payments.
    const phone = overridePhone || (await CarWashCustomer.findOne({ business, plates: plate }).lean())?.phone;
    if (!phone) return;

    const customerName = job.customerName || 'Valued Customer';
    const body = `Hi ${customerName}! Payment of KES ${Number(amount || 0).toLocaleString()} received for ${plate} wash. Thank you!`;
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
