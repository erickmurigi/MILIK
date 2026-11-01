import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface LandlordPortalAuthState {
  token:    string | null;
  landlord: Record<string, any> | null;
  company:  Record<string, any> | null;
  loading:  boolean;
}

const initialState: LandlordPortalAuthState = {
  token:    null,
  landlord: null,
  company:  null,
  loading:  true,
};

const landlordPortalAuthSlice = createSlice({
  name: 'landlordPortalAuth',
  initialState,
  reducers: {
    setLandlordPortalCredentials(state, action: PayloadAction<{ token: string; landlord: any; company: any }>) {
      state.token    = action.payload.token;
      state.landlord = action.payload.landlord;
      state.company  = action.payload.company;
      state.loading  = false;
    },
    clearLandlordPortalCredentials(state) {
      state.token    = null;
      state.landlord = null;
      state.company  = null;
      state.loading  = false;
    },
    setLandlordPortalLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
  },
});

export const { setLandlordPortalCredentials, clearLandlordPortalCredentials, setLandlordPortalLoading } = landlordPortalAuthSlice.actions;
export default landlordPortalAuthSlice.reducer;
