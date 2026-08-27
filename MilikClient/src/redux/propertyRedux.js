// redux/propertySlice.js
import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { adminRequests } from "../utils/requestMethods";

// Async thunks using createAsyncThunk
export const getProperties = createAsyncThunk(
  'property/getProperties',
  async (params = {}, { getState, rejectWithValue }) => {
    try {
      const state = getState();

      // For non-paginated property lookups across pages, request a high limit
      // so callers don't silently get backend default pagination (limit=10).
      const normalizedParams = { ...(params || {}) };
      if (normalizedParams.limit === undefined && normalizedParams.page === undefined) {
        normalizedParams.limit = 1000;
      }

      // Resolve business from params or current company slice
      const resolvedBusinessId = normalizedParams.business || state.company?.currentCompany?._id;

      // Build query params safely (never send "undefined")
      const queryParams = new URLSearchParams();
      Object.entries(normalizedParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          queryParams.append(key, value);
        }
      });
      if (resolvedBusinessId) {
        queryParams.set('business', resolvedBusinessId);
      }

      const response = await adminRequests.get(
        `/properties${queryParams.toString() ? `?${queryParams.toString()}` : ''}`
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch properties');
    }
  }
);

export const createProperty = createAsyncThunk(
  'property/createProperty',
  async (propertyData, { getState, rejectWithValue }) => {
    try {
      const state = getState();

      const resolvedBusinessId = propertyData.business || state.company?.currentCompany?._id;
      if (!resolvedBusinessId) {
        return rejectWithValue('Please select a company before creating a property.');
      }

      const dataWithContext = {
        ...propertyData,
        business: resolvedBusinessId,
        createdBy: state.auth?.currentUser?._id,
        updatedBy: state.auth?.currentUser?._id
      };

      const response = await adminRequests.post('/properties', dataWithContext);
      return response.data;
    } catch (error) {
      let errorMessage = 'Failed to create property';
      const validationErrors = Array.isArray(error.response?.data?.errors)
        ? error.response.data.errors
        : [];

      if (validationErrors.length > 0) {
        errorMessage = validationErrors
          .map((item) => item?.message)
          .filter(Boolean)
          .join('; ') || errorMessage;
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.response?.status === 500) {
        errorMessage = 'Server error. Please try again.';
      } else if (error.message) {
        errorMessage = error.message;
      }

      return rejectWithValue(errorMessage);
    }
  }
);

export const updateProperty = createAsyncThunk(
  'property/updateProperty',
  async ({ id, propertyData }, { getState, rejectWithValue }) => {
    try {
      const state = getState();

      const currentUserId = state.auth?.currentUser?._id || state.auth?.currentUser?.id;
      const isValidObjectId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);

      // Add updatedBy only when it is a real ObjectId.
      // Some sessions expose a username-like value such as "milik-admin", which must not be sent
      // into Mongo ObjectId fields.
      const dataWithContext = {
        ...propertyData,
        ...(isValidObjectId(currentUserId) ? { updatedBy: currentUserId } : {})
      };

      const response = await adminRequests.put(`/properties/${id}`, dataWithContext);
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to update property');
    }
  }
);

export const deleteProperty = createAsyncThunk(
  'property/deleteProperty',
  async (id, { rejectWithValue }) => {
    try {
      const response = await adminRequests.delete(`/properties/${id}`);
      return {
        id,
        message: response.data?.message || 'Property deletion request completed',
        mode: response.data?.mode || 'deleted',
        data: response.data?.data || {},
      };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to delete property');
    }
  }
);

export const archiveProperty = createAsyncThunk(
  'property/archiveProperty',
  async (id, { getState, rejectWithValue }) => {
    try {
      const state = getState();

      const response = await adminRequests.put(`/properties/${id}`, {
        status: 'archived',
        updatedBy: state.auth?.currentUser?._id
      });
      return { id, message: response.data.message };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to archive property');
    }
  }
);

export const restoreProperty = createAsyncThunk(
  'property/restoreProperty',
  async (id, { getState, rejectWithValue }) => {
    try {
      const state = getState();

      const response = await adminRequests.put(`/properties/${id}`, {
        status: 'active',
        updatedBy: state.auth?.currentUser?._id
      });
      return { id, message: response.data.message };
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to restore property');
    }
  }
);

export const getPropertyById = createAsyncThunk(
  'property/getPropertyById',
  async (id, { rejectWithValue }) => {
    try {
      const response = await adminRequests.get(`/properties/${id}`);
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch property');
    }
  }
);

const propertySlice = createSlice({
  name: "property",
  initialState: {
    properties: [],
    currentProperty: null,
    pagination: {
      total: 0,
      page: 1,
      pages: 1,
      limit: 10
    },
    loadedFor: null,
    loadedAt: 0,
    loading: false,
    error: null,
    success: false
  },
  reducers: {
    clearError: (state) => {
      state.error = null;
      state.success = false;
    },
    clearCurrentProperty: (state) => {
      state.currentProperty = null;
    },
    resetPropertyState: (state) => {
      state.properties = [];
      state.currentProperty = null;
      state.pagination = { total: 0, page: 1, pages: 1, limit: 10 };
      state.loadedFor = null;
      state.loadedAt = 0;
      state.loading = false;
      state.error = null;
      state.success = false;
    }
  },
  extraReducers: (builder) => {
    builder
      // Get Properties
      .addCase(getProperties.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getProperties.fulfilled, (state, action) => {
        state.loading = false;
        state.properties = action.payload.data || action.payload;
        state.pagination = action.payload.pagination || {
          total: action.payload.length || 0,
          page: 1,
          pages: 1,
          limit: 50
        };
        state.loadedFor = String(action.meta.arg?.business || '');
        state.loadedAt  = Date.now();
      })
      .addCase(getProperties.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // Create Property
      .addCase(createProperty.pending, (state) => {
        state.loading = true;
        state.error = null;
        state.success = false;
      })
      .addCase(createProperty.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        // Handle both { data: property } and direct property object responses
        const property = action.payload?.data || action.payload;
        if (property) {
          state.properties.unshift(property);
          state.pagination.total += 1;
        }
      })
      .addCase(createProperty.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // Get Property by ID
      .addCase(getPropertyById.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getPropertyById.fulfilled, (state, action) => {
        state.loading = false;
        // Handle both { data: property } and direct property object responses
        state.currentProperty = action.payload?.data || action.payload;
      })
      .addCase(getPropertyById.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // Update Property
      .addCase(updateProperty.pending, (state) => {
        state.loading = true;
        state.error = null;
        state.success = false;
      })
      .addCase(updateProperty.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        const index = state.properties.findIndex(
          property => property._id === action.payload.data._id
        );
        if (index !== -1) {
          state.properties[index] = action.payload.data;
        }
        if (state.currentProperty &&
            state.currentProperty._id === action.payload.data._id) {
          state.currentProperty = action.payload.data;
        }
      })
      .addCase(updateProperty.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      // Delete Property
      .addCase(deleteProperty.pending, (state) => {
        state.loading = true;
        state.error = null;
        state.success = false;
      })
      .addCase(deleteProperty.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        if (action.payload.mode === 'deleted') {
          state.properties = state.properties.filter(
            property => property._id !== action.payload.id
          );
          state.pagination.total = Math.max(0, (state.pagination.total || 0) - 1);
          if (state.currentProperty?._id === action.payload.id) {
            state.currentProperty = null;
          }
        } else {
          state.properties = state.properties.map((property) =>
            property._id === action.payload.id
              ? {
                  ...property,
                  status: action.payload.data?.status || 'archived',
                }
              : property
          );

          if (state.currentProperty?._id === action.payload.id) {
            state.currentProperty = {
              ...state.currentProperty,
              status: action.payload.data?.status || 'archived',
            };
          }
        }
      })
      .addCase(deleteProperty.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Archive Property
      .addCase(archiveProperty.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(archiveProperty.fulfilled, (state, action) => {
        state.loading = false;
        state.properties = state.properties.map(p =>
          p._id === action.payload.id ? { ...p, status: 'archived' } : p
        );
        state.success = true;
      })
      .addCase(archiveProperty.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Restore Property
      .addCase(restoreProperty.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(restoreProperty.fulfilled, (state, action) => {
        state.loading = false;
        state.properties = state.properties.map(p =>
          p._id === action.payload.id ? { ...p, status: 'active' } : p
        );
        state.success = true;
      })
      .addCase(restoreProperty.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  }
});

export const { clearError, clearCurrentProperty, resetPropertyState } = propertySlice.actions;
export default propertySlice.reducer;
