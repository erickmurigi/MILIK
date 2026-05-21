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
    const card = await CarWashLoyaltyCard.findOne({ business, plate })
      .populate('program', 'name stampsRequired rewardType rewardValue isActive')
      .lean();

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

export const awardLoyaltyStamp = async ({ business, job }) => {
  if (!job?.plateNumber) return null;

  const plate = String(job.plateNumber).trim().toUpperCase();
  const program = await CarWashLoyaltyProgram.findOne({ business, isActive: true }).lean();
  if (!program) return null;

  // Check service eligibility
  if (program.applicableServices?.length && job.service) {
    const serviceId = String(job.service);
    const qualifies = program.applicableServices.some(s => String(s) === serviceId);
    if (!qualifies) return null;
  }

  // Find the loyalty card for this plate
  let card = await CarWashLoyaltyCard.findOne({ business, plate });

  // If no card yet, try to create one if we can link to a customer
  if (!card) {
    const customer = await CarWashCustomer.findOne({ business, plates: plate }).lean();
    if (!customer) return null; // unregistered plate, no loyalty tracking
    card = await CarWashLoyaltyCard.create({
      business,
      plate,
      customer: customer._id,
      program: program._id,
    });
  }

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
    awardedAt: new Date(),
  });

  let rewardTriggered = false;
  if (card.currentStamps >= program.stampsRequired) {
    card.pendingRewards += 1;
    card.totalRewardsEarned += 1;
    card.currentStamps = 0; // reset toward next reward
    rewardTriggered = true;
  }

  await card.save();

  // Fetch customer for SMS
  const customer = await CarWashCustomer.findById(card.customer).lean();
  const customerName = customer?.name || 'Valued Customer';
  const phone = customer?.phone;

  if (rewardTriggered && program.smsOnReward && phone) {
    const rewardDesc = program.rewardType === 'free_wash'
      ? 'a FREE wash'
      : program.rewardType === 'discount_percent'
        ? `${program.rewardValue}% off your next wash`
        : `KES ${program.rewardValue} off your next wash`;
    const body = `Hi ${customerName}! 🎉 Congratulations! You've earned ${rewardDesc} for vehicle ${plate}. Redeem it on your next visit. Thank you for your loyalty!`;
    await sendLoyaltySms(business, phone, body, 'carwash_reward_ready');
  } else if (!rewardTriggered && program.smsOnStamp && phone) {
    const remaining = program.stampsRequired - card.currentStamps;
    const body = `Hi ${customerName}! You've earned stamp ${card.currentStamps}/${program.stampsRequired} for ${plate}. ${remaining} more wash${remaining !== 1 ? 'es' : ''} to go for your reward! 🚗`;
    await sendLoyaltySms(business, phone, body, 'carwash_stamp_earned');
  }

  return { card, rewardTriggered, program };
};

// ─── Redeem reward on a job ───────────────────────────────────────────────────

export const redeemReward = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const job = await CarWashJob.findOne({ _id: req.params.jobId, business }).lean();
    if (!job) return next(createError(404, 'Car Wash job not found'));

    const plate = String(job.plateNumber || '').trim().toUpperCase();
    if (!plate) return next(createError(400, 'Job has no plate number'));

    const card = await CarWashLoyaltyCard.findOne({ business, plate });
    if (!card) return next(createError(404, 'No loyalty card found for this plate'));
    if (card.pendingRewards <= 0) return next(createError(400, 'No pending rewards to redeem'));

    card.pendingRewards -= 1;
    card.totalRewardsRedeemed += 1;
    card.lastRedemptionAt = new Date();
    card.stampHistory.push({
      job: job._id,
      jobNumber: job.jobNumber || '',
      awardedAt: new Date(),
      wasRedemption: true,
    });
    await card.save();

    const customer = await CarWashCustomer.findById(card.customer).lean();
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

export const sendPaymentConfirmationSms = async ({ business, job, amount }) => {
  if (!job?.plateNumber) return;
  try {
    const plate = String(job.plateNumber).trim().toUpperCase();
    const customer = await CarWashCustomer.findOne({ business, plates: plate }).lean();
    if (!customer?.phone) return;

    const program = await CarWashLoyaltyProgram.findOne({ business, isActive: true }).lean();
    if (!program?.smsOnPayment) return;

    const body = `Hi ${customer.name || 'Valued Customer'}! Payment of KES ${Number(amount || 0).toLocaleString()} received for ${plate} wash. Thank you!`;
    await sendLoyaltySms(business, customer.phone, body, 'carwash_payment_confirmed');
  } catch (_err) {
    // Never break the main flow
  }
};

// ─── Card detail ──────────────────────────────────────────────────────────────

export const getCustomerCard = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { customerId } = req.params;
    const customer = await CarWashCustomer.findOne({ _id: customerId, business }).lean();
    if (!customer) return next(createError(404, 'Customer not found'));

    const cards = await CarWashLoyaltyCard.find({ customer: customer._id, business })
      .populate('program', 'name stampsRequired rewardType rewardValue')
      .lean();

    res.json({ success: true, data: { customer, cards } });
  } catch (err) {
    next(err);
  }
};
