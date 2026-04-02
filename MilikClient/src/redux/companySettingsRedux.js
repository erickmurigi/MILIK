import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  companySettings: null,
  isFetching: false,
  error: false,
  errorMessage: "",
};

const companySettingsSlice = createSlice({
  name: "companySettings",
  initialState,
  reducers: {
    // Fetch settings
    getSettingsStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    getSettingsSuccess: (state, action) => {
      state.isFetching = false;
      state.companySettings = action.payload;
    },
    getSettingsFailure: (state, action) => {
      state.isFetching = false;
      state.error = true;
      state.errorMessage = action.payload;
    },

    // Utility Types
    addUtilityStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    addUtilitySuccess: (state, action) => {
      state.isFetching = false;
      if (state.companySettings?.utilityTypes) {
        state.companySettings.utilityTypes.push(action.payload);
      }
    },
    addUtilityFailure: (state, action) => {
      state.isFetching = false;
      state.error = true;
      state.errorMessage = action.payload;
    },

    updateUtilityStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    updateUtilitySuccess: (state, action) => {
      state.isFetching = false;
      if (state.companySettings?.utilityTypes) {
        const index = state.companySettings.utilityTypes.findIndex(
          (u) => u._id === action.payload._id
        );
        if (index !== -1) {
          state.companySettings.utilityTypes[index] = action.payload;
        }
      }
    },
    updateUtilityFailure: (state, action) => {
      state.isFetching = false;
      state.error = true;
      state.errorMessage = action.payload;
    },

    deleteUtilityStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    deleteUtilitySuccess: (state, action) => {
      state.isFetching = false;
      if (state.companySettings?.utilityTypes) {
        state.companySettings.utilityTypes = state.companySettings.utilityTypes.filter(
          (u) => u._id !== action.payload
        );
      }
    },
    deleteUtilityFailure: (state, action) => {
      state.isFetching = false;
      state.error = true;
      state.errorMessage = action.payload;
    },

    // Billing Periods
    addPeriodStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    addPeriodSuccess: (state, action) => {
      state.isFetching = false;
      if (state.companySettings?.billingPeriods) {
        state.companySettings.billingPeriods.push(action.payload);
      }
    },
    addPeriodFailure: (state, action) => {
      state.isFetching = false;
      state.error = true;
      state.errorMessage = action.payload;
    },

    updatePeriodStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    updatePeriodSuccess: (state, action) => {
      state.isFetching = false;
      if (state.companySettings?.billingPeriods) {
        const index = state.companySettings.billingPeriods.findIndex(
          (p) => p._id === action.payload._id
        );
        if (index !== -1) {
          state.companySettings.billingPeriods[index] = action.payload;
        }
      }
    },
    updatePeriodFailure: (state, action) => {
      state.isFetching = false;
      state.error = true;
      state.errorMessage = action.payload;
    },

    deletePeriodStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    deletePeriodSuccess: (state, action) => {
      state.isFetching = false;
      if (state.companySettings?.billingPeriods) {
        state.companySettings.billingPeriods = state.companySettings.billingPeriods.filter(
          (p) => p._id !== action.payload
        );
      }
    },
    deletePeriodFailure: (state, action) => {
      state.isFetching = false;
      state.error = true;
      state.errorMessage = action.payload;
    },

    // Commissions
    addCommissionStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    addCommissionSuccess: (state, action) => {
      state.isFetching = false;
      if (state.companySettings?.commissions) {
        state.companySettings.commissions.push(action.payload);
      }
    },
    addCommissionFailure: (state, action) => {
      state.isFetching = false;
      state.error = true;
      state.errorMessage = action.payload;
    },

    updateCommissionStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    updateCommissionSuccess: (state, action) => {
      state.isFetching = false;
      if (state.companySettings?.commissions) {
        const index = state.companySettings.commissions.findIndex(
          (c) => c._id === action.payload._id
        );
        if (index !== -1) {
          state.companySettings.commissions[index] = action.payload;
        }
      }
    },
    updateCommissionFailure: (state, action) => {
      state.isFetching = false;
      state.error = true;
      state.errorMessage = action.payload;
    },

    deleteCommissionStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    deleteCommissionSuccess: (state, action) => {
      state.isFetching = false;
      if (state.companySettings?.commissions) {
        state.companySettings.commissions = state.companySettings.commissions.filter(
          (c) => c._id !== action.payload
        );
      }
    },
    deleteCommissionFailure: (state, action) => {
      state.isFetching = false;
      state.error = true;
      state.errorMessage = action.payload;
    },

    // Expense Items
    addExpenseStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    addExpenseSuccess: (state, action) => {
      state.isFetching = false;
      if (state.companySettings?.expenseItems) {
        state.companySettings.expenseItems.push(action.payload);
      }
    },
    addExpenseFailure: (state, action) => {
      state.isFetching = false;
      state.error = true;
      state.errorMessage = action.payload;
    },

    updateExpenseStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    updateExpenseSuccess: (state, action) => {
      state.isFetching = false;
      if (state.companySettings?.expenseItems) {
        const index = state.companySettings.expenseItems.findIndex(
          (e) => e._id === action.payload._id
        );
        if (index !== -1) {
          state.companySettings.expenseItems[index] = action.payload;
        }
      }
    },
    updateExpenseFailure: (state, action) => {
      state.isFetching = false;
      state.error = true;
      state.errorMessage = action.payload;
    },

    deleteExpenseStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    deleteExpenseSuccess: (state, action) => {
      state.isFetching = false;
      if (state.companySettings?.expenseItems) {
        state.companySettings.expenseItems = state.companySettings.expenseItems.filter(
          (e) => e._id !== action.payload
        );
      }
    },
    deleteExpenseFailure: (state, action) => {
      state.isFetching = false;
      state.error = true;
      state.errorMessage = action.payload;
    },
  },
});

export const {
  getSettingsStart,
  getSettingsSuccess,
  getSettingsFailure,
  addUtilityStart,
  addUtilitySuccess,
  addUtilityFailure,
  updateUtilityStart,
  updateUtilitySuccess,
  updateUtilityFailure,
  deleteUtilityStart,
  deleteUtilitySuccess,
  deleteUtilityFailure,
  addPeriodStart,
  addPeriodSuccess,
  addPeriodFailure,
  updatePeriodStart,
  updatePeriodSuccess,
  updatePeriodFailure,
  deletePeriodStart,
  deletePeriodSuccess,
  deletePeriodFailure,
  addCommissionStart,
  addCommissionSuccess,
  addCommissionFailure,
  updateCommissionStart,
  updateCommissionSuccess,
  updateCommissionFailure,
  deleteCommissionStart,
  deleteCommissionSuccess,
  deleteCommissionFailure,
  addExpenseStart,
  addExpenseSuccess,
  addExpenseFailure,
  updateExpenseStart,
  updateExpenseSuccess,
  updateExpenseFailure,
  deleteExpenseStart,
  deleteExpenseSuccess,
  deleteExpenseFailure,
} = companySettingsSlice.actions;

export default companySettingsSlice.reducer;
