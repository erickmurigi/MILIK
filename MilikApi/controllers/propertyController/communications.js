import { createError } from '../../utils/error.js';
import { hasCompanyActionPermission } from '../../utils/permissionControl.js';
import { normalizeCompanyId } from '../verifyToken.js';
import {
  getAvailableTemplates,
  getCommunicationPermissionTarget,
  previewCommunication,
  sendCommunication,
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

    const result = await previewCommunication({
      businessId,
      contextType,
      channel,
      templateKey,
      recordIds,
      profileId,
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

    const result = await sendCommunication({
      businessId,
      contextType,
      channel,
      templateKey,
      recordIds,
      profileId,
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};
