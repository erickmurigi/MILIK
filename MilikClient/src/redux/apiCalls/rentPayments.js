import { adminRequests } from "../../utils/requestMethods";
import { store, isListCacheFresh, extractList } from "./shared";

import {
  getRentPaymentsStart,
  getRentPaymentsSuccess,
  getRentPaymentsFailure,
  setRentPaymentsLoaded,
  createRentPaymentStart,
  createRentPaymentSuccess,
  createRentPaymentFailure,
  updateRentPaymentStart,
  updateRentPaymentSuccess,
  updateRentPaymentFailure,
  deleteRentPaymentStart,
  deleteRentPaymentSuccess,
  deleteRentPaymentFailure,
  confirmRentPaymentStart,
  confirmRentPaymentSuccess,
  confirmRentPaymentFailure,
  unconfirmRentPaymentStart,
  unconfirmRentPaymentSuccess,
  unconfirmRentPaymentFailure
} from "../rentPaymentRedux";

export const getRentPayments = async (dispatch, business, tenant = null, unit = null, month = null, year = null, paymentType = null, status = "active") => {
  const businessKey = String(business || '');
  const isUnfiltered = !tenant && !unit && !month && !year && !paymentType;
  if (isUnfiltered) {
    const cache = store.getState().rentPayment;
    if (isListCacheFresh(cache.loadedFor, cache.loadedAt, businessKey)) {
      return;
    }
  }
  dispatch(getRentPaymentsStart());
  try {
    let url = `/rent-payments?business=${business}`;
    if (tenant) url += `&tenant=${tenant}`;
    if (unit) url += `&unit=${unit}`;
    if (month) url += `&month=${month}`;
    if (year) url += `&year=${year}`;
    if (paymentType) url += `&paymentType=${paymentType}`;
    if (status) url += `&status=${status}`;

    const res = await adminRequests.get(url);
    dispatch(getRentPaymentsSuccess(extractList(res.data)));
    // Only stamp the company-wide cache when no per-entity filter is used —
    // a filtered fetch returns a partial list and must not mark it fresh.
    if (isUnfiltered) {
      dispatch(setRentPaymentsLoaded({ business }));
    }
  } catch (err) {
    dispatch(getRentPaymentsFailure());
  }
};

export const listRentPaymentsPage = async (params = {}) => {
  const effectiveParams = { ...(params || {}) };
  if (effectiveParams.status === undefined || effectiveParams.status === null || effectiveParams.status === "") {
    effectiveParams.status = "active";
  }

  const search = new URLSearchParams();
  Object.entries(effectiveParams).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      search.append(key, value);
    }
  });

  const query = search.toString();
  const res = await adminRequests.get(`/rent-payments${query ? `?${query}` : ""}`);
  const payload = res?.data;
  const items = extractList(payload);
  const pagination = payload?.pagination || {
    page: 1,
    limit: items.length || 0,
    totalItems: items.length,
    totalPages: 1,
    hasPreviousPage: false,
    hasNextPage: false,
  };

  return { items, pagination, raw: payload };
};

// Get single rent payment
export const getRentPayment = async (dispatch, id) => {
  dispatch(getRentPaymentsStart());
  try {
    const res = await adminRequests.get(`/rent-payments/${id}`);
    dispatch(getRentPaymentsSuccess([res.data]));
  } catch (err) {
    dispatch(getRentPaymentsFailure());
  }
};

// Create rent payment
export const createRentPayment = async (dispatch, paymentData) => {
  dispatch(createRentPaymentStart());
  try {
    const res = await adminRequests.post("/rent-payments", paymentData);
    dispatch(createRentPaymentSuccess(res.data));
    dispatch(setRentPaymentsLoaded({ business: null }));
    return res.data;
  } catch (err) {
    dispatch(createRentPaymentFailure());
    throw err;
  }
};

export const getReceiptAllocationOptions = async (id, { adminOverride = false } = {}) => {
  const url = adminOverride
    ? `/rent-payments/${id}/allocation-options?adminOverride=true`
    : `/rent-payments/${id}/allocation-options`;
  const res = await adminRequests.get(url);
  return res?.data?.data || res?.data || {};
};

export const updateReceiptAllocations = async (dispatch, id, payload = {}) => {
  dispatch(updateRentPaymentStart());
  try {
    const res = await adminRequests.put(`/rent-payments/${id}/allocations`, payload);
    const updated = res?.data?.data || res?.data;
    if (updated?._id) {
      dispatch(updateRentPaymentSuccess(updated));
    } else {
      dispatch(updateRentPaymentFailure());
    }
    return updated;
  } catch (err) {
    dispatch(updateRentPaymentFailure());
    throw err;
  }
};

// Update rent payment
export const updateRentPayment = async (dispatch, id, paymentData) => {
  dispatch(updateRentPaymentStart());
  try {
    const res = await adminRequests.put(`/rent-payments/${id}`, paymentData);
    dispatch(updateRentPaymentSuccess(res.data));
    dispatch(setRentPaymentsLoaded({ business: null }));
    return res.data;
  } catch (err) {
    dispatch(updateRentPaymentFailure());
    throw err;
  }
};

// Delete rent payment
export const deleteRentPayment = async (dispatch, id) => {
  dispatch(deleteRentPaymentStart());
  try {
    await adminRequests.delete(`/rent-payments/${id}`);
    dispatch(deleteRentPaymentSuccess(id));
    dispatch(setRentPaymentsLoaded({ business: null }));
    return true;
  } catch (err) {
    dispatch(deleteRentPaymentFailure());
    throw err;
  }
};

// Confirm rent payment
export const confirmRentPayment = async (dispatch, id, confirmData) => {
  dispatch(confirmRentPaymentStart());
  try {
    const res = await adminRequests.put(`/rent-payments/confirm/${id}`, confirmData);
    dispatch(confirmRentPaymentSuccess(res.data));
    dispatch(setRentPaymentsLoaded({ business: null }));
    return res.data;
  } catch (err) {
    dispatch(confirmRentPaymentFailure());
    throw err;
  }
};

// Unconfirm rent payment - allows unconfirming to enable deletion
export const unconfirmRentPayment = async (dispatch, id) => {
  dispatch(unconfirmRentPaymentStart());
  try {
    const res = await adminRequests.put(`/rent-payments/unconfirm/${id}`, {});
    dispatch(unconfirmRentPaymentSuccess(res.data.data || res.data));
    dispatch(setRentPaymentsLoaded({ business: null }));
    return res.data;
  } catch (err) {
    dispatch(unconfirmRentPaymentFailure());
    throw err;
  }
};

// Reverse rent payment (audit-safe; creates reversal entry instead of deleting)
export const reverseRentPayment = async (dispatch, id, reverseData = {}) => {
  dispatch(updateRentPaymentStart());
  try {
    const res = await adminRequests.put(`/rent-payments/reverse/${id}`, reverseData);
    const updatedOriginal = res?.data?.data?.original;
    if (updatedOriginal) {
      dispatch(updateRentPaymentSuccess(updatedOriginal));
    } else {
      dispatch(updateRentPaymentFailure());
    }
    return res.data;
  } catch (err) {
    dispatch(updateRentPaymentFailure());
    throw err;
  }
};

export const cancelRentPaymentReversal = async (dispatch, id, data = {}) => {
  dispatch(updateRentPaymentStart());
  try {
    const res = await adminRequests.put(`/rent-payments/reverse/cancel/${id}`, data);
    const restored = res?.data?.data?.original;
    if (restored) {
      dispatch(updateRentPaymentSuccess(restored));
    } else {
      dispatch(updateRentPaymentFailure());
    }
    return res.data;
  } catch (err) {
    dispatch(updateRentPaymentFailure());
    throw err;
  }
};

// Cancel reversal and restore receipt allocation effect
// Alias for cancelRentPaymentReversal — kept for backward compatibility.
export const cancelReversalRentPayment = cancelRentPaymentReversal;

// Get payment summary
export const getPaymentSummary = async (business, month = null, year = null) => {
  try {
    let url = `/rent-payments/get/summary?business=${business}`;
    if (month) url += `&month=${month}`;
    if (year) url += `&year=${year}`;

    const res = await adminRequests.get(url);
    return res.data;
  } catch (err) {
    throw err;
  }
};

// Download receipt PDF
export const downloadReceiptPdf = async (paymentId, { preview = false, filename } = {}) => {
  const res = await adminRequests.get(`/rent-payments/${paymentId}/pdf${preview ? "?preview=true" : ""}`, {
    responseType: "blob",
  });
  const blob = new Blob([res.data], { type: "application/pdf" });
  const url = window.URL.createObjectURL(blob);
  if (preview) {
    window.open(url, "_blank");
    setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
  } else {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename || `Receipt-${paymentId}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }
  return true;
};
