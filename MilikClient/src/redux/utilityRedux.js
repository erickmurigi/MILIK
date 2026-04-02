// redux/utilitySlice.js
import { createSlice } from "@reduxjs/toolkit"

export const utilitySlice = createSlice({
    name: "utility",
    initialState: {
        utilities: [],
        isFetching: false,
        error: false
    },
    reducers: {
        // Get all utilities
        getUtilitiesStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        getUtilitiesSuccess: (state, action) => {
            state.isFetching = false
            state.utilities = action.payload
        },
        getUtilitiesFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Create utility
        createUtilityStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        createUtilitySuccess: (state, action) => {
            state.isFetching = false
            state.utilities.push(action.payload)
        },
        createUtilityFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Update utility
        updateUtilityStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        updateUtilitySuccess: (state, action) => {
            state.isFetching = false
            const index = state.utilities.findIndex((item) => item._id === action.payload._id)
            if (index !== -1) {
                state.utilities[index] = action.payload
            }
        },
        updateUtilityFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Delete utility
        deleteUtilityStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        deleteUtilitySuccess: (state, action) => {
            state.isFetching = false
            state.utilities.splice(
                state.utilities.findIndex((item) => item._id === action.payload),
                1
            )
        },
        deleteUtilityFailure: (state) => {
            state.isFetching = false
            state.error = true
        }
    }
})

export const {
    getUtilitiesStart,
    getUtilitiesSuccess,
    getUtilitiesFailure,
    createUtilityStart,
    createUtilitySuccess,
    createUtilityFailure,
    updateUtilityStart,
    updateUtilitySuccess,
    updateUtilityFailure,
    deleteUtilityStart,
    deleteUtilitySuccess,
    deleteUtilityFailure
} = utilitySlice.actions

export default utilitySlice.reducer