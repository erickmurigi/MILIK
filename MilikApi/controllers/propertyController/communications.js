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
} from '../../services/communicationService.js';

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

    const result = await sendCommunication({
      businessId,
      contextType,
      channel,
      templateKey,
      recordIds,
      profileId,
      customBody,
      customSubject,
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const getSmsLogsController = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, 'Business is required.'));

    const limit = Math.min(100, Number(req.query?.limit || 30));
    const channel = String(req.query?.channel || '').trim() || undefined;
    const contextType = String(req.query?.contextType || '').trim() || undefined;
    const status = String(req.query?.status || '').trim() || undefined;

    const logs = await getSmsLogs({ businessId, limit, channel, contextType, status });
    return res.status(200).json(logs);
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
