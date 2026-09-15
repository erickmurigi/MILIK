import { adminRequests } from "../../utils/requestMethods";

import {
  getUsersStart,
  getUsersSuccess,
  getUsersFailure,
  getUserStart,
  getUserSuccess,
  getUserFailure,
  createUserStart,
  createUserSuccess,
  createUserFailure,
  updateUserStart,
  updateUserSuccess,
  updateUserFailure,
  deleteUserStart,
  deleteUserSuccess,
  deleteUserFailure,
  toggleUserLockStart,
  toggleUserLockSuccess,
  toggleUserLockFailure,
} from "../userRedux";

// Helper to transform user data (if needed)
const transformUserData = (data) => {
  // No transformation needed for now
  return data;
};

// Get all users for a company
export const getUsers = (companyId, queryParams = {}) => async (dispatch) => {
  dispatch(getUsersStart());
  try {
    const params = { ...queryParams, companyId };
    const res = await adminRequests.get('/users', { params });
    // Handle paginated response: { users, totalPages, ... }
    if (res.data && Array.isArray(res.data.users)) {
      dispatch(getUsersSuccess(res.data.users));
    } else if (Array.isArray(res.data)) {
      dispatch(getUsersSuccess(res.data));
    } else {
      dispatch(getUsersSuccess([]));
    }
    return res.data;
  } catch (err) {
    dispatch(getUsersFailure());
    throw err;
  }
};

// Get single user
export const getUser = (id) => async (dispatch) => {
  dispatch(getUserStart());
  try {
    const res = await adminRequests.get(`/users/${id}`);
    const payload = res?.data?.user || res?.data;
    dispatch(getUserSuccess(payload));
    return payload;
  } catch (err) {
    dispatch(getUserFailure());
    throw err;
  }
};

// Create new user
export const createUser = (userData) => async (dispatch) => {
  dispatch(createUserStart());
  try {
    const payload = transformUserData(userData);
    const res = await adminRequests.post('/users', payload);
    const payloadData = res?.data?.user || res?.data;
    dispatch(createUserSuccess(payloadData));
    return res?.data || payloadData;
  } catch (err) {
    dispatch(createUserFailure());
    throw err;
  }
};

// Update user
export const updateUser = (id, userData) => async (dispatch) => {
  dispatch(updateUserStart());
  try {
    if (userData.password === "") delete userData.password;
    const payload = transformUserData(userData);
    const res = await adminRequests.put(`/users/${id}`, payload);
    const payloadData = res?.data?.user || res?.data;
    dispatch(updateUserSuccess({ id, user: payloadData }));
    return payloadData;
  } catch (err) {
    dispatch(updateUserFailure());
    throw err;
  }
};

// Delete user
export const deleteUser = (id) => async (dispatch) => {
  dispatch(deleteUserStart());
  try {
    await adminRequests.delete(`/users/${id}`);
    dispatch(deleteUserSuccess(id));
  } catch (err) {
    dispatch(deleteUserFailure());
    throw err;
  }
};

export const resetUserPassword = (id) => async () => {
  const res = await adminRequests.post(`/users/${id}/reset-password`);
  return res.data;
};

// Toggle lock status
export const toggleUserLock = (id) => async (dispatch) => {
  dispatch(toggleUserLockStart());
  try {
    const res = await adminRequests.patch(`/users/${id}/toggle-lock`);
    dispatch(toggleUserLockSuccess({ id, locked: res.data.locked }));
    return res.data;
  } catch (err) {
    dispatch(toggleUserLockFailure());
    throw err;
  }
};
