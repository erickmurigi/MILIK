import { createSlice } from "@reduxjs/toolkit";

export const printersSlice = createSlice({
    name: "printer",
    initialState: {
        printers: [],
        isFetching: false,
        error: false
    },
    reducers: {
        // Get all printers
        getPrintersStart: (state) => {
            state.isFetching = true;
            state.error = false;
        },
        getPrintersSuccess: (state, action) => {
            state.isFetching = false;
            state.printers = action.payload;
        },
        getPrintersFailure: (state) => {
            state.isFetching = false;
            state.error = true;
        },

        // Create printer
        createPrinterStart: (state) => {
            state.isFetching = true;
            state.error = false;
        },
        createPrinterSuccess: (state, action) => {
            state.isFetching = false;
            state.printers.push(action.payload);
        },
        createPrinterFailure: (state) => {
            state.isFetching = false;
            state.error = true;
        },

        // Delete printer
        deletePrinterStart: (state) => {
            state.isFetching = true;
            state.error = false;
        },
        deletePrinterSuccess: (state, action) => {
            state.isFetching = false;
            state.printers = state.printers.filter((printer) => printer._id !== action.payload);
        },
        deletePrinterFailure: (state) => {
            state.isFetching = false;
            state.error = true;
        },
    }
});

export const {
    getPrintersStart, getPrintersSuccess, getPrintersFailure,
    createPrinterStart, createPrinterSuccess, createPrinterFailure,
    deletePrinterStart, deletePrinterSuccess, deletePrinterFailure
} = printersSlice.actions;

export default printersSlice.reducer;