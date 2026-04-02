// redux/expensePropertySlice.js
import { createSlice } from "@reduxjs/toolkit"

export const expensePropertySlice = createSlice({
    name: "expenseProperty",
    initialState: {
        expenseProperties: [],
        isFetching: false,
        error: false
    },
    reducers: {
        // Get all expense properties
        getExpensePropertiesStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        getExpensePropertiesSuccess: (state, action) => {
            state.isFetching = false
            state.expenseProperties = action.payload
        },
        getExpensePropertiesFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Create expense property
        createExpensePropertyStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        createExpensePropertySuccess: (state, action) => {
            state.isFetching = false
            state.expenseProperties.push(action.payload)
        },
        createExpensePropertyFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Update expense property
        updateExpensePropertyStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        updateExpensePropertySuccess: (state, action) => {
            state.isFetching = false
            const index = state.expenseProperties.findIndex((item) => item._id === action.payload._id)
            if (index !== -1) {
                state.expenseProperties[index] = action.payload
            }
        },
        updateExpensePropertyFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Delete expense property
        deleteExpensePropertyStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        deleteExpensePropertySuccess: (state, action) => {
            state.isFetching = false
            state.expenseProperties.splice(
                state.expenseProperties.findIndex((item) => item._id === action.payload),
                1
            )
        },
        deleteExpensePropertyFailure: (state) => {
            state.isFetching = false
            state.error = true
        }
    }
})

export const {
    getExpensePropertiesStart,
    getExpensePropertiesSuccess,
    getExpensePropertiesFailure,
    createExpensePropertyStart,
    createExpensePropertySuccess,
    createExpensePropertyFailure,
    updateExpensePropertyStart,
    updateExpensePropertySuccess,
    updateExpensePropertyFailure,
    deleteExpensePropertyStart,
    deleteExpensePropertySuccess,
    deleteExpensePropertyFailure
} = expensePropertySlice.actions

export default expensePropertySlice.reducer