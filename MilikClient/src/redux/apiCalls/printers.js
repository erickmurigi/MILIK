import { adminRequests } from "../../utils/requestMethods";

import {
  createPrinterFailure,
  createPrinterStart,
  createPrinterSuccess,
  deletePrinterFailure,
  deletePrinterStart,
  deletePrinterSuccess,
  getPrintersFailure,
  getPrintersStart,
  getPrintersSuccess
} from "../printerRedux";

export const getPrinters = async (dispatch, businessId) => {
  dispatch(getPrintersStart());
  try {
    const res = await adminRequests.get(`/printers?businessId=${businessId}`);
    dispatch(getPrintersSuccess(res.data));
  } catch (err) {
    dispatch(getPrintersFailure());
  }
};

// Creating a printer
export const createPrinter = async (printerData, dispatch) => {
  dispatch(createPrinterStart());
  try {
    const res = await adminRequests.post("/printers", printerData);
    dispatch(createPrinterSuccess(res.data));
  } catch (err) {
    dispatch(createPrinterFailure());
  }
};

// Deleting a printer
export const deletePrinter = async (id, dispatch) => {
  dispatch(deletePrinterStart());
  try {
    await adminRequests.delete(`/printers/${id}`);
    dispatch(deletePrinterSuccess(id));
  } catch (err) {
    dispatch(deletePrinterFailure());
  }
};
