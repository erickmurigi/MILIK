import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { adminRequests } from "../utils/requestMethods";

// Thunks
export const getProcessedStatements = createAsyncThunk(
  "processedStatements/getAll",
  async ({ businessId, status, landlord, property, month }, { rejectWithValue }) => {
    try {
      let url = `/processed-statements/business/${businessId}`;
      const params = new URLSearchParams();

      if (status) params.append("status", status);
      if (landlord) params.append("landlord", landlord);
      if (month) params.append("month", month);
      if (property) params.append("property", property);

      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const response = await adminRequests.get(url);
      return response.data.statements || [];
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to fetch statements");
    }
  }
);

export const getStatementById = createAsyncThunk(
  "processedStatements/getById",
  async (statementId, { rejectWithValue }) => {
    try {
      const response = await adminRequests.get(`/processed-statements/detail/${statementId}`);
      return response.data.statement;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to fetch statement");
    }
  }
);

export const closeStatement = createAsyncThunk(
  "processedStatements/close",
  async (statementData, { rejectWithValue }) => {
    try {
      const response = await adminRequests.post("/processed-statements", statementData);
      return response.data.statement;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to close statement");
    }
  }
);

export const updateStatement = createAsyncThunk(
  "processedStatements/update",
  async ({ statementId, updates }, { rejectWithValue }) => {
    try {
      const response = await adminRequests.put(`/processed-statements/${statementId}`, updates);
      return response.data.statement;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to update statement");
    }
  }
);

export const deleteStatement = createAsyncThunk(
  "processedStatements/delete",
  async (statementId, { rejectWithValue }) => {
    try {
      await adminRequests.delete(`/processed-statements/${statementId}`);
      return statementId;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to delete statement");
    }
  }
);


export const reverseStatement = createAsyncThunk(
  "processedStatements/reverse",
  async ({ statementId, reason }, { rejectWithValue }) => {
    try {
      const response = await adminRequests.post(`/processed-statements/${statementId}/reverse`, { reason });
      return response.data.statement;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to reverse statement");
    }
  }
);

export const getStatementStats = createAsyncThunk(
  "processedStatements/stats",
  async (businessId, { rejectWithValue }) => {
    try {
      const response = await adminRequests.get(`/processed-statements/stats/${businessId}`);
      return response.data.stats || [];
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || "Failed to fetch stats");
    }
  }
);

// Slice
const processedStatementsSlice = createSlice({
  name: "processedStatements",
  initialState: {
    statements: [],
    currentStatement: null,
    loading: false,
    error: null,
    stats: [],
  },
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    setCurrentStatement: (state, action) => {
      state.currentStatement = action.payload;
    },
  },
  extraReducers: (builder) => {
    // Get all statements
    builder
      .addCase(getProcessedStatements.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getProcessedStatements.fulfilled, (state, action) => {
        state.loading = false;
        state.statements = action.payload;
      })
      .addCase(getProcessedStatements.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Get single statement
    builder
      .addCase(getStatementById.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getStatementById.fulfilled, (state, action) => {
        state.loading = false;
        state.currentStatement = action.payload;
      })
      .addCase(getStatementById.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Close statement
    builder
      .addCase(closeStatement.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(closeStatement.fulfilled, (state, action) => {
        state.loading = false;
        state.statements = [...state.statements, action.payload];
      })
      .addCase(closeStatement.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Update statement
    builder
      .addCase(updateStatement.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateStatement.fulfilled, (state, action) => {
        state.loading = false;
        const index = state.statements.findIndex((s) => s._id === action.payload._id);
        if (index !== -1) {
          state.statements[index] = action.payload;
        }
        if (state.currentStatement?._id === action.payload._id) {
          state.currentStatement = action.payload;
        }
      })
      .addCase(updateStatement.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });


    // Reverse statement
    builder
      .addCase(reverseStatement.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(reverseStatement.fulfilled, (state, action) => {
        state.loading = false;
        const index = state.statements.findIndex((s) => s._id === action.payload._id);
        if (index !== -1) {
          state.statements[index] = action.payload;
        }
        if (state.currentStatement?._id === action.payload._id) {
          state.currentStatement = action.payload;
        }
      })
      .addCase(reverseStatement.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });


    // Delete statement
    builder
      .addCase(deleteStatement.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteStatement.fulfilled, (state, action) => {
        state.loading = false;
        state.statements = state.statements.filter((s) => s._id !== action.payload);
        if (state.currentStatement?._id === action.payload) {
          state.currentStatement = null;
        }
      })
      .addCase(deleteStatement.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Stats
    builder
      .addCase(getStatementStats.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getStatementStats.fulfilled, (state, action) => {
        state.loading = false;
        state.stats = action.payload;
      })
      .addCase(getStatementStats.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const { clearError, setCurrentStatement } = processedStatementsSlice.actions;
export default processedStatementsSlice.reducer;