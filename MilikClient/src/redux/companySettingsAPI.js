import { adminRequests } from "../utils/requestMethods";
import {
  getSettingsFailure,
  getSettingsStart,
  getSettingsSuccess,
} from "./companySettingsRedux";

const extractErrorMessage = (err) =>
  err?.response?.data?.message || err?.message || "Failed to process company settings request";

const refreshCompanySettings = async (dispatch, businessId) => {
  const res = await adminRequests.get(`/company-settings/${businessId}`);
  dispatch(getSettingsSuccess(res.data));
  return res.data;
};

const runMutation = async (dispatch, businessId, request) => {
  dispatch(getSettingsStart());
  try {
    await request();
    return await refreshCompanySettings(dispatch, businessId);
  } catch (err) {
    dispatch(getSettingsFailure(extractErrorMessage(err)));
    throw err;
  }
};

export const getCompanySettings = async (dispatch, businessId) => {
  dispatch(getSettingsStart());
  try {
    return await refreshCompanySettings(dispatch, businessId);
  } catch (err) {
    dispatch(getSettingsFailure(extractErrorMessage(err)));
    throw err;
  }
};

export const addUtilityType = async (dispatch, businessId, utilityData) =>
  runMutation(dispatch, businessId, () =>
    adminRequests.post(`/company-settings/${businessId}/utilities`, utilityData)
  );

export const updateUtilityType = async (dispatch, businessId, utilityId, utilityData) =>
  runMutation(dispatch, businessId, () =>
    adminRequests.put(`/company-settings/${businessId}/utilities/${utilityId}`, utilityData)
  );

export const deleteUtilityType = async (dispatch, businessId, utilityId) =>
  runMutation(dispatch, businessId, () =>
    adminRequests.delete(`/company-settings/${businessId}/utilities/${utilityId}`)
  );

export const addBillingPeriod = async (dispatch, businessId, periodData) =>
  runMutation(dispatch, businessId, () =>
    adminRequests.post(`/company-settings/${businessId}/periods`, periodData)
  );

export const updateBillingPeriod = async (dispatch, businessId, periodId, periodData) =>
  runMutation(dispatch, businessId, () =>
    adminRequests.put(`/company-settings/${businessId}/periods/${periodId}`, periodData)
  );

export const deleteBillingPeriod = async (dispatch, businessId, periodId) =>
  runMutation(dispatch, businessId, () =>
    adminRequests.delete(`/company-settings/${businessId}/periods/${periodId}`)
  );

export const addCommission = async (dispatch, businessId, commissionData) =>
  runMutation(dispatch, businessId, () =>
    adminRequests.post(`/company-settings/${businessId}/commissions`, commissionData)
  );

export const updateCommission = async (dispatch, businessId, commissionId, commissionData) =>
  runMutation(dispatch, businessId, () =>
    adminRequests.put(`/company-settings/${businessId}/commissions/${commissionId}`, commissionData)
  );

export const deleteCommission = async (dispatch, businessId, commissionId) =>
  runMutation(dispatch, businessId, () =>
    adminRequests.delete(`/company-settings/${businessId}/commissions/${commissionId}`)
  );

export const addExpenseItem = async (dispatch, businessId, expenseData) =>
  runMutation(dispatch, businessId, () =>
    adminRequests.post(`/company-settings/${businessId}/expenses`, expenseData)
  );

export const updateExpenseItem = async (dispatch, businessId, expenseId, expenseData) =>
  runMutation(dispatch, businessId, () =>
    adminRequests.put(`/company-settings/${businessId}/expenses/${expenseId}`, expenseData)
  );

export const deleteExpenseItem = async (dispatch, businessId, expenseId) =>
  runMutation(dispatch, businessId, () =>
    adminRequests.delete(`/company-settings/${businessId}/expenses/${expenseId}`)
  );

export const updateTaxConfiguration = async (dispatch, businessId, payload) =>
  runMutation(dispatch, businessId, () =>
    adminRequests.put(`/company-settings/${businessId}/tax-configuration`, payload)
  );


export const updateAccountingDefaults = async (dispatch, businessId, payload) =>
  runMutation(dispatch, businessId, () =>
    adminRequests.put(`/company-settings/${businessId}/accounting-defaults`, payload)
  );
