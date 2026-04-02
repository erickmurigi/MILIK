// redux/rentPaymentSlice.js
import { createSlice } from "@reduxjs/toolkit"

export const rentPaymentSlice = createSlice({
    name: "rentPayment",
    initialState: {
        rentPayments: [],
        isFetching: false,
        error: false
    },
    reducers: {
        // Get all rent payments
        getRentPaymentsStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        getRentPaymentsSuccess: (state, action) => {
            state.isFetching = false
            state.rentPayments = action.payload
        },
        getRentPaymentsFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Create rent payment
        createRentPaymentStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        createRentPaymentSuccess: (state, action) => {
            state.isFetching = false
            state.rentPayments.push(action.payload)
        },
        createRentPaymentFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Update rent payment
        updateRentPaymentStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        updateRentPaymentSuccess: (state, action) => {
            state.isFetching = false
            const index = state.rentPayments.findIndex((item) => item._id === action.payload._id)
            if (index !== -1) {
                state.rentPayments[index] = action.payload
            }
        },
        updateRentPaymentFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Delete rent payment
        deleteRentPaymentStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        deleteRentPaymentSuccess: (state, action) => {
            state.isFetching = false
            state.rentPayments.splice(
                state.rentPayments.findIndex((item) => item._id === action.payload),
                1
            )
        },
        deleteRentPaymentFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Confirm rent payment
        confirmRentPaymentStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        confirmRentPaymentSuccess: (state, action) => {
            state.isFetching = false
            const index = state.rentPayments.findIndex((item) => item._id === action.payload._id)
            if (index !== -1) {
                state.rentPayments[index] = action.payload
            }
        },
        confirmRentPaymentFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Unconfirm rent payment
        unconfirmRentPaymentStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        unconfirmRentPaymentSuccess: (state, action) => {
            state.isFetching = false
            const index = state.rentPayments.findIndex((item) => item._id === action.payload._id)
            if (index !== -1) {
                state.rentPayments[index] = action.payload
            }
        },
        unconfirmRentPaymentFailure: (state) => {
            state.isFetching = false
            state.error = true
        }
    }
})

export const {
    getRentPaymentsStart,
    getRentPaymentsSuccess,
    getRentPaymentsFailure,
    createRentPaymentStart,
    createRentPaymentSuccess,
    createRentPaymentFailure,
    updateRentPaymentStart,
    updateRentPaymentSuccess,
    updateRentPaymentFailure,
    deleteRentPaymentStart,
    deleteRentPaymentSuccess,
    deleteRentPaymentFailure,
    confirmRentPaymentStart,
    confirmRentPaymentSuccess,
    confirmRentPaymentFailure,
    unconfirmRentPaymentStart,
    unconfirmRentPaymentSuccess,
    unconfirmRentPaymentFailure
} = rentPaymentSlice.actions

export default rentPaymentSlice.reducer