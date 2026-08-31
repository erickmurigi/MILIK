import { createSlice } from '@reduxjs/toolkit';
import { normalizeCompanyCollection, normalizeCompanyEntity } from '../utils/companyModules';
import { markSessionActivity } from '../utils/sessionTimeout';

const normalizeUserCompanyContext = (user = null) => {
  if (!user || typeof user !== 'object') return user;

  return {
    ...user,
    company: normalizeCompanyEntity(user.company),
    primaryCompany: normalizeCompanyEntity(user.primaryCompany),
    accessibleCompanies: normalizeCompanyCollection(user.accessibleCompanies),
    companyAssignments: Array.isArray(user.companyAssignments)
      ? user.companyAssignments.map((assignment) => ({
          ...assignment,
          company: normalizeCompanyEntity(assignment?.company),
        }))
      : [],
  };
};

const initialState = {
  currentUser: null,
  isFetching: false,
  error: false,
  token: null,
  isLoggedIn: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    // Login
    loginStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    loginSuccess: (state, action) => {
      state.isFetching = false;
      state.currentUser = normalizeUserCompanyContext(action.payload.user);
      state.token = action.payload.token;
      state.isLoggedIn = true;
      state.error = false;
      // Also sync to localStorage for interceptor fallback
      localStorage.setItem('milik_token', action.payload.token);
      localStorage.setItem('milik_user', JSON.stringify(state.currentUser));
      markSessionActivity();
    },
    loginFailure: (state) => {
      state.isFetching = false;
      state.error = true;
      state.isLoggedIn = false;
    },

    // Logout
    logoutStart: (state) => {
      state.isFetching = true;
    },
    logoutSuccess: (state) => {
      state.isFetching = false;
      state.currentUser = null;
      state.token = null;
      state.isLoggedIn = false;
      state.error = false;
      // Clear localStorage
      localStorage.removeItem('milik_token');
      localStorage.removeItem('milik_user');
    },
    logoutFailure: (state) => {
      state.isFetching = false;
      state.error = true;
    },

    // Get current user
    getCurrentUserStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    getCurrentUserSuccess: (state, action) => {
      state.isFetching = false;
      state.currentUser = normalizeUserCompanyContext(action.payload);
      state.error = false;
      // Sync to localStorage
      localStorage.setItem('milik_user', JSON.stringify(state.currentUser));
    },
    getCurrentUserFailure: (state) => {
      state.isFetching = false;
      state.error = true;
    },

    // Set token (from localStorage on app boot)
    setToken: (state, action) => {
      state.token = action.payload;
    },

    // Silently update token after a background refresh
    tokenRefreshed: (state, action) => {
      state.token = action.payload;
      localStorage.setItem('milik_token', action.payload);
    },

    // Initialize auth from localStorage
    initializeAuth: (state, action) => {
      state.currentUser = normalizeUserCompanyContext(action.payload.user);
      state.token = action.payload.token;
      state.isLoggedIn = !!action.payload.token;
      if (state.isLoggedIn) markSessionActivity();
    },

    // Clear auth on error
    clearAuth: (state) => {
      state.currentUser = null;
      state.token = null;
      state.isLoggedIn = false;
      state.error = false;
      localStorage.removeItem('milik_token');
      localStorage.removeItem('milik_user');
    },
  },
});

export const {
  loginStart,
  loginSuccess,
  loginFailure,
  logoutStart,
  logoutSuccess,
  logoutFailure,
  getCurrentUserStart,
  getCurrentUserSuccess,
  getCurrentUserFailure,
  setToken,
  tokenRefreshed,
  initializeAuth,
  clearAuth,
} = authSlice.actions;

export default authSlice.reducer;
