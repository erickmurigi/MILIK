import { adminRequests } from "../../utils/requestMethods";

import {
  getRequestsFailure,
  getRequestsStart,
  getRequestsSuccess,
  createRequestStart,
  createRequestFailure,
  createRequestSuccess,
  deleteRequestStart,
  deleteRequestSuccess,
  deleteRequestFailure
} from "../requestServiceRedux";

export const deleteRequest = async (id,dispatch) => {
  dispatch(deleteRequestStart())
  try{
    await adminRequests.delete(`/requests/${id}`)
    dispatch(deleteRequestSuccess(id))
  }catch(err){
    dispatch(deleteRequestFailure())
  }
}

//creating a Request
export const createRequest = async (request, dispatch) => {
  dispatch(createRequestStart());
  try {
    const res = await adminRequests.post(`/requests`, request);
    dispatch(createRequestSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(createRequestFailure());
    throw err;
  }
};

//getting all requests
export const getRequests = async (dispatch) => {
  dispatch(getRequestsStart())
  try{
    const res = await adminRequests.get("/requests/")
    dispatch(getRequestsSuccess(res.data))
  }catch(err){
    dispatch(getRequestsFailure())
  }
}
