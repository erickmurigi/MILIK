import { adminRequests } from "../../utils/requestMethods";
import { extractList } from "./shared";

import {
  getNotificationsStart,
  getNotificationsSuccess,
  getNotificationsFailure,
  createNotificationStart,
  createNotificationSuccess,
  createNotificationFailure,
  updateNotificationStart,
  updateNotificationSuccess,
  updateNotificationFailure,
  deleteNotificationStart,
  deleteNotificationSuccess,
  deleteNotificationFailure,
  markNotificationAsReadStart,
  markNotificationAsReadSuccess,
  markNotificationAsReadFailure,
  markAllNotificationsAsReadStart,
  markAllNotificationsAsReadSuccess,
  markAllNotificationsAsReadFailure
} from "../notificationPropertyRedux";

// Get all notifications
export const getNotifications = async (dispatch, business, recipient = null, isRead = null, type = null) => {
  dispatch(getNotificationsStart());
  try {
    let url = `/notifications?business=${business}`;
    if (recipient) url += `&recipient=${recipient}`;
    if (isRead !== undefined) url += `&isRead=${isRead}`;
    if (type) url += `&type=${type}`;

    const res = await adminRequests.get(url);
    dispatch(getNotificationsSuccess(extractList(res.data)));
  } catch (err) {
    dispatch(getNotificationsFailure());
  }
};

// Get single notification
export const getNotification = async (dispatch, id) => {
  dispatch(getNotificationsStart());
  try {
    const res = await adminRequests.get(`/notifications/${id}`);
    dispatch(getNotificationsSuccess([res.data]));
  } catch (err) {
    dispatch(getNotificationsFailure());
  }
};

// Create notification
export const createNotification = async (dispatch, notificationData) => {
  dispatch(createNotificationStart());
  try {
    const res = await adminRequests.post("/notifications", notificationData);
    dispatch(createNotificationSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(createNotificationFailure());
    throw err;
  }
};

// Update notification
export const updateNotification = async (dispatch, id, notificationData) => {
  dispatch(updateNotificationStart());
  try {
    const res = await adminRequests.put(`/notifications/${id}`, notificationData);
    dispatch(updateNotificationSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(updateNotificationFailure());
    throw err;
  }
};

// Delete notification
export const deleteNotification = async (dispatch, id) => {
  dispatch(deleteNotificationStart());
  try {
    await adminRequests.delete(`/notifications/${id}`);
    dispatch(deleteNotificationSuccess(id));
    return true;
  } catch (err) {
    dispatch(deleteNotificationFailure());
    throw err;
  }
};

// Mark notification as read
export const markNotificationAsRead = async (dispatch, id) => {
  dispatch(markNotificationAsReadStart());
  try {
    const res = await adminRequests.put(`/notifications/read/${id}`);
    dispatch(markNotificationAsReadSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(markNotificationAsReadFailure());
    throw err;
  }
};

// Mark all notifications as read — no recipient needed, scoped by authenticated business
export const markAllNotificationsAsRead = async (dispatch) => {
  dispatch(markAllNotificationsAsReadStart());
  try {
    await adminRequests.put("/notifications/read-all");
    dispatch(markAllNotificationsAsReadSuccess());
    return true;
  } catch (err) {
    dispatch(markAllNotificationsAsReadFailure());
    throw err;
  }
};

// Get notification stats
export const getNotificationStats = async (recipient) => {
  try {
    const res = await adminRequests.get(`/notifications/get/stats?recipient=${recipient}`);
    return res.data;
  } catch (err) {
    throw err;
  }
};
