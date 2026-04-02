import {createSlice} from "@reduxjs/toolkit"

export const requestsSlice = createSlice({
    name:"request",
    initialState:{
        requests:[],
        isFetching:false,
        error:false
    },
    reducers:{
        //get all requests
        getRequestsStart:(state) => {
            state.isFetching = true
            state.error = false
        },
        getRequestsSuccess:(state,action) => {
            state.isFetching = false
            state.requests = action.payload
        },
        getRequestsFailure:(state) => {
            state.isFetching = false
            state.error = true
        },

        //creating a Request
        createRequestStart:(state) => {
            state.isFetching = true
            state.error = false
        },
        createRequestSuccess:(state,action) => {
            state.isFetching = false
            state.requests.push(action.payload)
        },
        createRequestFailure:(state) => {
            state.isFetching = false
            state.error = true
        },

        //deleting a Request
        deleteRequestStart:(state) => {
            state.isFetching = true
            state.error = false
        },
        deleteRequestSuccess:(state,action) => {
            state.isFetching = false
            state.requests.splice(state.requests.findIndex((item) => item._id === action.payload),1)
        },
        deleteRequestFailure:(state) => {
            state.isFetching = false
            state.error = true
        }
        ,
      


    }
})

export const {createRequestStart,createRequestSuccess,createRequestFailure,
             getRequestsStart,getRequestsSuccess,getRequestsFailure,
            deleteRequestStart ,deleteRequestSuccess,deleteRequestFailure } = requestsSlice.actions

export default requestsSlice.reducer