// redux/maintenanceSlice.js
import { createSlice } from "@reduxjs/toolkit"

export const maintenanceSlice = createSlice({
    name: "maintenance",
    initialState: {
        maintenances: [],
        isFetching: false,
        error: false
    },
    reducers: {
        // Get all maintenances
        getMaintenancesStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        getMaintenancesSuccess: (state, action) => {
            state.isFetching = false
            state.maintenances = action.payload
        },
        getMaintenancesFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Create maintenance
        createMaintenanceStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        createMaintenanceSuccess: (state, action) => {
            state.isFetching = false
            state.maintenances.push(action.payload)
        },
        createMaintenanceFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Update maintenance
        updateMaintenanceStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        updateMaintenanceSuccess: (state, action) => {
            state.isFetching = false
            const index = state.maintenances.findIndex((item) => item._id === action.payload._id)
            if (index !== -1) {
                state.maintenances[index] = action.payload
            }
        },
        updateMaintenanceFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Delete maintenance
        deleteMaintenanceStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        deleteMaintenanceSuccess: (state, action) => {
            state.isFetching = false
            state.maintenances.splice(
                state.maintenances.findIndex((item) => item._id === action.payload),
                1
            )
        },
        deleteMaintenanceFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Update maintenance status
        updateMaintenanceStatusStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        updateMaintenanceStatusSuccess: (state, action) => {
            state.isFetching = false
            const index = state.maintenances.findIndex((item) => item._id === action.payload._id)
            if (index !== -1) {
                state.maintenances[index] = action.payload
            }
        },
        updateMaintenanceStatusFailure: (state) => {
            state.isFetching = false
            state.error = true
        }
    }
})

export const {
    getMaintenancesStart,
    getMaintenancesSuccess,
    getMaintenancesFailure,
    createMaintenanceStart,
    createMaintenanceSuccess,
    createMaintenanceFailure,
    updateMaintenanceStart,
    updateMaintenanceSuccess,
    updateMaintenanceFailure,
    deleteMaintenanceStart,
    deleteMaintenanceSuccess,
    deleteMaintenanceFailure,
    updateMaintenanceStatusStart,
    updateMaintenanceStatusSuccess,
    updateMaintenanceStatusFailure
} = maintenanceSlice.actions

export default maintenanceSlice.reducer