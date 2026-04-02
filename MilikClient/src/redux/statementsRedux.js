import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  statements: [],
  loading: false,
  error: null,
  selectedStatement: null,
  statementLines: [],
  filters: {
    landlordId: null,
    propertyId: null,
    status: null,
  },
};

const statementsSlice = createSlice({
  name: "statements",
  initialState,
  reducers: {
    // Get all statements
    getStatementsStart: (state) => {
      state.loading = true;
      state.error = null;
    },
    getStatementsSuccess: (state, action) => {
      state.loading = false;
      state.statements = action.payload;
    },
    getStatementsFailure: (state, action) => {
      state.loading = false;
      state.error = action.payload;
    },

    // Get single statement
    getStatementStart: (state) => {
      state.loading = true;
      state.error = null;
    },
    getStatementSuccess: (state, action) => {
      state.loading = false;
      state.selectedStatement = action.payload.statement;
      state.statementLines = action.payload.lines || [];
    },
    getStatementFailure: (state, action) => {
      state.loading = false;
      state.error = action.payload;
    },

    // Create draft statement
    createDraftStart: (state) => {
      state.loading = true;
      state.error = null;
    },
    createDraftSuccess: (state, action) => {
      state.loading = false;
      if (!action.payload?._id) return;
      const existingIndex = state.statements.findIndex(
        (s) => s._id === action.payload._id
      );
      if (existingIndex > -1) {
        state.statements[existingIndex] = action.payload;
      } else {
        state.statements.push(action.payload);
      }
    },
    createDraftFailure: (state, action) => {
      state.loading = false;
      state.error = action.payload;
    },

    // Approve statement
    approveStart: (state) => {
      state.loading = true;
      state.error = null;
    },
    approveSuccess: (state, action) => {
      state.loading = false;
      if (!action.payload?._id) return;
      const index = state.statements.findIndex(
        (s) => s._id === action.payload._id
      );
      if (index > -1) {
        state.statements[index] = action.payload;
      }
      if (state.selectedStatement?._id === action.payload._id) {
        state.selectedStatement = action.payload;
      }
    },
    approveFailure: (state, action) => {
      state.loading = false;
      state.error = action.payload;
    },

    // Send statement
    sendStart: (state) => {
      state.loading = true;
      state.error = null;
    },
    sendSuccess: (state, action) => {
      state.loading = false;
      if (!action.payload?._id) return;
      const index = state.statements.findIndex(
        (s) => s._id === action.payload._id
      );
      if (index > -1) {
        state.statements[index] = action.payload;
      }
      if (state.selectedStatement?._id === action.payload._id) {
        state.selectedStatement = action.payload;
      }
    },
    sendFailure: (state, action) => {
      state.loading = false;
      state.error = action.payload;
    },

    // Create revision
    createRevisionStart: (state) => {
      state.loading = true;
      state.error = null;
    },
    createRevisionSuccess: (state, action) => {
      state.loading = false;
      if (!action.payload?.newStatement?._id || !action.payload?.originalStatement?._id) return;
      // Mark original as revised
      const originalIndex = state.statements.findIndex(
        (s) => s._id === action.payload.originalStatement._id
      );
      if (originalIndex > -1) {
        state.statements[originalIndex] = action.payload.originalStatement;
      }
      // Add new revision
      state.statements.push(action.payload.newStatement);
    },
    createRevisionFailure: (state, action) => {
      state.loading = false;
      state.error = action.payload;
    },

    // Delete draft
    deleteDraftStart: (state) => {
      state.loading = true;
      state.error = null;
    },
    deleteDraftSuccess: (state, action) => {
      state.loading = false;
      state.statements = state.statements.filter(
        (s) => s._id !== action.payload
      );
      if (state.selectedStatement?._id === action.payload) {
        state.selectedStatement = null;
        state.statementLines = [];
      }
    },
    deleteDraftFailure: (state, action) => {
      state.loading = false;
      state.error = action.payload;
    },

    // Validate audit
    validateAuditStart: (state) => {
      state.loading = true;
      state.error = null;
    },
    validateAuditSuccess: (state) => {
      state.loading = false;
      state.error = null;
    },
    validateAuditFailure: (state, action) => {
      state.loading = false;
      state.error = action.payload;
    },

    // Set filters
    setFilters: (state, action) => {
      state.filters = { ...state.filters, ...action.payload };
    },

    // Clear error
    clearError: (state) => {
      state.error = null;
    },

    // Clear selected statement
    clearSelectedStatement: (state) => {
      state.selectedStatement = null;
      state.statementLines = [];
    },
  },
});

export const {
  getStatementsStart,
  getStatementsSuccess,
  getStatementsFailure,
  getStatementStart,
  getStatementSuccess,
  getStatementFailure,
  createDraftStart,
  createDraftSuccess,
  createDraftFailure,
  approveStart,
  approveSuccess,
  approveFailure,
  sendStart,
  sendSuccess,
  sendFailure,
  createRevisionStart,
  createRevisionSuccess,
  createRevisionFailure,
  deleteDraftStart,
  deleteDraftSuccess,
  deleteDraftFailure,
  validateAuditStart,
  validateAuditSuccess,
  validateAuditFailure,
  setFilters,
  clearError,
  clearSelectedStatement,
} = statementsSlice.actions;

export default statementsSlice.reducer;
