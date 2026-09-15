import { adminRequests } from "../../utils/requestMethods";
import { store, isListCacheFresh } from "./shared";

import {
  setUtilityLoadMeta,
  getUtilitiesStart,
  getUtilitiesSuccess,
  getUtilitiesFailure,
  createUtilityStart,
  createUtilitySuccess,
  createUtilityFailure,
  updateUtilityStart,
  updateUtilitySuccess,
  updateUtilityFailure,
  deleteUtilityStart,
  deleteUtilitySuccess,
  deleteUtilityFailure
} from "../utilityRedux";

// Get all utilities
export const getUtilities = async (dispatch, business) => {
  const businessKey = String(business || '');
  const cache = store.getState().utility;
  if (isListCacheFresh(cache.loadedFor, cache.loadedAt, businessKey)) {
    return;
  }
  dispatch(getUtilitiesStart());
  try {
    const res = await adminRequests.get(`/utilities?business=${business}`);
    dispatch(getUtilitiesSuccess(res.data));
    dispatch(setUtilityLoadMeta({ loadedFor: businessKey, loadedAt: Date.now() }));
  } catch (err) {
    dispatch(getUtilitiesFailure());
  }
};

// Get single utility
export const getUtility = async (dispatch, id) => {
  dispatch(getUtilitiesStart());
  try {
    const res = await adminRequests.get(`/utilities/${id}`);
    dispatch(getUtilitiesSuccess([res.data]));
  } catch (err) {
    dispatch(getUtilitiesFailure());
  }
};

// Create utility
export const createUtility = async (dispatch, utilityData) => {
  dispatch(createUtilityStart());
  try {
    const res = await adminRequests.post("/utilities", utilityData);
    dispatch(createUtilitySuccess(res.data));
    dispatch(setUtilityLoadMeta({ loadedFor: null, loadedAt: 0 }));
    return res.data;
  } catch (err) {
    dispatch(createUtilityFailure());
    throw err;
  }
};

// Update utility
export const updateUtility = async (dispatch, id, utilityData) => {
  dispatch(updateUtilityStart());
  try {
    const res = await adminRequests.put(`/utilities/${id}`, utilityData);
    dispatch(updateUtilitySuccess(res.data));
    dispatch(setUtilityLoadMeta({ loadedFor: null, loadedAt: 0 }));
    return res.data;
  } catch (err) {
    dispatch(updateUtilityFailure());
    throw err;
  }
};

// Delete utility
export const deleteUtility = async (dispatch, id) => {
  dispatch(deleteUtilityStart());
  try {
    await adminRequests.delete(`/utilities/${id}`);
    dispatch(deleteUtilitySuccess(id));
    dispatch(setUtilityLoadMeta({ loadedFor: null, loadedAt: 0 }));
    return true;
  } catch (err) {
    dispatch(deleteUtilityFailure());
    throw err;
  }
};
