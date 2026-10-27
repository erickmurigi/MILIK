import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface AuthState {
  token:   string | null;
  user:    Record<string, any> | null;
  company: Record<string, any> | null;
  loading: boolean;
}

const initialState: AuthState = {
  token:   null,
  user:    null,
  company: null,
  loading: true,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials(state, action: PayloadAction<{ token: string; user: any; company: any }>) {
      state.token   = action.payload.token;
      state.user    = action.payload.user;
      state.company = action.payload.company;
      state.loading = false;
    },
    clearCredentials(state) {
      state.token   = null;
      state.user    = null;
      state.company = null;
      state.loading = false;
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    // Silent token refresh updates only the token — /auth/refresh's response carries the
    // raw decoded JWT payload (id/email/role/company/exp/...), not the full user profile
    // object login returns, so overwriting state.user with it here would quietly drop
    // profile fields the rest of the app relies on.
    setToken(state, action: PayloadAction<string>) {
      state.token = action.payload;
    },
  },
});

export const { setCredentials, clearCredentials, setLoading, setToken } = authSlice.actions;
export default authSlice.reducer;
