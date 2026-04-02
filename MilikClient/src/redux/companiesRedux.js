// companiesRedux.js
import { createSlice } from '@reduxjs/toolkit';

export const companySlice = createSlice({
  name: 'company',
  initialState: {
    companies: [],
    isFetching: false,
    error: false,
    currentCompany: null,
    isSwitching: false,
    switchTargetCompanyId: null,
  },
  reducers: {
    // GET all
    getCompaniesStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    getCompaniesSuccess: (state, action) => {
      state.isFetching = false;
      state.companies = Array.isArray(action.payload) ? action.payload : [];
      state.error = false;
    },
    getCompaniesFailure: (state) => {
      state.isFetching = false;
      state.error = true;
    },
    // GET single / set current
    getCompanyStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    getCompanySuccess: (state, action) => {
      state.isFetching = false;
      state.currentCompany = action.payload || null;
      state.error = false;
    },
    getCompanyFailure: (state) => {
      state.isFetching = false;
      state.error = true;
    },
    setCurrentCompany: (state, action) => {
      state.currentCompany = action.payload || null;
      state.error = false;
    },
    clearCurrentCompany: (state) => {
      state.currentCompany = null;
      state.error = false;
    },
    clearCompanyState: (state) => {
      state.companies = [];
      state.currentCompany = null;
      state.isFetching = false;
      state.error = false;
      state.isSwitching = false;
      state.switchTargetCompanyId = null;
    },
    startCompanySwitch: (state, action) => {
      state.isSwitching = true;
      state.error = false;
      state.switchTargetCompanyId = action.payload || null;
    },
    finishCompanySwitch: (state) => {
      state.isSwitching = false;
      state.switchTargetCompanyId = null;
      state.error = false;
    },
    failCompanySwitch: (state) => {
      state.isSwitching = false;
      state.switchTargetCompanyId = null;
      state.error = true;
    },
    // CREATE
    createCompanyStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    createCompanySuccess: (state, action) => {
      state.isFetching = false;
      if (!Array.isArray(state.companies)) {
        state.companies = [];
      }
      state.companies.push(action.payload);
      state.error = false;
    },
    createCompanyFailure: (state) => {
      state.isFetching = false;
      state.error = true;
    },
    // UPDATE
    updateCompanyStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    updateCompanySuccess: (state, action) => {
      state.isFetching = false;
      const { id, company } = action.payload;
      const index = state.companies.findIndex((item) => item._id === id);
      if (index !== -1) {
        state.companies[index] = { ...state.companies[index], ...company };
      }
      if (state.currentCompany?._id === id) {
        state.currentCompany = { ...state.currentCompany, ...company };
      }
      state.error = false;
    },
    updateCompanyFailure: (state) => {
      state.isFetching = false;
      state.error = true;
    },
    // DELETE
    deleteCompanyStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    deleteCompanySuccess: (state, action) => {
      state.isFetching = false;
      state.companies = state.companies.filter((item) => item._id !== action.payload);
      if (state.currentCompany?._id === action.payload) {
        state.currentCompany = null;
      }
      state.error = false;
    },
    deleteCompanyFailure: (state) => {
      state.isFetching = false;
      state.error = true;
    },
  },
});

export const {
  getCompaniesStart,
  getCompaniesSuccess,
  getCompaniesFailure,
  getCompanyStart,
  getCompanySuccess,
  getCompanyFailure,
  setCurrentCompany,
  clearCurrentCompany,
  clearCompanyState,
  startCompanySwitch,
  finishCompanySwitch,
  failCompanySwitch,
  createCompanyStart,
  createCompanySuccess,
  createCompanyFailure,
  updateCompanyStart,
  updateCompanySuccess,
  updateCompanyFailure,
  deleteCompanyStart,
  deleteCompanySuccess,
  deleteCompanyFailure,
} = companySlice.actions;

export default companySlice.reducer;
