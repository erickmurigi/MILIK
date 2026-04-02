// controllers/leaseController.js
import Lease from "../../models/Lease.js";
import Tenant from "../../models/Tenant.js";
import { emitToCompany } from "../../utils/socketManager.js";

const getScopedBusiness = (req) =>
  req.user.isSystemAdmin && req.query.business ? req.query.business : req.user.company;

const sanitizeBillingScheduleAdjustments = (rows = []) => {
  if (!Array.isArray(rows)) return [];

  return rows
    .filter((row) => row && row.periodKey)
    .map((row) => ({
      periodKey: String(row.periodKey),
      fromDate: row.fromDate ? new Date(row.fromDate) : undefined,
      toDate: row.toDate ? new Date(row.toDate) : undefined,
      rentAmount: Number(row.rentAmount || 0),
      utilityAmount: Number(row.utilityAmount || 0),
      utilityNames: Array.isArray(row.utilityNames)
        ? row.utilityNames.filter(Boolean).map((item) => String(item))
        : [],
      status: ["active", "frozen", "deleted"].includes(String(row.status || "active"))
        ? String(row.status || "active")
        : "active",
      note: row.note ? String(row.note) : "",
      updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
    }));
};

// Create lease
export const createLease = async(req, res, next) => {
    const payload = {
      ...req.body,
      business: req.user.company,
    };

    if (payload.billingScheduleAdjustments) {
      payload.billingScheduleAdjustments = sanitizeBillingScheduleAdjustments(
        payload.billingScheduleAdjustments
      );
    }

    const newLease = new Lease(payload);

    try {
        const savedLease = await newLease.save();
        emitToCompany(req.user.company, 'lease:new', savedLease);
        res.status(200).json(savedLease);
    } catch (err) {
        next(err);
    }
}

// Get all leases
export const getLeases = async(req, res, next) => {
    const { status, tenant, unit } = req.query;
    try {
        const business = getScopedBusiness(req);
        const filter = { business };
        if (status) filter.status = status;
        if (tenant) filter.tenant = tenant;
        if (unit) filter.unit = unit;

        const leases = await Lease.find(filter)
            .populate('tenant', 'name email phone')
            .populate('unit', 'unitNumber property')
            .populate('unit.property', 'name address')
            .sort({ startDate: -1 });
        res.status(200).json(leases);
    } catch (err) {
        next(err);
    }
}

// Get single lease
export const getLease = async(req, res, next) => {
    try {
        const business = req.user.isSystemAdmin ? undefined : req.user.company;
        const filter = business ? { _id: req.params.id, business } : { _id: req.params.id };

        const lease = await Lease.findOne(filter)
            .populate('tenant', 'name email phone idNumber')
            .populate('unit', 'unitNumber property amenities')
            .populate('unit.property', 'name address landlord');

        if (!lease) return res.status(404).json({ message: "Lease not found" });
        res.status(200).json(lease);
    } catch (err) {
        next(err);
    }
}

// Update lease
export const updateLease = async(req, res, next) => {
    try {
        const business = req.user.isSystemAdmin && req.body?.business ? req.body.business : req.user.company;
        const filter = req.user.isSystemAdmin
          ? { _id: req.params.id }
          : { _id: req.params.id, business };

        const updateData = { ...req.body };
        delete updateData.business;

        if (Object.prototype.hasOwnProperty.call(updateData, "billingScheduleAdjustments")) {
          updateData.billingScheduleAdjustments = sanitizeBillingScheduleAdjustments(
            updateData.billingScheduleAdjustments
          );
        }

        const updatedLease = await Lease.findOneAndUpdate(
            filter,
            { $set: updateData },
            { new: true }
        )
          .populate('tenant', 'name email phone idNumber')
          .populate('unit', 'unitNumber property amenities')
          .populate('unit.property', 'name address landlord');

        if (!updatedLease) {
          return res.status(404).json({ message: "Lease not found" });
        }

        emitToCompany(updatedLease.business, 'lease:updated', updatedLease);
        res.status(200).json(updatedLease);
    } catch (err) {
        next(err);
    }
}

// Delete lease
export const deleteLease = async(req, res, next) => {
    try {
        const filter = req.user.isSystemAdmin
          ? { _id: req.params.id }
          : { _id: req.params.id, business: req.user.company };

        const deletedLease = await Lease.findOneAndDelete(filter);
        if (!deletedLease) {
          return res.status(404).json({ message: "Lease not found" });
        }
        emitToCompany(deletedLease.business, 'lease:deleted', { _id: deletedLease._id });
        res.status(200).json({ message: "Lease deleted successfully" });
    } catch (err) {
        next(err);
    }
}

// Sign lease
export const signLease = async(req, res, next) => {
    try {
        const { signedBy, signature } = req.body;
        const filter = req.user.isSystemAdmin
          ? { _id: req.params.id }
          : { _id: req.params.id, business: req.user.company };
        const lease = await Lease.findOne(filter);

        if (!lease) return res.status(404).json({ message: "Lease not found" });

        const updateData = {};
        if (signedBy === 'tenant') {
            updateData.signedByTenant = true;
            updateData.tenantSignature = signature;
        } else if (signedBy === 'landlord') {
            updateData.signedByLandlord = true;
            updateData.landlordSignature = signature;
        }

        if ((lease.signedByTenant && signedBy === 'landlord') || 
            (lease.signedByLandlord && signedBy === 'tenant')) {
            updateData.signedDate = new Date();
            updateData.status = 'active';
        }

        const updatedLease = await Lease.findByIdAndUpdate(
            req.params.id,
            { $set: updateData },
            { new: true }
        );
        res.status(200).json(updatedLease);
    } catch (err) {
        next(err);
    }
}

// Get expiring leases
export const getExpiringLeases = async(req, res, next) => {
    const { days = 30 } = req.query;
    try {
        const business = getScopedBusiness(req);
        const today = new Date();
        const futureDate = new Date();
        futureDate.setDate(today.getDate() + parseInt(days));

        const leases = await Lease.find({
            business,
            status: 'active',
            endDate: { $gte: today, $lte: futureDate }
        })
        .populate('tenant', 'name email phone')
        .populate('unit', 'unitNumber property')
        .sort({ endDate: 1 });

        res.status(200).json(leases);
    } catch (err) {
        next(err);
    }
}

// Renew lease
export const renewLease = async(req, res, next) => {
    try {
        const { newEndDate, newRentAmount } = req.body;
        const filter = req.user.isSystemAdmin
          ? { _id: req.params.id }
          : { _id: req.params.id, business: req.user.company };
        const lease = await Lease.findOne(filter);

        if (!lease) return res.status(404).json({ message: "Lease not found" });

        const newLease = new Lease({
            tenant: lease.tenant,
            unit: lease.unit,
            startDate: new Date(),
            endDate: newEndDate,
            rentAmount: newRentAmount || lease.rentAmount,
            depositAmount: lease.depositAmount,
            paymentDueDay: lease.paymentDueDay,
            lateFee: lease.lateFee,
            terms: lease.terms,
            status: 'active',
            business: lease.business,
            billingScheduleAdjustments: []
        });

        await Lease.findByIdAndUpdate(req.params.id, { status: 'renewed' });

        const savedLease = await newLease.save();
        emitToCompany(savedLease.business, 'lease:new', savedLease);
        res.status(200).json(savedLease);
    } catch (err) {
        next(err);
    }
}