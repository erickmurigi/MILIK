// redux/unitSlice.js
import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { adminRequests } from "../utils/requestMethods";

// Async thunks for API calls
export const createUnit = createAsyncThunk(
  'unit/create',
  async (unitData, { rejectWithValue }) => {
    try {
      const response = await adminRequests.post("/units", unitData);
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data || { message: error.message });
    }
  }
);

export const getUnits = createAsyncThunk(
  'unit/getAll',
  async (params, { rejectWithValue }) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const response = await adminRequests.get(`/units?${queryString}`);
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data || { message: error.message });
    }
  }
);

export const updateUnit = createAsyncThunk(
  'unit/update',
  async ({ id, unitData }, { rejectWithValue }) => {
    try {
      const response = await adminRequests.put(`/units/${id}`, unitData);
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data || { message: error.message });
    }
  }
);

export const deleteUnit = createAsyncThunk(
  'unit/delete',
  async (id, { rejectWithValue }) => {
    try {
      await adminRequests.delete(`/units/${id}`);
      return id;
    } catch (error) {
      return rejectWithValue(error.response?.data || { message: error.message });
    }
  }
);

const initialState = {
  units: [],
  isFetching: false,
  error: false,
};

export const unitSlice = createSlice({
  name: "unit",
  initialState,
  reducers: {
    // Get all units
    getUnitsStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    getUnitsSuccess: (state, action) => {
      state.isFetching = false;
      state.units = Array.isArray(action.payload) ? action.payload : [];
    },
    getUnitsFailure: (state) => {
      state.isFetching = false;
      state.error = true;
    },

    // Create unit
    createUnitStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    createUnitSuccess: (state, action) => {
      state.isFetching = false;
      state.units.push(action.payload);
    },
    createUnitFailure: (state) => {
      state.isFetching = false;
      state.error = true;
    },

    // Update unit
    updateUnitStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    updateUnitSuccess: (state, action) => {
      state.isFetching = false;
      const index = state.units.findIndex((item) => item._id === action.payload?._id);
      if (index !== -1) state.units[index] = action.payload;
    },
    updateUnitFailure: (state) => {
      state.isFetching = false;
      state.error = true;
    },

    // Delete unit
    deleteUnitStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    deleteUnitSuccess: (state, action) => {
      state.isFetching = false;
      const idx = state.units.findIndex((item) => item._id === action.payload);
      if (idx !== -1) state.units.splice(idx, 1);
    },
    deleteUnitFailure: (state) => {
      state.isFetching = false;
      state.error = true;
    },

    // Update unit status (single)
    updateUnitStatusStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    updateUnitStatusSuccess: (state, action) => {
      state.isFetching = false;
      const index = state.units.findIndex((item) => item._id === action.payload?._id);
      if (index !== -1) state.units[index] = action.payload;
    },
    updateUnitStatusFailure: (state) => {
      state.isFetching = false;
      state.error = true;
    },

    // ✅ Archive units (bulk)
    archiveUnitsStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    archiveUnitsSuccess: (state, action) => {
      state.isFetching = false;
      const ids = Array.isArray(action.payload) ? action.payload : [];
      state.units = state.units.map((u) =>
        ids.includes(u._id) ? { ...u, status: "Archived" } : u
      );
    },
    archiveUnitsFailure: (state) => {
      state.isFetching = false;
      state.error = true;
    },

    // ✅ Restore units (bulk)
    restoreUnitsStart: (state) => {
      state.isFetching = true;
      state.error = false;
    },
    restoreUnitsSuccess: (state, action) => {
      state.isFetching = false;
      const ids = Array.isArray(action.payload) ? action.payload : [];
      state.units = state.units.map((u) =>
        ids.includes(u._id) ? { ...u, status: "Active" } : u
      );
    },
    restoreUnitsFailure: (state) => {
      state.isFetching = false;
      state.error = true;
    },
  },
  extraReducers: (builder) => {
    builder
      // Create unit
      .addCase(createUnit.pending, (state) => {
        state.isFetching = true;
        state.error = false;
      })
      .addCase(createUnit.fulfilled, (state, action) => {
        state.isFetching = false;
        state.units.push(action.payload);
      })
      .addCase(createUnit.rejected, (state) => {
        state.isFetching = false;
        state.error = true;
      })
      // Get units
      .addCase(getUnits.pending, (state) => {
        state.isFetching = true;
        state.error = false;
      })
      .addCase(getUnits.fulfilled, (state, action) => {
        state.isFetching = false;
        state.units = Array.isArray(action.payload) ? action.payload : [];
      })
      .addCase(getUnits.rejected, (state) => {
        state.isFetching = false;
        state.error = true;
      })
      // Update unit
      .addCase(updateUnit.pending, (state) => {
        state.isFetching = true;
        state.error = false;
      })
      .addCase(updateUnit.fulfilled, (state, action) => {
        state.isFetching = false;
        const index = state.units.findIndex((item) => item._id === action.payload?._id);
        if (index !== -1) state.units[index] = action.payload;
      })
      .addCase(updateUnit.rejected, (state) => {
        state.isFetching = false;
        state.error = true;
      })
      // Delete unit
      .addCase(deleteUnit.pending, (state) => {
        state.isFetching = true;
        state.error = false;
      })
      .addCase(deleteUnit.fulfilled, (state, action) => {
        state.isFetching = false;
        state.units = state.units.filter((item) => item._id !== action.payload);
      })
      .addCase(deleteUnit.rejected, (state) => {
        state.isFetching = false;
        state.error = true;
      });
  },
});

export const {
  getUnitsStart,
  getUnitsSuccess,
  getUnitsFailure,

  createUnitStart,
  createUnitSuccess,
  createUnitFailure,

  updateUnitStart,
  updateUnitSuccess,
  updateUnitFailure,

  deleteUnitStart,
  deleteUnitSuccess,
  deleteUnitFailure,

  updateUnitStatusStart,
  updateUnitStatusSuccess,
  updateUnitStatusFailure,

  archiveUnitsStart,
  archiveUnitsSuccess,
  archiveUnitsFailure,

  restoreUnitsStart,
  restoreUnitsSuccess,
  restoreUnitsFailure,
} = unitSlice.actions;

export default unitSlice.reducer;