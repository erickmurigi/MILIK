import { createSlice } from '@reduxjs/toolkit';

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
      state.currentUser = action.payload.user;
      state.token = action.payload.token;
      state.isLoggedIn = true;
      state.error = false;
      // Also sync to localStorage for interceptor fallback
      localStorage.setItem('milik_token', action.payload.token);
      localStorage.setItem('milik_user', JSON.stringify(action.payload.user));
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
      state.currentUser = action.payload;
      state.error = false;
      // Sync to localStorage
      localStorage.setItem('milik_user', JSON.stringify(action.payload));
    },
    getCurrentUserFailure: (state) => {
      state.isFetching = false;
      state.error = true;
    },

    // Set token (from localStorage on app boot)
    setToken: (state, action) => {
      state.token = action.payload;
    },

    // Initialize auth from localStorage
    initializeAuth: (state, action) => {
      state.currentUser = action.payload.user;
      state.token = action.payload.token;
      state.isLoggedIn = !!action.payload.token;
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
  initializeAuth,
  clearAuth,
} = authSlice.actions;

export default authSlice.reducer;
