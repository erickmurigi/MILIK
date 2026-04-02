// ========= COMPANY SETTINGS API CALLS =========

export const getCompanySettings = async (dispatch, businessId) => {
  dispatch(getSettingsStart());
  try {
    const res = await adminRequests.get(`/company-settings/${businessId}`);
    dispatch(getSettingsSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(getSettingsFailure(err.message));
    throw err;
  }
};

// Utility Types
export const addUtilityType = async (dispatch, businessId, utilityData) => {
  dispatch(addUtilityStart());
  try {
    const res = await adminRequests.post(`/company-settings/${businessId}/utilities`, utilityData);
    dispatch(addUtilitySuccess(res.data.utility));
    return res.data.utility;
  } catch (err) {
    dispatch(addUtilityFailure(err.message));
    throw err;
  }
};

export const updateUtilityType = async (dispatch, businessId, utilityId, utilityData) => {
  dispatch(updateUtilitySettingStart());
  try {
    const res = await adminRequests.put(
      `/company-settings/${businessId}/utilities/${utilityId}`,
      utilityData
    );
    dispatch(updateUtilitySettingSuccess(res.data.utility));
    return res.data.utility;
  } catch (err) {
    dispatch(updateUtilitySettingFailure(err.message));
    throw err;
  }
};

export const deleteUtilityType = async (dispatch, businessId, utilityId) => {
  dispatch(deleteUtilitySettingStart());
  try {
    await adminRequests.delete(`/company-settings/${businessId}/utilities/${utilityId}`);
    dispatch(deleteUtilitySettingSuccess(utilityId));
  } catch (err) {
    dispatch(deleteUtilitySettingFailure(err.message));
    throw err;
  }
};

// Billing Periods
export const addBillingPeriod = async (dispatch, businessId, periodData) => {
  dispatch(addPeriodStart());
  try {
    const res = await adminRequests.post(`/company-settings/${businessId}/periods`, periodData);
    dispatch(addPeriodSuccess(res.data.period));
    return res.data.period;
  } catch (err) {
    dispatch(addPeriodFailure(err.message));
    throw err;
  }
};

export const updateBillingPeriod = async (dispatch, businessId, periodId, periodData) => {
  dispatch(updatePeriodStart());
  try {
    const res = await adminRequests.put(
      `/company-settings/${businessId}/periods/${periodId}`,
      periodData
    );
    dispatch(updatePeriodSuccess(res.data.period));
    return res.data.period;
  } catch (err) {
    dispatch(updatePeriodFailure(err.message));
    throw err;
  }
};

export const deleteBillingPeriod = async (dispatch, businessId, periodId) => {
  dispatch(deletePeriodStart());
  try {
    await adminRequests.delete(`/company-settings/${businessId}/periods/${periodId}`);
    dispatch(deletePeriodSuccess(periodId));
  } catch (err) {
    dispatch(deletePeriodFailure(err.message));
    throw err;
  }
};

// Commissions
export const addCommission = async (dispatch, businessId, commissionData) => {
  dispatch(addCommissionStart());
  try {
    const res = await adminRequests.post(
      `/company-settings/${businessId}/commissions`,
      commissionData
    );
    dispatch(addCommissionSuccess(res.data.commission));
    return res.data.commission;
  } catch (err) {
    dispatch(addCommissionFailure(err.message));
    throw err;
  }
};

export const updateCommission = async (dispatch, businessId, commissionId, commissionData) => {
  dispatch(updateCommissionStart());
  try {
    const res = await adminRequests.put(
      `/company-settings/${businessId}/commissions/${commissionId}`,
      commissionData
    );
    dispatch(updateCommissionSuccess(res.data.commission));
    return res.data.commission;
  } catch (err) {
    dispatch(updateCommissionFailure(err.message));
    throw err;
  }
};

export const deleteCommission = async (dispatch, businessId, commissionId) => {
  dispatch(deleteCommissionStart());
  try {
    await adminRequests.delete(
      `/company-settings/${businessId}/commissions/${commissionId}`
    );
    dispatch(deleteCommissionSuccess(commissionId));
  } catch (err) {
    dispatch(deleteCommissionFailure(err.message));
    throw err;
  }
};

// Expense Items
export const addExpenseItem = async (dispatch, businessId, expenseData) => {
  dispatch(addExpenseStart());
  try {
    const res = await adminRequests.post(
      `/company-settings/${businessId}/expenses`,
      expenseData
    );
    dispatch(addExpenseSuccess(res.data.expenseItem));
    return res.data.expenseItem;
  } catch (err) {
    dispatch(addExpenseFailure(err.message));
    throw err;
  }
};

export const updateExpenseItem = async (dispatch, businessId, expenseId, expenseData) => {
  dispatch(updateExpenseStart());
  try {
    const res = await adminRequests.put(
      `/company-settings/${businessId}/expenses/${expenseId}`,
      expenseData
    );
    dispatch(updateExpenseSuccess(res.data.expenseItem));
    return res.data.expenseItem;
  } catch (err) {
    dispatch(updateExpenseFailure(err.message));
    throw err;
  }
};

export const deleteExpenseItem = async (dispatch, businessId, expenseId) => {
  dispatch(deleteExpenseStart());
  try {
    await adminRequests.delete(`/company-settings/${businessId}/expenses/${expenseId}`);
    dispatch(deleteExpenseSuccess(expenseId));
  } catch (err) {
    dispatch(deleteExpenseFailure(err.message));
    throw err;
  }
};
