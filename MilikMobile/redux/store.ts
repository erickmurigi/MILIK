import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/authSlice';
import landlordPortalAuthReducer from './slices/landlordPortalAuthSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    landlordPortalAuth: landlordPortalAuthReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({ serializableCheck: false }),
});

export type RootState   = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
