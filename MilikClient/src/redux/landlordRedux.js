// redux/landlordSlice.js
import { createSlice } from "@reduxjs/toolkit"

export const landlordSlice = createSlice({
    name: "landlord",
    initialState: {
        landlords: [],
        isFetching: false,
        error: false
    },
    reducers: {
        // Get all landlords
        getLandlordsStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        getLandlordsSuccess: (state, action) => {
            state.isFetching = false
            state.error = false
            state.landlords = Array.isArray(action.payload) ? action.payload : []
        },
        getLandlordsFailure: (state) => {
            state.isFetching = false
            state.error = true
            state.landlords = []
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
        },
        deleteLandlordFailure: (state) => {
            state.isFetching = false
            state.error = true
        }
    }
})

export const {
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