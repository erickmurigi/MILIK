import mongoose from 'mongoose';
import CarWashCustomer from '../models/CarWashCustomer.js';
import CarWashLoyaltyProgram from '../models/CarWashLoyaltyProgram.js';
import CarWashLoyaltyCard from '../models/CarWashLoyaltyCard.js';
import CarWashJob from '../models/CarWashJob.js';
import CarWashService from '../models/CarWashService.js';
import CarWashPayment from '../models/CarWashPayment.js';
import CarWashCreditAccount from '../models/CarWashCreditAccount.js';
import CarWashCustomerCredit from '../models/CarWashCustomerCredit.js';
import { accrueCommissionForJob, markJobCommissionsPayable } from '../services/commissionService.js';
import { createError } from '../../../utils/error.js';
import { currentUserId, escapeRegex, netJobPrice, resolveActiveBusinessId } from '../services/businessScope.js';
import { sendAdHocSms, sendAdHocSmsToMasked } from '../../../services/communicationService.js';
import { resolveCarWashSmsBody } from '../services/carwashSmsService.js';
import { postCarWashLoyaltyDiscountLedger } from '../services/carwashAccountingService.js';
import { normalizePlate, buildPlateRegex } from '../utils/plateUtils.js';
import { recomputeCustomerStats } from '../services/customerStatsService.js';

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

const sendLoyaltySms = async (business, phone, body, templateKey, recipientName = '') => {
  if (!phone || !body) return;
  sendAdHocSms({ businessId: business, phone, body, templateKey, recipientName }).catch((err) => {
    console.error('[CW Loyalty SMS] send failed phone=%s: %s', phone, err?.message || err);
  });
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
      name, isActive, stampsRequired, rewardType, rewardValue, rewardServiceId,
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
      rewardType: ['free_wash', 'discount_percent', 'discount_fixed', 'free_service'].includes(rewardType)
        ? rewardType : 'free_wash',
      rewardValue: Number(rewardValue || 0),
      rewardServiceId: rewardType === 'free_service' && mongoose.Types.ObjectId.isValid(String(rewardServiceId || ''))
        ? rewardServiceId : null,
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
    const { search: rawSearch, page = 1, limit = 50, dormantDays = 0 } = req.query;
    const search = escapeRegex(rawSearch);
    const dormant = Math.max(0, Number(dormantDays || 0));
    const pageNum  = Math.max(Number(page), 1);
    const limitNum = Math.min(Math.max(Number(limit), 1), 200);

    const filter = { business };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { plates: { $regex: search, $options: 'i' } },
      ];
    }
    if (dormant > 0) {
      const cutoff = new Date(Date.now() - dormant * 86_400_000);
      filter.$and = [{ $or: [{ 'stats.lastVisit': null }, { 'stats.lastVisit': { $lt: cutoff } }] }];
    }

    const [customers, total, rewardsReadyCount] = await Promise.all([
      CarWashCustomer.find(filter)
        .sort({ name: 1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      CarWashCustomer.countDocuments(filter),
      CarWashLoyaltyCard.countDocuments({ business, pendingRewards: { $gt: 0 } }),
    ]);

    const customerIds = customers.map(c => c._id);
    const cards = await CarWashLoyaltyCard.find({ customer: { $in: customerIds }, business }).lean();
    const cardsByCustomer = new Map(cards.map(c => [String(c.customer), c]));

    const enriched = customers.map(c => ({ ...c, loyaltyCard: cardsByCustomer.get(String(c._id)) || null }));

    res.json({
      success: true,
      data: enriched,
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.max(Math.ceil(total / limitNum), 1),
      rewardsReadyCount,
    });
  } catch (err) {
    next(err);
  }
};

export const awardManualStamp = async (req, res, next) => {
  try {
    const business  = resolveActiveBusinessId(req);
    const count     = Math.min(Math.max(Number(req.body.count || 1), 1), 10);
    const note      = String(req.body.note || '').trim();

    const [customer, program] = await Promise.all([
      CarWashCustomer.findOne({ _id: req.params.id, business }).lean(),
      CarWashLoyaltyProgram.findOne({ business, isActive: true }).lean(),
    ]);
    if (!customer) return next(createError(404, 'Customer not found'));
    if (!program)  return next(createError(400, 'No active loyalty program'));

    let card = await CarWashLoyaltyCard.findOneAndUpdate(
      { business, customer: req.params.id },
      { $setOnInsert: { business, customer: req.params.id, program: program._id } },
      { upsert: true, new: true }
    );

    const now   = new Date();
    const plate = customer.plates?.[0] || '';
    let rewardTriggered = false;

    for (let i = 0; i < count; i++) {
      card.currentStamps     += 1;
      card.totalStampsEarned += 1;
      card.lastStampAt        = now;
      card.stampHistory.push({ jobNumber: 'Manual', plate, awardedAt: now, isManual: true, note });

      if (card.currentStamps >= program.stampsRequired) {
        card.pendingRewards     += 1;
        card.totalRewardsEarned += 1;
        card.currentStamps       = 0;
        rewardTriggered          = true;
      }
    }

    await card.save();

    res.json({
      success: true,
      data: card,
      rewardTriggered,
      message: `${count} stamp${count !== 1 ? 's' : ''} awarded to ${customer.name}`,
    });
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
    const businessOid = new mongoose.Types.ObjectId(String(business));
    const pageNum = Math.max(Number(req.query.page || 1), 1);
    const limitNum = Math.min(Math.max(Number(req.query.limit || 30), 1), 200);
    const search = escapeRegex(String(req.query.search || '').trim());

    const wantsOutstanding = req.query.hasOutstanding === 'true';
    const wantsCredit     = req.query.hasCredit === 'true';
    const dormantDays     = Math.max(0, Number(req.query.dormantDays || 0));
    const loyaltyFilter   = String(req.query.loyaltyFilter || '');
    const minSpend        = Number(req.query.minSpend || 0);
    const maxSpend        = Number(req.query.maxSpend || 0);
    const sortBy          = String(req.query.sortBy || 'name');
    const sortDir         = req.query.sortDir === 'asc' ? 1 : -1;
    const exportCsv       = req.query.export === 'csv';

    // ── Phase 1: fetch loyalty program + run pre-queries that inform the DB filter ──
    const loyaltyProgram = await CarWashLoyaltyProgram.findOne({ business, isActive: true })
      .select('stampsRequired rewardType rewardValue isActive').lean();

    const intersect = (a, b) => {
      const bSet = new Set(b.map(String));
      return a.filter((id) => bSet.has(String(id)));
    };

    let mandatoryIds = null; // null = no $in restriction
    let excludeIds   = [];   // IDs to $nin (no_stamps case)

    if (wantsCredit) {
      const docs = await CarWashCustomerCredit.find(
        { business: businessOid, status: 'active' }, { customer: 1 }
      ).lean();
      mandatoryIds = docs.map((d) => d.customer);
    }

    if (loyaltyFilter) {
      const stampsRequired = loyaltyProgram?.stampsRequired || 10;
      let cards;
      switch (loyaltyFilter) {
        case 'member':
          cards = await CarWashLoyaltyCard.find({ business }, { customer: 1 }).lean();
          mandatoryIds = mandatoryIds !== null ? intersect(mandatoryIds, cards.map((c) => c.customer)) : cards.map((c) => c.customer);
          break;
        case 'has_reward':
          cards = await CarWashLoyaltyCard.find({ business, pendingRewards: { $gt: 0 } }, { customer: 1 }).lean();
          mandatoryIds = mandatoryIds !== null ? intersect(mandatoryIds, cards.map((c) => c.customer)) : cards.map((c) => c.customer);
          break;
        case 'near_reward':
          cards = await CarWashLoyaltyCard.find(
            { business, currentStamps: { $gte: Math.max(1, stampsRequired - 2) }, pendingRewards: 0 },
            { customer: 1 }
          ).lean();
          mandatoryIds = mandatoryIds !== null ? intersect(mandatoryIds, cards.map((c) => c.customer)) : cards.map((c) => c.customer);
          break;
        case 'no_stamps':
          cards = await CarWashLoyaltyCard.find({ business, totalStampsEarned: { $gt: 0 } }, { customer: 1 }).lean();
          if (mandatoryIds !== null) {
            const excSet = new Set(cards.map((c) => String(c.customer)));
            mandatoryIds = mandatoryIds.filter((id) => !excSet.has(String(id)));
          } else {
            excludeIds = cards.map((c) => c.customer);
          }
          break;
      }
    }

    // ── Phase 2: build DB filter — all conditions resolved at DB level ────────
    const filter = { business };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { plates: { $regex: search, $options: 'i' } },
      ];
    }
    if (wantsOutstanding) filter['stats.outstanding'] = { $gt: 0.01 };
    if (dormantDays > 0) {
      const cutoff = new Date(Date.now() - dormantDays * 86_400_000);
      filter.$and = [{ $or: [{ 'stats.lastVisit': null }, { 'stats.lastVisit': { $lt: cutoff } }] }];
    }
    if (minSpend > 0 || maxSpend > 0) {
      filter['stats.totalPaid'] = {};
      if (minSpend > 0) filter['stats.totalPaid'].$gte = minSpend;
      if (maxSpend > 0) filter['stats.totalPaid'].$lte = maxSpend;
    }
    if (mandatoryIds !== null) filter._id = { $in: mandatoryIds };
    else if (excludeIds.length) filter._id = { $nin: excludeIds };

    // Sort maps directly to compound-indexed stats fields
    const sortFieldMap = { name: 'name', visits: 'stats.totalJobs', lastVisit: 'stats.lastVisit', spend: 'stats.totalPaid', outstanding: 'stats.outstanding' };
    const dbSort = { [sortFieldMap[sortBy] || 'name']: sortDir };

    // ── Phase 3: count + customers + global stats (all parallel) ─────────────
    const customerQuery = CarWashCustomer.find(filter).sort(dbSort);
    if (!exportCsv) customerQuery.skip((pageNum - 1) * limitNum).limit(limitNum);

    const [customers, totalCount, globalCreditAgg, globalOutstandingAgg] = await Promise.all([
      customerQuery.lean(),
      CarWashCustomer.countDocuments(filter),
      CarWashCustomerCredit.aggregate([
        { $match: { business: businessOid, status: 'active' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Promise.all([
        CarWashJob.aggregate([
          { $match: { business: businessOid, status: { $nin: ['cancelled'] } } },
          { $group: { _id: null, total: { $sum: { $subtract: ['$price', { $ifNull: ['$discountAmount', 0] }] } } } },
        ]),
        CarWashPayment.aggregate([
          { $match: { business: businessOid } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
      ]).then(([inv, paid]) => [{ total: Math.max(0, (inv[0]?.total || 0) - (paid[0]?.total || 0)) }]),
    ]);

    const globalStats = {
      totalOutstanding:   round2(globalOutstandingAgg[0]?.total || 0),
      totalCreditBalance: round2(globalCreditAgg[0]?.total || 0),
      creditCount:        globalCreditAgg[0]?.count || 0,
    };

    if (!customers.length) {
      return res.json({ success: true, data: [], total: 0, page: pageNum, limit: limitNum, loyaltyProgram: loyaltyProgram || null, globalStats });
    }

    // ── Phase 4: enrich page data — O(page_size), never O(all_customers) ─────
    const customerIds = customers.map((c) => c._id);
    const allPlates   = [...new Set(customers.flatMap((c) => c.plates || []))];

    const [loyaltyCards, creditAccounts, customerCredits] = await Promise.all([
      CarWashLoyaltyCard.find({ customer: { $in: customerIds }, business }).lean(),
      CarWashCreditAccount.find({ business, plates: { $in: allPlates }, status: { $ne: 'closed' } })
        .select('plates accountNumber accountType status').lean(),
      CarWashCustomerCredit.find({ business, customer: { $in: customerIds }, status: 'active' })
        .select('customer amount').lean(),
    ]);

    const cardsByCustomer = new Map(loyaltyCards.map((c) => [String(c.customer), c]));
    const creditByCustomer = new Map();
    for (const cr of customerCredits) {
      const key = String(cr.customer);
      creditByCustomer.set(key, round2((creditByCustomer.get(key) || 0) + Number(cr.amount || 0)));
    }
    const creditByPlate = new Map();
    for (const acc of creditAccounts) {
      for (const plate of (acc.plates || [])) {
        if (!creditByPlate.has(plate)) creditByPlate.set(plate, acc);
      }
    }

    // Stats read directly from the denormalized field — no per-customer aggregation
    const enriched = customers.map((c) => {
      const s = c.stats || {};
      let creditAccount = null;
      for (const plate of (c.plates || [])) {
        creditAccount = creditByPlate.get(plate) || null;
        if (creditAccount) break;
      }
      return {
        ...c,
        totalJobs:     s.totalJobs     ?? 0,
        totalInvoiced: s.totalInvoiced ?? 0,
        totalPaid:     s.totalPaid     ?? 0,
        outstanding:   s.outstanding   ?? 0,
        lastVisit:     s.lastVisit     ?? null,
        creditBalance: creditByCustomer.get(String(c._id)) || 0,
        loyaltyCard:   cardsByCustomer.get(String(c._id)) || null,
        creditAccount: creditAccount
          ? { _id: creditAccount._id, accountNumber: creditAccount.accountNumber, accountType: creditAccount.accountType, status: creditAccount.status }
          : null,
      };
    });

    if (exportCsv) {
      const stampsRequired = loyaltyProgram?.stampsRequired || 10;
      const header = 'Name,Phone,Plates,Visits,Last Visit,Lifetime Spend (KES),Outstanding (KES),Loyalty Stamps,Pending Rewards';
      const csvRows = enriched.map((c) => {
        const lastVisitStr = c.lastVisit ? new Date(c.lastVisit).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
        const plates = (c.plates || []).join('; ');
        const stamps = c.loyaltyCard ? `${c.loyaltyCard.currentStamps}/${stampsRequired}` : '';
        const pending = c.loyaltyCard?.pendingRewards || 0;
        return [c.name, c.phone, plates, c.totalJobs, lastVisitStr, c.totalPaid, c.outstanding, stamps, pending]
          .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(',');
      });
      res.set('Content-Type', 'text/csv');
      res.set('Content-Disposition', `attachment; filename="customers-${Date.now()}.csv"`);
      return res.send([header, ...csvRows].join('\n'));
    }

    res.json({ success: true, data: enriched, total: totalCount, page: pageNum, limit: limitNum, loyaltyProgram: loyaltyProgram || null, globalStats });
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
    const plate = normalizePlate(req.params.plate || '');
    if (!plate) return next(createError(400, 'Plate number is required'));

    const customer = await CarWashCustomer.findOne({ business, plates: buildPlateRegex(plate) }).lean();

    const businessOid = new mongoose.Types.ObjectId(String(business));
    const [card, creditAgg] = await Promise.all([
      customer
        ? CarWashLoyaltyCard.findOne({ business, customer: customer._id })
            .populate('program', 'name stampsRequired rewardType rewardValue rewardServiceId isActive')
            .lean()
        : Promise.resolve(null),
      customer
        ? CarWashCustomerCredit.aggregate([
            { $match: { business: businessOid, customer: customer._id, status: 'active' } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
          ])
        : Promise.resolve([]),
    ]);

    let rewardService = null;
    if (card?.program?.rewardType === 'free_service' && card.program.rewardServiceId) {
      const svc = await CarWashService.findById(card.program.rewardServiceId).select('name defaultPrice').lean();
      if (svc) rewardService = { _id: svc._id, name: svc.name, defaultPrice: svc.defaultPrice || 0 };
    }

    const creditBalance = round2(Number(creditAgg[0]?.total || 0));

    res.json({
      success: true,
      data: {
        plate,
        customer: customer || null,
        loyaltyCard: card ? { ...card, rewardService } : null,
        registered: Boolean(customer),
        creditBalance: creditBalance > 0 ? creditBalance : 0,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Stamp awarding (called internally from payments flow) ────────────────────

export const awardLoyaltyStamp = async ({ business, job, overridePhone = null, maskedMsisdn = null, suppressSms = false, payerName = null }) => {
  if (!job?.plateNumber) return null;

  const plate = normalizePlate(job.plateNumber);

  // 1. Always ensure customer exists — independent of loyalty program
  const customer = await ensureCarWashCustomer({
    business,
    plate,
    customerName: job.customerName,
    phone: overridePhone || job.phone,
    maskedMsisdn: maskedMsisdn || null,
    payerName: payerName || null,
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

  // Redemption visits never earn a stamp — stamps restart on the next fresh visit
  if (job.rewardRedemption) return null;
  // Voucher jobs are paid by the issuing company — no personal stamp earned
  if (job.isVoucher) return null;

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

  // 7. SMS
  const smsPhone = overridePhone || customer.phone;
  const effectiveMasked = maskedMsisdn || customer.maskedMsisdn || null;
  const customerName = payerName || customer.name || 'Valued Customer';

  let stampSmsBody = null;
  let templateKey  = null;

  // Resolve body when suppressSms (caller will combine with payment SMS) or when sending standalone
  if (suppressSms || smsPhone || effectiveMasked) {
    if (rewardTriggered) {
      const rewardDesc = program.rewardType === 'free_wash'
        ? 'a FREE wash'
        : program.rewardType === 'discount_percent'
          ? `${program.rewardValue}% off your next wash`
          : `KES ${program.rewardValue} off your next wash`;
      stampSmsBody = await resolveCarWashSmsBody(business, 'carwash_reward_ready', { customerName, plate, rewardDesc });
      templateKey  = 'carwash_reward_ready';
    } else {
      const remaining = program.stampsRequired - card.currentStamps;
      const stampVars = {
        customerName, plate,
        currentStamps:  card.currentStamps,
        stampsRequired: program.stampsRequired,
        remaining,
        washesWord: remaining !== 1 ? 'washes' : 'wash',
      };
      if (!suppressSms) {
        // Standalone send (job marked done manually, no payment SMS providing context).
        // Use the dedicated standalone template so the operator can craft a self-contained
        // message with plate + name. Falls back to carwash_stamp_earned if disabled/unconfigured.
        stampSmsBody = await resolveCarWashSmsBody(business, 'carwash_stamp_earned_standalone', stampVars)
          || await resolveCarWashSmsBody(business, 'carwash_stamp_earned', stampVars);
        templateKey = 'carwash_stamp_earned_standalone';
      } else {
        // Combined with payment SMS — short version is fine, plate already in payment message
        stampSmsBody = await resolveCarWashSmsBody(business, 'carwash_stamp_earned', stampVars);
        templateKey  = 'carwash_stamp_earned';
      }
    }

    if (!suppressSms && stampSmsBody) {
      if (smsPhone) {
        sendLoyaltySms(business, smsPhone, stampSmsBody, templateKey, customerName);
      } else if (effectiveMasked) {
        sendAdHocSmsToMasked({ businessId: business, maskedNumber: effectiveMasked, body: stampSmsBody, templateKey, recipientName: customerName }).catch(() => {});
      }
    }
  }

  return { card, rewardTriggered, program, smsBody: stampSmsBody };
};

// ─── Customer upsert — completely independent of loyalty ─────────────────────
// Creates or updates the CarWashCustomer record for a plate.
// Called at job creation AND as a safety net before stamp awarding.
// Never throws — failure must not block any calling flow.
export const ensureCarWashCustomer = async ({ business, plate, customerName, phone, maskedMsisdn = null, payerName = null }) => {
  try {
    const normalizedPlate = normalizePlate(plate);
    if (!normalizedPlate) return null;
    const cleanPhone = String(phone || '').trim() || null;
    const cleanMasked = String(maskedMsisdn || '').trim() || null;
    const cleanPayerName = String(payerName || '').trim() || null;

    // Plate is the sole identity key — every unique plate is its own customer record.
    // Phone is stored as metadata only and is never used for lookup or merging.
    // buildPlateRegex handles existing records stored with spaces/dashes.
    let customer = await CarWashCustomer.findOne({ business, plates: buildPlateRegex(normalizedPlate) }).lean();

    if (!customer) {
      try {
        const doc = {
          business,
          name: cleanPayerName || String(customerName || normalizedPlate).trim() || normalizedPlate,
          plates: [normalizedPlate],
          notes: 'Auto-enrolled at first wash',
        };
        if (cleanPhone) doc.phone = cleanPhone;
        if (cleanMasked) doc.maskedMsisdn = cleanMasked;
        customer = await CarWashCustomer.create(doc);
      } catch (createErr) {
        // Race condition: another request created the customer between our findOne and create
        if (createErr.code === 11000) {
          customer = await CarWashCustomer.findOne({ business, plates: buildPlateRegex(normalizedPlate) }).lean();
        }
        if (!customer) throw createErr;
      }
    }

    // Keep fields up to date — only fill blanks, never overwrite data the user provided
    const updates = {};
    if (!customer.phone && cleanPhone) {
      updates.phone = cleanPhone;
      // Real phone discovered — masked MSISDN is no longer the contact method
      if (customer.maskedMsisdn) updates.maskedMsisdn = "";
    } else if (cleanMasked && !customer.phone && customer.maskedMsisdn !== cleanMasked) {
      updates.maskedMsisdn = cleanMasked;
    }
    // Replace name if: (a) none set yet, or (b) current name is just the plate number (auto-enrolled placeholder)
    const nameIsPlate = customer.name &&
      (customer.plates || []).some((p) => String(p).trim().toUpperCase() === customer.name.trim().toUpperCase());
    if (cleanPayerName && (!customer.name || nameIsPlate)) updates.name = cleanPayerName;
    if (Object.keys(updates).length) {
      await CarWashCustomer.updateOne({ _id: customer._id }, { $set: updates });
      Object.assign(customer, updates);
    }

    return customer;
  } catch (err) {
    console.error('[CW Customer] ensureCarWashCustomer plate=%s error=%s', plate, err?.message || err);
    return null;
  }
};

// ─── Auto-enroll plate at job creation ───────────────────────────────────────
// Called from jobsController.createJob. Never throws — failure must not block job creation.
export const autoEnrollPlate = async ({ business, plate, customerName, phone, maskedMsisdn = null, payerName = null }) => {
  try {
    // Customer creation is always guaranteed via ensureCarWashCustomer
    const customer = await ensureCarWashCustomer({ business, plate, customerName, phone, maskedMsisdn, payerName });
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

// ─── Payment confirmation SMS (called from payments flow) ─────────────────────

export const sendPaymentConfirmationSms = async ({ business, job, amount, remaining = null, overridePhone = null, maskedMsisdn = null, loyaltySmsBody = null, payerName = null }) => {
  if (!job?.plateNumber) return;
  try {
    const plate = String(job.plateNumber).trim().toUpperCase();

    // Phone: M-Pesa payer number first, then job phone, then customer record
    const phone = overridePhone
      || String(job.phone || '').trim()
      || (await CarWashCustomer.findOne({ business, plates: plate }).select('phone').lean())?.phone;

    const customerName = payerName || job.customerName || 'Valued Customer';
    const outstanding = remaining !== null
      ? remaining
      : round2(Math.max(0, netJobPrice(job) - Number(amount || 0)));
    const balanceLine = (job.paymentStatus === 'paid' || outstanding <= 0.01)
      ? ''
      : `Balance: KES ${outstanding.toLocaleString()}.`;

    const paymentBody = await resolveCarWashSmsBody(business, 'carwash_payment_confirmed', {
      customerName,
      plate,
      amount: Number(amount || 0).toLocaleString(),
      balanceLine,
    });

    const body = [paymentBody, loyaltySmsBody].filter(Boolean).join('\n');
    if (!body) return;

    if (phone) {
      await sendLoyaltySms(business, phone, body, 'carwash_payment_confirmed', customerName);
    } else if (maskedMsisdn) {
      // Real phone not yet known — send to hashed MSISDN via AT's masked-number endpoint
      sendAdHocSmsToMasked({ businessId: business, maskedNumber: maskedMsisdn, body, templateKey: 'carwash_payment_confirmed', recipientName: customerName }).catch(() => {});
    }
  } catch (_err) {
    console.error('[CW Loyalty] sendPaymentConfirmationSms failed: %s', _err?.message || _err);
  }
};

// ─── Unmatched M-Pesa payment acknowledgement SMS ────────────────────────────
// Called when an M-Pesa payment arrives but no open job is found for the plate.

export const sendUnmatchedPaymentSms = async ({ business, businessName, senderName, amount, phone = null, maskedMsisdn = null }) => {
  try {
    const body = await resolveCarWashSmsBody(business, 'carwash_payment_unmatched', {
      payerName:    senderName || 'Valued Customer',
      amount:       Number(amount || 0).toLocaleString(),
      businessName: businessName || 'Car Wash',
    });
    if (!body) return;
    if (phone) {
      await sendAdHocSms({ businessId: business, phone, body, templateKey: 'carwash_payment_unmatched' });
    } else if (maskedMsisdn) {
      sendAdHocSmsToMasked({ businessId: business, maskedNumber: maskedMsisdn, body, templateKey: 'carwash_payment_unmatched', recipientName: senderName || '' }).catch(() => {});
    }
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
    const masked = String(customer.maskedMsisdn || "").trim();
    const body = String(req.body.body || "").trim();
    if (!body) throw createError(400, "Message body is required");
    if (phone) {
      await sendAdHocSms({ businessId: business, phone, body, templateKey: "carwash_loyalty_manual" });
    } else if (masked) {
      await sendAdHocSmsToMasked({ businessId: business, maskedNumber: masked, body, templateKey: "carwash_loyalty_manual", recipientName: customer.name || "Customer" });
    } else {
      throw createError(400, "No phone number available for this customer");
    }
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
    const stampExpiryDays = Number(program?.stampExpiryDays || 0);

    // Replay non-redemption stamps to recompute counters
    let currentStamps = 0;
    let rewardsEarned = 0;
    let totalStamps = 0;
    let lastStampAt = null;
    let prevStampAt = null;

    for (const entry of card.stampHistory) {
      if (entry.wasRedemption) continue;
      // Reset counter if gap since last stamp exceeds expiry
      if (prevStampAt && stampExpiryDays > 0) {
        const daysSince = (new Date(entry.awardedAt) - new Date(prevStampAt)) / 86_400_000;
        if (daysSince > stampExpiryDays) currentStamps = 0;
      }
      totalStamps++;
      prevStampAt = entry.awardedAt || prevStampAt;
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

    const BATCH_SIZE = 500;
    let offset = 0;
    let totalJobs = 0;
    let customersCreated = 0;
    let stampsAwarded = 0;
    let errors = 0;

    while (true) {
      const jobs = await CarWashJob.find({
        business,
        jobType: 'vehicle',
        plateNumber: { $exists: true, $ne: '' },
        status: { $nin: ['cancelled'] },
      }).sort({ _id: 1 }).skip(offset).limit(BATCH_SIZE).lean();

      if (jobs.length === 0) break;
      totalJobs += jobs.length;
      offset += jobs.length;

      // Pre-fetch all plates already known in this batch — one query replaces 2N countDocuments
      const batchPlates = [...new Set(
        jobs.map((j) => String(j.plateNumber || '').trim().toUpperCase()).filter(Boolean)
      )];
      const existingCustomers = await CarWashCustomer.find(
        { business, plates: { $in: batchPlates } },
        { plates: 1 }
      ).lean();
      const knownPlates = new Set(existingCustomers.flatMap((c) => c.plates.map((p) => p.toUpperCase())));

      for (const job of jobs) {
        try {
          const plate = String(job.plateNumber || '').trim().toUpperCase();
          const isNew = !knownPlates.has(plate);
          await ensureCarWashCustomer({ business, plate, customerName: job.customerName, phone: job.phone });
          if (isNew) { customersCreated++; knownPlates.add(plate); }

          if (['done', 'paid'].includes(job.status)) {
            const result = await awardLoyaltyStamp({ business, job });
            if (result?.card) stampsAwarded++;
          }
        } catch (err) {
          console.error('[Backfill] job=%s plate=%s error=%s', job.jobNumber, job.plateNumber, err?.message);
          errors++;
        }
      }
    }

    res.json({ success: true, message: 'Backfill complete', jobs: totalJobs, customersCreated, stampsAwarded, errors });
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

    // Pre-load all distinct loyalty programs to avoid N queries inside the loop
    const distinctProgramIds = [...new Set(allCards.map((c) => String(c.program)).filter(Boolean))];
    const programDocs = distinctProgramIds.length > 0
      ? await CarWashLoyaltyProgram.find({ _id: { $in: distinctProgramIds } }).lean()
      : [];
    const programMap = new Map(programDocs.map((p) => [String(p._id), p]));

    let skipped = 0;
    const updateOps  = [];
    const deleteIds  = [];

    for (const [, cards] of byCustomer) {
      if (cards.length <= 1) { skipped++; continue; }

      // Keep the card with the most stamps as the base
      cards.sort((a, b) => b.totalStampsEarned - a.totalStampsEarned);
      const [base, ...rest] = cards;

      const allStamps = [
        ...base.stampHistory,
        ...rest.flatMap(c => c.stampHistory),
      ].sort((a, b) => new Date(a.awardedAt) - new Date(b.awardedAt));

      const program = programMap.get(String(base.program));
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

      updateOps.push({
        updateOne: {
          filter: { _id: base._id },
          update: { $set: {
            stampHistory: allStamps,
            currentStamps,
            totalStampsEarned: totalStamps,
            totalRewardsEarned: rewardsEarned,
            totalRewardsRedeemed: totalRedeemed,
            pendingRewards: Math.max(0, rewardsEarned - totalRedeemed),
            lastStampAt,
          }},
        },
      });
      deleteIds.push(...rest.map(c => c._id));
    }

    const merged = updateOps.length;
    if (updateOps.length) await CarWashLoyaltyCard.bulkWrite(updateOps, { ordered: false });
    if (deleteIds.length)  await CarWashLoyaltyCard.deleteMany({ _id: { $in: deleteIds } });

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

export const getCustomerStatement = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const customer = await CarWashCustomer.findOne({ _id: req.params.id, business }).lean();
    if (!customer) return next(createError(404, "Customer not found"));

    const plates = (customer.plates || []).map(normalizePlate).filter(Boolean);
    if (!plates.length) {
      return res.json({ success: true, data: { customer, jobs: [], totals: { invoiced: 0, paid: 0, outstanding: 0 } } });
    }

    const jobs = await CarWashJob.find({
      business,
      plateNumber: { $in: plates },
      status: { $ne: "cancelled" },
    })
      .sort({ createdAt: 1 })
      .select("jobNumber plateNumber serviceName serviceLines price discountAmount createdAt")
      .lean();

    const jobIds = jobs.map((j) => j._id);
    const payTotals = jobIds.length
      ? await CarWashPayment.aggregate([
          { $match: { job: { $in: jobIds } } },
          { $group: { _id: "$job", paid: { $sum: "$amount" } } },
        ])
      : [];
    const paidByJob = new Map(payTotals.map((p) => [String(p._id), round2(Number(p.paid || 0))]));

    let runningBalance = 0;
    let totalInvoiced = 0;
    let totalPaid = 0;

    const rows = jobs.map((j) => {
      const charge = round2(Number(j.price || 0) - Number(j.discountAmount || 0));
      const paid   = paidByJob.get(String(j._id)) || 0;
      runningBalance = round2(runningBalance + charge - paid);
      totalInvoiced  = round2(totalInvoiced + charge);
      totalPaid      = round2(totalPaid + paid);

      const sl = j.serviceLines || [];
      const serviceName = sl.length
        ? sl[0].serviceName + (sl.length > 1 ? ` +${sl.length - 1}` : "")
        : (j.serviceName || "—");

      return { _id: j._id, jobNumber: j.jobNumber, plateNumber: j.plateNumber, serviceName, charge, paid, balance: runningBalance, date: j.createdAt };
    });

    res.json({
      success: true,
      data: { customer, jobs: rows, totals: { invoiced: totalInvoiced, paid: totalPaid, outstanding: runningBalance } },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Backfill denormalized stats for all existing customers ──────────────────
// One-time migration endpoint — call once after deploying the stats schema change.
// Processes in batches to avoid memory pressure.

export const backfillCustomerStats = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const cursor = CarWashCustomer.find({ business }, { _id: 1, plates: 1 }).lean().cursor();
    let processed = 0;
    let failed = 0;
    for await (const customer of cursor) {
      const plates = (customer.plates || []).filter(Boolean);
      if (!plates.length) { processed++; continue; }
      try {
        await recomputeCustomerStats(business, plates[0]);
        processed++;
      } catch {
        failed++;
      }
    }
    res.json({ success: true, processed, failed, message: `Backfill complete: ${processed} processed, ${failed} failed` });
  } catch (err) {
    next(err);
  }
};

// ─── Bulk SMS to multiple customers ──────────────────────────────────────────

export const bulkSendCustomerSms = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { customerIds, body: msgBody } = req.body;

    if (!Array.isArray(customerIds) || customerIds.length === 0)
      return next(createError(400, 'No customers selected'));
    if (!String(msgBody || '').trim())
      return next(createError(400, 'Message body is required'));

    const body = String(msgBody).trim();
    const validIds = customerIds.filter((id) => mongoose.Types.ObjectId.isValid(String(id)));

    const customers = await CarWashCustomer.find({ _id: { $in: validIds }, business })
      .select('name phone maskedMsisdn')
      .lean();

    const BATCH_SIZE = 8;
    const settledResults = [];
    const sendOne = (c) => {
      const phone = String(c.phone || '').trim();
      const masked = String(c.maskedMsisdn || '').trim();
      const name = c.name || '';
      if (phone)  return sendAdHocSms({ businessId: business, phone, body, templateKey: 'carwash_bulk_sms', recipientName: name });
      if (masked) return sendAdHocSmsToMasked({ businessId: business, maskedNumber: masked, body, templateKey: 'carwash_bulk_sms', recipientName: name });
      return Promise.reject(new Error('no_phone'));
    };
    for (let i = 0; i < customers.length; i += BATCH_SIZE) {
      const batch = await Promise.allSettled(customers.slice(i, i + BATCH_SIZE).map(sendOne));
      settledResults.push(...batch);
    }
    const sent    = settledResults.filter((r) => r.status === 'fulfilled').length;
    const skipped = settledResults.filter((r) => r.reason?.message === 'no_phone').length;
    const failed  = settledResults.filter((r) => r.status === 'rejected' && r.reason?.message !== 'no_phone').length;

    res.json({
      success: true,
      message: `SMS sent to ${sent} customer${sent !== 1 ? 's' : ''}${skipped > 0 ? `, ${skipped} skipped (no phone)` : ''}${failed > 0 ? `, ${failed} failed` : ''}`,
      sent, skipped, failed,
    });
  } catch (err) {
    next(err);
  }
};

// ─── Find duplicate customers (same plate in multiple records) ────────────────

export const findDuplicateCustomers = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const businessOid = new mongoose.Types.ObjectId(String(business));

    const dupPlates = await CarWashCustomer.aggregate([
      { $match: { business: businessOid } },
      { $unwind: '$plates' },
      { $group: { _id: '$plates', customerIds: { $addToSet: '$_id' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]);

    if (!dupPlates.length) return res.json({ success: true, data: [], total: 0 });

    const allIds = [...new Set(dupPlates.flatMap((d) => d.customerIds.map(String)))];
    const customers = await CarWashCustomer.find({ _id: { $in: allIds }, business }).lean();
    const customerMap = new Map(customers.map((c) => [String(c._id), c]));

    const groups = dupPlates.map((d) => ({
      plate: d._id,
      customers: d.customerIds.map((id) => customerMap.get(String(id))).filter(Boolean),
    }));

    res.json({ success: true, data: groups, total: groups.length });
  } catch (err) {
    next(err);
  }
};

// ─── Merge customers ──────────────────────────────────────────────────────────

export const mergeCustomers = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { keepId, mergeIds } = req.body;

    if (!keepId || !Array.isArray(mergeIds) || mergeIds.length === 0)
      return next(createError(400, 'keepId and mergeIds are required'));

    const keepCustomer = await CarWashCustomer.findOne({ _id: keepId, business });
    if (!keepCustomer) return next(createError(404, 'Primary customer not found'));

    const toMerge = await CarWashCustomer.find({ _id: { $in: mergeIds }, business }).lean();
    if (!toMerge.length) return next(createError(404, 'No customers to merge found'));

    // Combine plates — add plates from merged records that the keeper doesn't have
    const newPlates = toMerge.flatMap((c) => c.plates || [])
      .filter((p) => !keepCustomer.plates.includes(p));
    if (newPlates.length) keepCustomer.plates = [...keepCustomer.plates, ...newPlates];

    // Fill in missing phone
    if (!keepCustomer.phone) {
      const donor = toMerge.find((c) => c.phone);
      if (donor) keepCustomer.phone = donor.phone;
    }
    await keepCustomer.save();

    const mergeOids = toMerge.map((c) => c._id);

    // Combine stamp histories into keeper's loyalty card
    const keepCard = await CarWashLoyaltyCard.findOne({ customer: keepCustomer._id, business });
    if (keepCard) {
      const mergedCards = await CarWashLoyaltyCard.find({ customer: { $in: mergeOids }, business }).lean();
      if (mergedCards.length) {
        const allHistory = [
          ...keepCard.stampHistory,
          ...mergedCards.flatMap((c) => c.stampHistory || []),
        ].sort((a, b) => new Date(a.awardedAt) - new Date(b.awardedAt));

        const program = keepCard.program
          ? await CarWashLoyaltyProgram.findById(keepCard.program).lean()
          : null;
        const stampsRequired = Number(program?.stampsRequired || 10);
        const stampExpiryDays = Number(program?.stampExpiryDays || 0);

        let currentStamps = 0, rewardsEarned = 0, totalStamps = 0, lastStampAt = null, prevStampAt = null;
        for (const entry of allHistory) {
          if (entry.wasRedemption) continue;
          if (prevStampAt && stampExpiryDays > 0) {
            const daysSince = (new Date(entry.awardedAt) - new Date(prevStampAt)) / 86_400_000;
            if (daysSince > stampExpiryDays) currentStamps = 0;
          }
          totalStamps++;
          prevStampAt = entry.awardedAt || prevStampAt;
          lastStampAt = entry.awardedAt || lastStampAt;
          currentStamps++;
          if (currentStamps >= stampsRequired) { rewardsEarned++; currentStamps = 0; }
        }
        const totalRedeemed = mergedCards.reduce((s, c) => s + (c.totalRewardsRedeemed || 0), 0) + (keepCard.totalRewardsRedeemed || 0);

        keepCard.stampHistory = allHistory;
        keepCard.currentStamps = currentStamps;
        keepCard.totalStampsEarned = totalStamps;
        keepCard.totalRewardsEarned = rewardsEarned;
        keepCard.totalRewardsRedeemed = totalRedeemed;
        keepCard.pendingRewards = Math.max(0, rewardsEarned - totalRedeemed);
        keepCard.lastStampAt = lastStampAt;
        await keepCard.save();
      }
    }

    // Delete merged records' loyalty cards and customer records
    await CarWashLoyaltyCard.deleteMany({ customer: { $in: mergeOids }, business });
    await CarWashCustomer.deleteMany({ _id: { $in: mergeOids }, business });

    res.json({
      success: true,
      message: `Merged ${toMerge.length} customer${toMerge.length !== 1 ? 's' : ''} into ${keepCustomer.name}`,
      data: keepCustomer,
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
