import mongoose from 'mongoose';
import Zone from '../models/Zone.js';
import Property from '../models/Property.js';

const toId = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * Returns property ObjectIds accessible to a field officer, or null if
 * the caller is not a field officer (meaning: no restriction applies).
 * Returns [] when user is a field officer assigned to zero zones.
 */
export const getFieldOfficerPropertyIds = async (req) => {
  if (req.user?.profile !== 'Field Officer') return null;

  const userId = req.user.id || req.user._id;
  const companyId = req.user.company;
  if (!userId || !companyId) return null;

  const zones = await Zone.find(
    { company: toId(companyId), fieldOfficers: toId(userId), isActive: true },
    { name: 1 }
  ).lean();

  if (zones.length === 0) return [];

  const zoneRegexConditions = zones.map((z) => ({
    zoneRegion: {
      $regex: `^${z.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
      $options: 'i',
    },
  }));

  const props = await Property.find(
    { business: toId(companyId), $or: zoneRegexConditions },
    { _id: 1 }
  ).lean();

  return props.map((p) => p._id);
};
