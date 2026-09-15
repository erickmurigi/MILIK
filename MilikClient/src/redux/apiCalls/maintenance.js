import { adminRequests } from "../../utils/requestMethods";
import { extractList } from "./shared";

import {
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
} from "../maintenanceRedux";

// Get all maintenances
export const getMaintenances = async (dispatch, business, status = null, priority = null, unit = null, tenant = null) => {
  dispatch(getMaintenancesStart());
  try {
    let url = `/maintenances?business=${business}&limit=200`;
    if (status) url += `&status=${status}`;
    if (priority) url += `&priority=${priority}`;
    if (unit) url += `&unit=${unit}`;
    if (tenant) url += `&tenant=${tenant}`;

    const res = await adminRequests.get(url);
    dispatch(getMaintenancesSuccess(extractList(res.data)));
  } catch (err) {
    dispatch(getMaintenancesFailure());
  }
};

// Get single maintenance
export const getMaintenance = async (dispatch, id) => {
  dispatch(getMaintenancesStart());
  try {
    const res = await adminRequests.get(`/maintenances/${id}`);
    dispatch(getMaintenancesSuccess([res.data]));
  } catch (err) {
    dispatch(getMaintenancesFailure());
  }
};

// Create maintenance
export const createMaintenance = async (dispatch, maintenanceData) => {
  dispatch(createMaintenanceStart());
  try {
    const res = await adminRequests.post("/maintenances", maintenanceData);
    dispatch(createMaintenanceSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(createMaintenanceFailure());
    throw err;
  }
};

// Update maintenance
export const updateMaintenance = async (dispatch, id, maintenanceData) => {
  dispatch(updateMaintenanceStart());
  try {
    const res = await adminRequests.put(`/maintenances/${id}`, maintenanceData);
    dispatch(updateMaintenanceSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(updateMaintenanceFailure());
    throw err;
  }
};

// Delete maintenance
export const deleteMaintenance = async (dispatch, id) => {
  dispatch(deleteMaintenanceStart());
  try {
    await adminRequests.delete(`/maintenances/${id}`);
    dispatch(deleteMaintenanceSuccess(id));
    return true;
  } catch (err) {
    dispatch(deleteMaintenanceFailure());
    throw err;
  }
};

// Update maintenance status
export const updateMaintenanceStatus = async (dispatch, id, statusData) => {
  dispatch(updateMaintenanceStatusStart());
  try {
    const res = await adminRequests.put(`/maintenances/status/${id}`, statusData);
    dispatch(updateMaintenanceStatusSuccess(res.data));
    return res.data;
  } catch (err) {
    dispatch(updateMaintenanceStatusFailure());
    throw err;
  }
};

// Get maintenance stats
export const getMaintenanceStats = async (business) => {
  try {
    const res = await adminRequests.get(`/maintenances/get/stats?business=${business}`);
    return res.data;
  } catch (err) {
    throw err;
  }
};
