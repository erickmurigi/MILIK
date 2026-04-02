import { createSlice } from "@reduxjs/toolkit";

export const userSlice = createSlice({
  name: "user",
  initialState: {
    users: [],
    isFetching: false,
    error: false,
    currentUser: null,
  },
  reducers: {
    // Get all users
    getUsersStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    getUsersSuccess: (state, action) => {
      state.isFetching = false;
      state.users = action.payload;
    },
    getUsersFailure: (state) => {
      state.isFetching = false;
      state.error = true;
    },

    // Get single user
    getUserStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    getUserSuccess: (state, action) => {
      state.isFetching = false;
      state.currentUser = action.payload;
    },
    getUserFailure: (state) => {
      state.isFetching = false;
      state.error = true;
    },

    // Create user
    createUserStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    createUserSuccess: (state, action) => {
      state.isFetching = false;
      state.users.push(action.payload);
    },
    createUserFailure: (state) => {
      state.isFetching = false;
      state.error = true;
    },

    // Update user
    updateUserStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    updateUserSuccess: (state, action) => {
      state.isFetching = false;
      const { id, user } = action.payload;
      const index = state.users.findIndex((item) => item._id === id);
      if (index !== -1) {
        state.users[index] = { ...state.users[index], ...user };
      }
    },
    updateUserFailure: (state) => {
      state.isFetching = false;
      state.error = true;
    },

    // Delete user
    deleteUserStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    deleteUserSuccess: (state, action) => {
      state.isFetching = false;
      state.users = state.users.filter((item) => item._id !== action.payload);
    },
    deleteUserFailure: (state) => {
      state.isFetching = false;
      state.error = true;
    },

    // Toggle lock status
    toggleUserLockStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    toggleUserLockSuccess: (state, action) => {
      state.isFetching = false;
      const { id, locked } = action.payload;
      const index = state.users.findIndex((item) => item._id === id);
      if (index !== -1) {
        state.users[index].locked = locked;
      }
    },
    toggleUserLockFailure: (state) => {
      state.isFetching = false;
      state.error = true;
    },
  },
});

export const {
  getUsersStart,
  getUsersSuccess,
  getUsersFailure,
  getUserStart,
  getUserSuccess,
  getUserFailure,
  createUserStart,
  createUserSuccess,
  createUserFailure,
  updateUserStart,
  updateUserSuccess,
  updateUserFailure,
  deleteUserStart,
  deleteUserSuccess,
  deleteUserFailure,
  toggleUserLockStart,
  toggleUserLockSuccess,
  toggleUserLockFailure,
} = userSlice.actions;

export default userSlice.reducer;