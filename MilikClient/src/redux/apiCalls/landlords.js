import { adminRequests } from "../../utils/requestMethods";
import { isListCacheFresh, resolveCompanyId } from "./shared";

import {
  setLandlordLoadMeta,
  getLandlordsStart,
  getLandlordsSuccess,
  getLandlordsFailure,
  createLandlordStart,
  createLandlordSuccess,
  createLandlordFailure,
  updateLandlordStart,
  updateLandlordSuccess,
  updateLandlordFailure,
  deleteLandlordStart,
  deleteLandlordSuccess,
  deleteLandlordFailure
} from "../landlordRedux";

// Get all landlords
export const getLandlords = (query = {}) => async (dispatch, getState) => {
  const isUnfiltered = !query.search && !query.status && !query.portal && !query.location && !query.page && !query.limit;
  const companyIdForCache = resolveCompanyId(query, getState);
  const businessKey = String(companyIdForCache || '');
  if (isUnfiltered) {
    const cache = getState().landlord;
    if (isListCacheFresh(cache.loadedFor, cache.loadedAt, businessKey)) {
      return { landlords: getState().landlord.landlords, pagination: null };
    }
  }
  dispatch(getLandlordsStart());
  try {
    const params = new URLSearchParams();

    if (query.search) params.append('search', query.search);
    if (query.status) params.append('status', query.status);
    if (query.portal) params.append('portal', query.portal);
    if (query.location) params.append('location', query.location);
    if (query.page) params.append('page', query.page);
    if (query.limit) params.append('limit', query.limit);

    const companyId = resolveCompanyId(query, getState);
    if (companyId) {
      params.append('company', companyId);
    }

    const queryString = params.toString();
    const res = await adminRequests.get(`/landlords${queryString ? `?${queryString}` : ""}`);

    let landlords = [];
    let pagination = null;
    if (Array.isArray(res.data)) {
      landlords = res.data;
    } else if (Array.isArray(res.data?.data)) {
      landlords = res.data.data;
      pagination = res.data.total != null
        ? { total: res.data.total, page: res.data.page || 1, pages: res.data.pages || 1, limit: query.limit || 5000 }
        : null;
    } else if (res.data?.success && !Array.isArray(res.data?.data)) {
      landlords = [];
    }

    dispatch(getLandlordsSuccess(pagination ? { landlords, pagination } : landlords));
    if (isUnfiltered) {
      dispatch(setLandlordLoadMeta({ loadedFor: businessKey, loadedAt: Date.now() }));
    }
    return { landlords, pagination };
  } catch (err) {
    dispatch(getLandlordsFailure());
    throw err;
  }
};

// Get single landlord
export const getLandlord = (id) => async (dispatch) => {
  dispatch(getLandlordsStart());
  try {
    const res = await adminRequests.get(`/landlords/${id}`);
    const landlord = res.data.data || res.data;
    dispatch(getLandlordsSuccess([landlord]));
    return landlord;
  } catch (err) {
    dispatch(getLandlordsFailure());
    throw err;
  }
};

// Create landlord
export const createLandlord = (landlordData) => async (dispatch) => {
  dispatch(createLandlordStart());
  try {
    const res = await adminRequests.post('/landlords', landlordData);
    const savedLandlord = res.data.data || res.data;
    dispatch(createLandlordSuccess(savedLandlord));
    return savedLandlord;
  } catch (err) {
    console.error('Create landlord error:', err);
    dispatch(createLandlordFailure());
    const message = err?.response?.data?.message || 'Failed to create landlord';
    throw new Error(message);
  }
};

// Update landlord
export const updateLandlord = (id, landlordData) => async (dispatch) => {
  dispatch(updateLandlordStart());
  try {
    const res = await adminRequests.put(`/landlords/${id}`, landlordData);
    const updatedLandlord = res.data.data || res.data;
    dispatch(updateLandlordSuccess(updatedLandlord));
    return updatedLandlord;
  } catch (err) {
    console.error('Update landlord error:', err);
    dispatch(updateLandlordFailure());
    const message = err?.response?.data?.message || err?.message || 'Failed to update landlord';
    throw new Error(message);
  }
};

// Delete landlord
export const deleteLandlord = (id) => async (dispatch) => {
  dispatch(deleteLandlordStart());
  try {
    await adminRequests.delete(`/landlords/${id}`);
    dispatch(deleteLandlordSuccess(id));
  } catch (err) {
    console.error('Delete landlord error:', err);
    dispatch(deleteLandlordFailure());
    const message = err?.response?.data?.message || err?.message || 'Failed to delete landlord';
    throw new Error(message);
  }
};
