import { adminRequests } from "../../utils/requestMethods";
import { store, isListCacheFresh, extractList } from "./shared";
import { fetchAllPages } from "../../utils/fetchAllPages";

import {
  getLeasesStart,
  getLeasesSuccess,
  getLeasesFailure,
  createLeaseStart,
  createLeaseSuccess,
  createLeaseFailure,
  updateLeaseStart,
  updateLeaseSuccess,
  updateLeaseFailure,
  deleteLeaseStart,
  deleteLeaseSuccess,
  deleteLeaseFailure,
  setLeaseLoadMeta,
  signLeaseStart,
  signLeaseSuccess,
  signLeaseFailure,
  renewLeaseStart,
  renewLeaseSuccess,
  renewLeaseFailure
} from "../leasesRedux";

// Get all leases
export const getLeases = async (dispatch, business, status = null, tenant = null, unit = null) => {
  const businessKey = String(business || '');
  if (!tenant && !unit) {
    const cache = store.getState().lease;
    if (isListCacheFresh(cache.loadedFor, cache.loadedAt, businessKey)) {
      return;
    }
  }
  dispatch(getLeasesStart());
  try {
    let url = `/leases?business=${business}`;
    if (status) url += `&status=${status}`;
    if (tenant) url += `&tenant=${tenant}`;
    if (unit) url += `&unit=${unit}`;

    // Company-wide loads page through the whole list; the server returns 50 by default, which
    // left the Agreements page with only the first 50 leases.
    let list;
    let scopedBody = null;
    if (tenant || unit) {
      scopedBody = (await adminRequests.get(url)).data;
      list = extractList(scopedBody);
    } else {
      const bodies = await fetchAllPages(
        (page, limit) => adminRequests.get(`${url}&page=${page}&limit=${limit}`).then((res) => res.data),
        200
      );
      list = bodies.flatMap((body) => extractList(body));
    }
    dispatch(getLeasesSuccess(list));

    // Only stamp the company-wide cache when no per-entity filter is used.
    // Tenant- or unit-scoped fetches return a partial list and must not
    // mark the global cache as fresh.
    if (!tenant && !unit) {
      dispatch(setLeaseLoadMeta({ loadedFor: String(business || ''), loadedAt: Date.now() }));
    }

    return scopedBody ?? list;
  } catch (err) {
    dispatch(getLeasesFailure());
    throw err; // Re-throw so caller can handle the error
  }
};

// Get single lease
export const getLease = async (dispatch, id) => {
  dispatch(getLeasesStart());
  try {
    const res = await adminRequests.get(`/leases/${id}`);
    dispatch(getLeasesSuccess([res.data]));
  } catch (err) {
    dispatch(getLeasesFailure());
  }
};

// Create lease
export const createLease = async (dispatch, leaseData) => {
  dispatch(createLeaseStart());
  try {
    const res = await adminRequests.post("/leases", leaseData);
    dispatch(createLeaseSuccess(res.data));
    dispatch(setLeaseLoadMeta({ loadedFor: null, loadedAt: 0 }));
    return res.data;
  } catch (err) {
    dispatch(createLeaseFailure());
    throw err;
  }
};

// Update rent reviews / escalations only (dedicated lightweight endpoint)
export const updateLeaseReviews = async (id, payload) => {
  const res = await adminRequests.patch(`/leases/${id}/reviews`, payload);
  return res.data;
};

// Update lease
export const updateLease = async (dispatch, id, leaseData) => {
  dispatch(updateLeaseStart());
  try {
    const res = await adminRequests.put(`/leases/${id}`, leaseData);
    dispatch(updateLeaseSuccess(res.data));
    dispatch(setLeaseLoadMeta({ loadedFor: null, loadedAt: 0 }));
    return res.data;
  } catch (err) {
    dispatch(updateLeaseFailure());
    throw err;
  }
};

// Delete lease
export const deleteLease = async (dispatch, id) => {
  dispatch(deleteLeaseStart());
  try {
    await adminRequests.delete(`/leases/${id}`);
    dispatch(deleteLeaseSuccess(id));
    dispatch(setLeaseLoadMeta({ loadedFor: null, loadedAt: 0 }));
    return true;
  } catch (err) {
    dispatch(deleteLeaseFailure());
    throw err;
  }
};

// Sign lease
export const signLease = async (dispatch, id, signData) => {
  dispatch(signLeaseStart());
  try {
    const res = await adminRequests.put(`/leases/sign/${id}`, signData);
    dispatch(signLeaseSuccess(res.data));
    dispatch(setLeaseLoadMeta({ loadedFor: null, loadedAt: 0 }));
    return res.data;
  } catch (err) {
    dispatch(signLeaseFailure());
    throw err;
  }
};

// Get expiring leases
export const getExpiringLeases = async (business, days = 30) => {
  try {
    const res = await adminRequests.get(`/leases/find/expiring?business=${business}&days=${days}`);
    return res.data;
  } catch (err) {
    throw err;
  }
};

// Renew lease
export const renewLease = async (dispatch, id, renewData) => {
  dispatch(renewLeaseStart());
  try {
    const res = await adminRequests.put(`/leases/renew/${id}`, renewData);
    dispatch(renewLeaseSuccess(res.data));
    dispatch(setLeaseLoadMeta({ loadedFor: null, loadedAt: 0 }));
    return res.data;
  } catch (err) {
    dispatch(renewLeaseFailure());
    throw err;
  }
};

// Generate lease document PDF
export const generateLeaseDocument = async (dispatch, id) => {
  dispatch(updateLeaseStart());
  try {
    const res = await adminRequests.post(`/leases/${id}/generate-document`);
    dispatch(updateLeaseSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(updateLeaseFailure());
    throw err;
  }
};

export const backfillMissingLeases = async (business) => {
  const res = await adminRequests.post(`/tenants/backfill-leases`, { business });
  return res.data;
};
