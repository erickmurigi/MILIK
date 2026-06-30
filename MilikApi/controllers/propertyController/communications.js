import mongoose from 'mongoose';
import { createError } from '../../utils/error.js';
import { hasCompanyActionPermission } from '../../utils/permissionControl.js';
import { normalizeCompanyId } from '../verifyToken.js';
import {
  getAvailableTemplates,
  getCommunicationPermissionTarget,
  getSmsLogs,
  previewCommunication,
  sendCommunication,
  sendTestSms,
  sendTestEmail,
} from '../../services/communicationService.js';
import SmsLog from '../../models/SmsLog.js';

const resolveBusinessId = (req) =>
  normalizeCompanyId(
    req.body?.business ||
      req.body?.businessId ||
      req.query?.business ||
      req.query?.businessId ||
      req.user?.company?._id ||
      req.user?.company ||
      req.user?.businessId ||
      ''
  );

const ensurePermission = ({ req, businessId, contextType, action = 'view' }) => {
  const target = getCommunicationPermissionTarget(contextType);
  if (!target) {
    throw createError(400, 'Unsupported communication context.');
  }

  const allowed = hasCompanyActionPermission({
    user: req.user,
    company: businessId,
    moduleKey: target.moduleKey,
    resource: target.resource,
    action,
  });

  if (!allowed) {
    throw createError(403, `Permission denied for ${target.resource}.${action}`);
  }

  return target;
};

export const getCommunicationTemplates = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const contextType = String(req.query?.contextType || '').trim();

    if (!businessId) {
      return next(createError(400, 'Business is required for communication templates.'));
    }
    if (!contextType) {
      return next(createError(400, 'Communication context is required.'));
    }

    ensurePermission({ req, businessId, contextType, action: 'view' });
    const result = await getAvailableTemplates({ businessId, contextType });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const previewCommunicationController = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const contextType = String(req.body?.contextType || '').trim();
    const channel = String(req.body?.channel || '').trim().toLowerCase();
    const templateKey = String(req.body?.templateKey || '').trim();
    const profileId = String(req.body?.profileId || '').trim();
    const recordIds = Array.isArray(req.body?.recordIds) ? req.body.recordIds : [];

    if (!businessId) {
      return next(createError(400, 'Business is required before previewing communication.'));
    }
    if (!contextType || !channel || !templateKey) {
      return next(createError(400, 'Context, channel and template are required before previewing communication.'));
    }

    ensurePermission({ req, businessId, contextType, action: 'view' });

    const customBody = String(req.body?.customBody || '').trim();

    const result = await previewCommunication({
      businessId,
      contextType,
      channel,
      templateKey,
      recordIds,
      profileId,
      customBody,
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

// For bulk sends (> this threshold), respond 202 immediately and process in background.
// Small sends stay synchronous so the frontend gets instant results.
const BACKGROUND_THRESHOLD = 10;

export const sendCommunicationController = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const contextType = String(req.body?.contextType || '').trim();
    const channel = String(req.body?.channel || '').trim().toLowerCase();
    const templateKey = String(req.body?.templateKey || '').trim();
    const profileId = String(req.body?.profileId || '').trim();
    const recordIds = Array.isArray(req.body?.recordIds) ? req.body.recordIds : [];

    if (!businessId) {
      return next(createError(400, 'Business is required before sending communication.'));
    }
    if (!contextType || !channel || !templateKey) {
      return next(createError(400, 'Context, channel and template are required before sending communication.'));
    }

    ensurePermission({ req, businessId, contextType, action: 'send' });

    const customBody    = String(req.body?.customBody    || '').trim();
    const customSubject = String(req.body?.customSubject || '').trim();

    const args = { businessId, contextType, channel, templateKey, recordIds, profileId, customBody, customSubject };

    if (recordIds.length > BACKGROUND_THRESHOLD) {
      // Respond immediately — results land in the communication logs
      res.status(202).json({
        queued: true,
        count: recordIds.length,
        message: `Sending ${channel.toUpperCase()} to ${recordIds.length} recipients in the background. Check the communication log for delivery status.`,
      });
      sendCommunication(args).catch((err) => {
        console.error('[sendCommunication] Background send error:', err?.message || err);
      });
      return;
    }

    const result = await sendCommunication(args);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const getSmsLogsController = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, 'Business is required.'));

    const limit       = Math.min(Math.max(Number(req.query?.limit || 25), 1), 100);
    const page        = Math.max(Number(req.query?.page || 1), 1);
    const channel     = String(req.query?.channel     || '').trim() || undefined;
    const contextType = String(req.query?.contextType || '').trim() || undefined;
    const status      = String(req.query?.status      || '').trim() || undefined;
    const search      = String(req.query?.search      || '').trim() || undefined;

    const result = await getSmsLogs({ businessId, limit, page, channel, contextType, status, search });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const deleteSmsLogController = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, 'Business is required.'));

    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return next(createError(400, 'Invalid log ID.'));

    const log = await SmsLog.findOne({ _id: id, business: businessId }).lean();
    if (!log) return next(createError(404, 'SMS log not found.'));

    if (log.status === 'sent' && !log.isTest) {
      return next(createError(400, 'Sent messages cannot be deleted — they form part of the communication audit trail.'));
    }

    await SmsLog.deleteOne({ _id: id });
    return res.status(200).json({ success: true, message: 'Log entry deleted.' });
  } catch (error) {
    return next(error);
  }
};

export const sendTestSmsController = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, 'Business is required.'));

    const phone = String(req.body?.phone || '').trim();
    const message = String(req.body?.message || '').trim();
    const profileId = String(req.body?.profileId || '').trim();

    if (!phone) return next(createError(400, 'A phone number is required for the test SMS.'));

    const result = await sendTestSms({ businessId, phone, message, profileId });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const sendTestEmailController = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, 'Business is required.'));

    const email   = String(req.body?.email   || '').trim();
    const subject = String(req.body?.subject || '').trim();
    const body    = String(req.body?.body    || '').trim();

    if (!email)   return next(createError(400, 'An email address is required.'));
    if (!subject) return next(createError(400, 'A subject is required.'));

    const result = await sendTestEmail({ businessId, email, subject, body });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const getEmailLogsController = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, 'Business is required.'));

    const limit       = Math.min(Math.max(Number(req.query?.limit || 25), 1), 100);
    const page        = Math.max(Number(req.query?.page || 1), 1);
    const status      = String(req.query?.status || '').trim() || undefined;
    const search      = String(req.query?.search || '').trim() || undefined;

    const result = await getSmsLogs({ businessId, limit, page, channel: 'email', status, search });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};
