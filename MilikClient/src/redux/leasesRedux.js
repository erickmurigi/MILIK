// redux/leaseSlice.js
import { createSlice } from "@reduxjs/toolkit"

export const leaseSlice = createSlice({
    name: "lease",
    initialState: {
        leases: [],
        isFetching: false,
        error: false
    },
    reducers: {
        // Get all leases
        getLeasesStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        getLeasesSuccess: (state, action) => {
            state.isFetching = false
            state.leases = action.payload
        },
        getLeasesFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Create lease
        createLeaseStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        createLeaseSuccess: (state, action) => {
            state.isFetching = false
            state.leases.push(action.payload)
        },
        createLeaseFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Update lease
        updateLeaseStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        updateLeaseSuccess: (state, action) => {
            state.isFetching = false
            const index = state.leases.findIndex((item) => item._id === action.payload._id)
            if (index !== -1) {
                state.leases[index] = action.payload
            }
        },
        updateLeaseFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Delete lease
        deleteLeaseStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        deleteLeaseSuccess: (state, action) => {
            state.isFetching = false
            state.leases.splice(
                state.leases.findIndex((item) => item._id === action.payload),
                1
            )
        },
        deleteLeaseFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Sign lease
        signLeaseStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        signLeaseSuccess: (state, action) => {
            state.isFetching = false
            const index = state.leases.findIndex((item) => item._id === action.payload._id)
            if (index !== -1) {
                state.leases[index] = action.payload
            }
        },
        signLeaseFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Renew lease
        renewLeaseStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        renewLeaseSuccess: (state, action) => {
            state.isFetching = false
            state.leases.push(action.payload)
        },
        renewLeaseFailure: (state) => {
            state.isFetching = false
            state.error = true
        }
    }
})

export const {
    getLeasesStart,
    getLeasesSuccess,
    getLeasesFailure,
    createLeaseStart,
    createLeaseSuccess,
    createLeaseFailure,
    updateLeaseStart,
    updateLeaseSuccess,
    updateLeaseFailure,
    deleteLeaseStart,
    deleteLeaseSuccess,
    deleteLeaseFailure,
    signLeaseStart,
    signLeaseSuccess,
    signLeaseFailure,
    renewLeaseStart,
    renewLeaseSuccess,
    renewLeaseFailure
} = leaseSlice.actions

export default leaseSlice.reducer