import { adminRequests } from "../../utils/requestMethods";
import { extractList } from "./shared";

import {
  getExpensePropertiesStart,
  getExpensePropertiesSuccess,
  getExpensePropertiesFailure,
  createExpensePropertyStart,
  createExpensePropertySuccess,
  createExpensePropertyFailure,
  updateExpensePropertyStart,
  updateExpensePropertySuccess,
  updateExpensePropertyFailure,
  deleteExpensePropertyStart,
  deleteExpensePropertySuccess,
  deleteExpensePropertyFailure
} from "../expensePropertyRedux";

// Get all expense properties
export const getExpenseProperties = async (dispatch, business, category = null, property = null, unit = null, startDate = null, endDate = null) => {
  dispatch(getExpensePropertiesStart());
  try {
    let url = `/propertyexpenses?business=${business}`;
    if (category) url += `&category=${category}`;
    if (property) url += `&property=${property}`;
    if (unit) url += `&unit=${unit}`;
    if (startDate) url += `&startDate=${startDate}`;
    if (endDate) url += `&endDate=${endDate}`;

    const res = await adminRequests.get(url);
    dispatch(getExpensePropertiesSuccess(extractList(res.data)));
  } catch (err) {
    dispatch(getExpensePropertiesFailure());
  }
};

// Get single expense property
export const getExpenseProperty = async (dispatch, id) => {
  dispatch(getExpensePropertiesStart());
  try {
    const res = await adminRequests.get(`/propertyexpenses/${id}`);
    dispatch(getExpensePropertiesSuccess([res.data]));
  } catch (err) {
    dispatch(getExpensePropertiesFailure());
  }
};

// Create expense property
export const createExpenseProperty = async (dispatch, expenseData) => {
  dispatch(createExpensePropertyStart());
  try {
    const res = await adminRequests.post("/propertyexpenses", expenseData);
    dispatch(createExpensePropertySuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(createExpensePropertyFailure());
    throw err;
  }
};

// Update expense property
export const updateExpenseProperty = async (dispatch, id, expenseData) => {
  dispatch(updateExpensePropertyStart());
  try {
    const res = await adminRequests.put(`/propertyexpenses/${id}`, expenseData);
    dispatch(updateExpensePropertySuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(updateExpensePropertyFailure());
    throw err;
  }
};

// Delete expense property
export const deleteExpenseProperty = async (dispatch, id) => {
  dispatch(deleteExpensePropertyStart());
  try {
    await adminRequests.delete(`/propertyexpenses/${id}`);
    dispatch(deleteExpensePropertySuccess(id));
    return true;
  } catch (err) {
    dispatch(deleteExpensePropertyFailure());
    throw err;
  }
};

// Get expense summary
export const getExpenseSummary = async (business, startDate = null, endDate = null) => {
  try {
    let url = `/propertyexpenses/get/summary?business=${business}`;
    if (startDate) url += `&startDate=${startDate}`;
    if (endDate) url += `&endDate=${endDate}`;

    const res = await adminRequests.get(url);
    return res.data;
  } catch (err) {
    throw err;
  }
};

// Get property expenses
export const getPropertyExpenses = async (propertyId, business = null, startDate = null, endDate = null) => {
  try {
    let url = `/propertyexpenses/property/${propertyId}`;
    const params = new URLSearchParams();

    if (business) params.append("business", business);
    if (startDate) params.append("startDate", startDate);
    if (endDate) params.append("endDate", endDate);

    const query = params.toString();
    if (query) url += `?${query}`;

    const res = await adminRequests.get(url);
    return res.data;
  } catch (err) {
    throw err;
  }
};
