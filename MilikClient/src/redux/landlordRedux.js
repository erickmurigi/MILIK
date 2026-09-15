// redux/landlordSlice.js
import { createSlice } from "@reduxjs/toolkit"

export const landlordSlice = createSlice({
    name: "landlord",
    initialState: {
        landlords: [],
        pagination: { total: 0, page: 1, pages: 1, limit: 50 },
        loadedFor: null,
        loadedAt: 0,
        isFetching: false,
        error: false
    },
    reducers: {
        // Track when the company-wide landlord list was last successfully fetched.
        // Only set by getLandlords in apiCalls when no search/status/portal/location
        // filter is used — a filtered fetch returns a partial list.
        setLandlordLoadMeta: (state, action) => {
            state.loadedFor = action.payload.loadedFor;
            state.loadedAt  = action.payload.loadedAt;
        },

        // Get all landlords
        getLandlordsStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        getLandlordsSuccess: (state, action) => {
            state.isFetching = false
            state.error = false
            if (action.payload && typeof action.payload === "object" && !Array.isArray(action.payload) && action.payload.landlords) {
                state.landlords = action.payload.landlords;
                state.pagination = action.payload.pagination || state.pagination;
            } else {
                state.landlords = Array.isArray(action.payload) ? action.payload : []
            }
        },
        getLandlordsFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Create landlord
        createLandlordStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        createLandlordSuccess: (state, action) => {
            state.isFetching = false
            state.error = false
            state.landlords.unshift(action.payload)
            state.loadedFor = null
            state.loadedAt = 0
        },
        createLandlordFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Update landlord
        updateLandlordStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        updateLandlordSuccess: (state, action) => {
            state.isFetching = false
            state.error = false
            const index = state.landlords.findIndex((item) => item._id === action.payload._id)
            if (index !== -1) {
                state.landlords[index] = action.payload
            }
            state.loadedFor = null
            state.loadedAt = 0
        },
        updateLandlordFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Delete landlord
        deleteLandlordStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        deleteLandlordSuccess: (state, action) => {
            state.isFetching = false
            state.error = false
            state.landlords = state.landlords.filter((item) => item._id !== action.payload)
            state.loadedFor = null
            state.loadedAt = 0
        },
        deleteLandlordFailure: (state) => {
            state.isFetching = false
            state.error = true
        }
    }
})

export const {
    setLandlordLoadMeta,
    getLandlordsStart,
    getLandlordsSuccess,
    getLandlordsFailure,
    createLandlordStart,
    createLandlordSuccess,
    createLandlordFailure,
    updateLandlordStart,
    updateLandlordSuccess,
    updateLandlordFailure,
    deleteLandlordStart,
    deleteLandlordSuccess,
    deleteLandlordFailure
} = landlordSlice.actions

export default landlordSlice.reducer