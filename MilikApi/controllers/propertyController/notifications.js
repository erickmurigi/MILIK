// controllers/notificationController.js
import mongoose from "mongoose";
import Notification from "../../models/Notification.js";
import { emitToCompany } from "../../utils/socketManager.js";

const resolveBusinessId = (req) => {
  const requested = req.query?.business || req.body?.business || null;
  const authenticated = req.user?.company?._id || req.user?.company || null;

  if (req.user?.isSystemAdmin || req.user?.superAdminAccess) {
    return requested || authenticated || null;
  }

  return authenticated || requested || null;
};

const scopedNotificationQuery = (req, id) => {
  const business = resolveBusinessId(req);
  if (!business) return null;
  return { _id: id, business };
};

// Create notification
export const createNotification = async (req, res, next) => {
  const business = resolveBusinessId(req);
  const newNotification = new Notification({ ...req.body, business });

  try {
    const savedNotification = await newNotification.save();
    emitToCompany(business, "notification:new", savedNotification);
    res.status(200).json(savedNotification);
  } catch (err) {
    next(err);
  }
};

// Get all notifications
export const getNotifications = async (req, res, next) => {
  const { recipient, isRead, type, page, limit } = req.query;
  try {
    const business = resolveBusinessId(req);
    const filter = { business };
    if (recipient) filter.recipient = recipient;
    if (isRead !== undefined) filter.isRead = isRead === "true";
    if (type) filter.type = type;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));

    const [notifications, total] = await Promise.all([
      Notification.find(filter)
        .select("type title message isRead priority recipient relatedId relatedType business createdAt")
        .populate("recipient", "name email")
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      Notification.countDocuments(filter),
    ]);

    res.status(200).json({
      notifications,
      pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
};

// Get single notification
export const getNotification = async (req, res, next) => {
  try {
    const notification = await Notification.findOne(scopedNotificationQuery(req, req.params.id))
      .populate("recipient", "name email");
    if (!notification) return res.status(404).json({ message: "Notification not found" });
    res.status(200).json(notification);
  } catch (err) {
    next(err);
  }
};

// Mark as read
export const markAsRead = async (req, res, next) => {
  try {
    const updatedNotification = await Notification.findOneAndUpdate(
      scopedNotificationQuery(req, req.params.id),
      { $set: { isRead: true } },
      { new: true }
    );
    if (!updatedNotification) return res.status(404).json({ message: "Notification not found" });
    res.status(200).json(updatedNotification);
  } catch (err) {
    next(err);
  }
};

// Mark all as read — scoped to business only (no recipient filter, since notifications are
// fetched without recipient filter in getNotifications)
export const markAllAsRead = async (req, res, next) => {
  try {
    const business = resolveBusinessId(req);
    if (!business) return res.status(400).json({ message: "Business context required" });
    await Notification.updateMany({ business, isRead: false }, { $set: { isRead: true } });
    res.status(200).json({ message: "All notifications marked as read" });
  } catch (err) {
    next(err);
  }
};

// Delete notification
export const deleteNotification = async (req, res, next) => {
  try {
    const deleted = await Notification.findOneAndDelete(scopedNotificationQuery(req, req.params.id));
    if (!deleted) return res.status(404).json({ message: "Notification not found" });
    res.status(200).json({ message: "Notification deleted successfully" });
  } catch (err) {
    next(err);
  }
};

// Get notification stats
export const getNotificationStats = async (req, res, next) => {
  const { recipient } = req.query;
  if (!recipient || !mongoose.Types.ObjectId.isValid(recipient)) {
    return res.status(400).json({ message: "Valid recipient ID is required" });
  }
  try {
    const business = resolveBusinessId(req);
    const [total, unread, byType] = await Promise.all([
      Notification.countDocuments({ recipient, business }),
      Notification.countDocuments({ recipient, business, isRead: false }),
      Notification.aggregate([
        { $match: { recipient: new mongoose.Types.ObjectId(recipient), business } },
        { $group: { _id: "$type", count: { $sum: 1 } } },
      ]),
    ]);

    res.status(200).json({ total, unread, byType });
  } catch (err) {
    next(err);
  }
};
