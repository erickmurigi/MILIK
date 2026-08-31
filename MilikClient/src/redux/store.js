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
  createMigrate,
} from "redux-persist";
import storage from "redux-persist/lib/storage";

import companiesRedux from "./companiesRedux";
import printerRedux from "./printerRedux";
import requestRedux from "./requestServiceRedux";

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
import { normalizeCompanyCollection, normalizeCompanyEntity } from "../utils/companyModules";

const normalizePersistedUserCompanyContext = (user = null) => {
  if (!user || typeof user !== "object") return user;

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

const buildPersistedCompanyState = (companyState = {}) => ({
  companies: normalizeCompanyCollection(companyState?.companies),
  isFetching: false,
  error: false,
  currentCompany: normalizeCompanyEntity(companyState?.currentCompany) || null,
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
  4: (state) => {
    if (!state || typeof state !== "object") return state;

    return {
      auth: state.auth
        ? {
            ...state.auth,
            currentUser: normalizePersistedUserCompanyContext(state.auth.currentUser),
          }
        : undefined,
      company: buildPersistedCompanyState(state.company),
    };
  },
  5: (state) => {
    // Added companySettings to whitelist; existing persisted state won't have it — initialize to null
    if (!state || typeof state !== "object") return state;
    return {
      ...state,
      companySettings: state.companySettings ?? { companySettings: null, isFetching: false, error: false, errorMessage: "" },
    };
  },
};

const persistConfig = {
  key: "root",
  version: 5,
  storage,
  whitelist: ["auth", "company", "companySettings"],
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
      immutableCheck: process.env.NODE_ENV === "development",
    }),
});

export const persistor = persistStore(store);
