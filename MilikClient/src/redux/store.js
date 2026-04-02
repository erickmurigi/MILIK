import { configureStore, combineReducers } from "@reduxjs/toolkit";
import userReducer from "./userRedux";
import authReducer from "./authSlice";
import {
  persistStore,
  persistReducer,
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
  createTransform,
  createMigrate,
} from "redux-persist";
import storage from "redux-persist/lib/storage";

import companiesRedux from "./companiesRedux";
import printerRedux from "./printerRedux";
import requestRedux from "./requestServiceRedux";
import AES from "crypto-js/aes";
import Utf8 from "crypto-js/enc-utf8";

// property reducers
import landlordReducer from "./landlordRedux";
import propertyReducer from "./propertyRedux";
import utilityReducer from "./utilityRedux";
import unitReducer from "./unitRedux";
import tenantReducer from "./tenantsRedux";
import rentPaymentReducer from "./rentPaymentRedux";
import maintenanceReducer from "./maintenanceRedux";
import leaseReducer from "./leasesRedux";
import expensePropertyReducer from "./expensePropertyRedux";
import notificationPropertyReducer from "./notificationPropertyRedux";
import companySettingsReducer from "./companySettingsRedux";
import processedStatementsReducer from "./processedStatementsRedux";
import statementsReducer from "./statementsRedux";
import { RESET_COMPANY_SCOPED_STATE } from "./companyContextActions";

// WARNING: Client-side encryption provides minimal security.
// Sensitive data should never be stored in localStorage.
// Consider using httpOnly cookies for tokens instead.
const secretKey = import.meta.env.VITE_STORAGE_KEY || "MilikPropertyManagement2026";

const encrypt = (inboundState) => AES.encrypt(JSON.stringify(inboundState), secretKey).toString();

const decrypt = (outboundState) => {
  const bytes = AES.decrypt(outboundState, secretKey);
  const value = bytes.toString(Utf8);
  return value ? JSON.parse(value) : undefined;
};

const encryptor = createTransform(
  (inboundState) => encrypt(inboundState),
  (outboundState) => decrypt(outboundState)
);

const buildPersistedCompanyState = (companyState = {}) => ({
  companies: Array.isArray(companyState?.companies) ? companyState.companies : [],
  isFetching: false,
  error: false,
  currentCompany: companyState?.currentCompany || null,
  isSwitching: false,
  switchTargetCompanyId: null,
});

const migrations = {
  3: (state) => {
    if (!state || typeof state !== "object") return state;

    return {
      auth: state.auth || undefined,
      company: buildPersistedCompanyState(state.company),
    };
  },
};

const persistConfig = {
  key: "root",
  version: 3,
  storage,
  transforms: [encryptor],
  whitelist: ["auth", "company"],
  migrate: createMigrate(migrations, { debug: false }),
};

const appReducer = combineReducers({
  auth: authReducer,
  company: companiesRedux,
  user: userReducer,
  printer: printerRedux,
  request: requestRedux,

  // property reducers
  landlord: landlordReducer,
  property: propertyReducer,
  utility: utilityReducer,
  unit: unitReducer,
  tenant: tenantReducer,
  rentPayment: rentPaymentReducer,
  maintenance: maintenanceReducer,
  lease: leaseReducer,
  expenseProperty: expensePropertyReducer,
  notification: notificationPropertyReducer,
  companySettings: companySettingsReducer,
  processedStatements: processedStatementsReducer,
  statements: statementsReducer,
});

const rootReducer = (state, action) => {
  if (action?.type === RESET_COMPANY_SCOPED_STATE && state) {
    const initialState = appReducer(undefined, { type: "@@INIT" });
    return appReducer(
      {
        ...initialState,
        auth: state.auth,
        company: state.company,
      },
      action
    );
  }

  return appReducer(state, action);
};

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
      immutableCheck: false,
    }),
});

export const persistor = persistStore(store);
