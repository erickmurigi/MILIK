// NOTE: addUtilityToUnit/removeUtilityFromUnit below dispatch
// addUtilityToUnitStart/Success/Failure and removeUtilityFromUnitStart/Success/Failure,
// which are not exported by unitRedux.js or utilityRedux.js (or anywhere else in the
// codebase) and were never imported in the original apiCalls.js either — this is
// pre-existing dead/broken code (would throw ReferenceError if ever called) that the
// original file's top-level `/* eslint-disable no-undef */` was masking. Neither
// function has any caller anywhere in the frontend. Preserved as-is (not this task's
// job to fix — flagged for Track C item 5), with the same eslint-disable so this file
// isn't left noisier than the original.
/* eslint-disable no-undef */
import { adminRequests } from "../../utils/requestMethods";
import { extractList } from "./shared";

import {
  getUnitsStart,
  getUnitsSuccess,
  getUnitsFailure,
  createUnitStart,
  createUnitSuccess,
  createUnitFailure,
  updateUnitStart,
  updateUnitSuccess,
  updateUnitFailure,
  deleteUnitStart,
  deleteUnitSuccess,
  deleteUnitFailure,
  updateUnitStatusStart,
  updateUnitStatusSuccess,
  updateUnitStatusFailure
} from "../unitRedux";

// Get all units
export const getUnits = async (dispatch, business, property = null, status = null) => {
  dispatch(getUnitsStart());
  try {
    let url = `/units?business=${business}`;
    if (property) url += `&property=${property}`;
    if (status) url += `&status=${status}`;

    const res = await adminRequests.get(url);
    dispatch(getUnitsSuccess(extractList(res.data)));
  } catch (err) {
    dispatch(getUnitsFailure());
  }
};

// Get single unit
export const getUnit = async (dispatch, id) => {
  dispatch(getUnitsStart());
  try {
    const res = await adminRequests.get(`/units/${id}`);
    dispatch(getUnitsSuccess([res.data]));
  } catch (err) {
    dispatch(getUnitsFailure());
  }
};

// Create unit
export const createUnit = async (dispatch, unitData) => {
  dispatch(createUnitStart());
  try {
    const res = await adminRequests.post("/units", unitData);
    dispatch(createUnitSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(createUnitFailure());
    throw err;
  }
};

// Update unit
export const updateUnit = async (dispatch, id, unitData) => {
  dispatch(updateUnitStart());
  try {
    const res = await adminRequests.put(`/units/${id}`, unitData);
    dispatch(updateUnitSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(updateUnitFailure());
    throw err;
  }
};

// Delete unit
export const deleteUnit = async (dispatch, id) => {
  dispatch(deleteUnitStart());
  try {
    await adminRequests.delete(`/units/${id}`);
    dispatch(deleteUnitSuccess(id));
    return true;
  } catch (err) {
    dispatch(deleteUnitFailure());
    throw err;
  }
};

// Update unit status
export const updateUnitStatus = async (dispatch, id, statusData) => {
  dispatch(updateUnitStatusStart());
  try {
    const res = await adminRequests.put(`/units/status/${id}`, statusData);
    dispatch(updateUnitStatusSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(updateUnitStatusFailure());
    throw err;
  }
};

// Get available units
export const getAvailableUnits = async (business, property = null) => {
  try {
    let url = `/units/find/available?business=${business}`;
    if (property) url += `&property=${property}`;

    const res = await adminRequests.get(url);
    return res.data;
  } catch (err) {
    throw err;
  }
};

export const getUnitUtilities = async (unitId) => {
  try {
    const res = await adminRequests.get(`/units/${unitId}/utilities`);
    return res.data;
  } catch (err) {
    throw err;
  }
};

export const addUtilityToUnit = async (dispatch, unitId, utilityData) => {
  dispatch(addUtilityToUnitStart());
  try {
    const res = await adminRequests.post(`/units/${unitId}/utilities`, utilityData);
    dispatch(addUtilityToUnitSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(addUtilityToUnitFailure());
    throw err;
  }
};

export const removeUtilityFromUnit = async (dispatch, unitId, utilityId) => {
  dispatch(removeUtilityFromUnitStart());
  try {
    await adminRequests.delete(`/units/${unitId}/utilities/${utilityId}`);
    dispatch(removeUtilityFromUnitSuccess(utilityId));
    return true;
  } catch (err) {
    dispatch(removeUtilityFromUnitFailure());
    throw err;
  }
};

export const getCompanyUnitTypes = (businessId) =>
  adminRequests.get(`/company-settings/${businessId}/unit-types`).then((r) => r.data);

export const getCompanyMaintenanceCategories = (businessId) =>
  adminRequests.get(`/company-settings/${businessId}/maintenance-categories`).then((r) => r.data);
