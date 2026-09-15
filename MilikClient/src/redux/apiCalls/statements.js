import { adminRequests } from "../../utils/requestMethods";
import { resolveCompanyId, resolveLandlordIdFromProperty } from "./shared";

import {
  getStatementsStart,
  getStatementsSuccess,
  getStatementsFailure,
  getStatementStart,
  getStatementSuccess,
  getStatementFailure,
  createDraftStart,
  createDraftSuccess,
  createDraftFailure,
  approveStart,
  approveSuccess,
  approveFailure,
  sendStart,
  sendSuccess,
  sendFailure,
  createRevisionStart,
  createRevisionSuccess,
  createRevisionFailure,
  deleteDraftStart,
  deleteDraftSuccess,
  deleteDraftFailure,
  validateAuditStart,
  validateAuditSuccess,
  validateAuditFailure,
} from "../statementsRedux";

export const getStatements = (filters = {}) => async (dispatch) => {
  dispatch(getStatementsStart());
  try {
    if (!filters.landlordId && !filters.propertyId) {
      dispatch(getStatementsSuccess([]));
      return [];
    }

    const queryParams = new URLSearchParams();
    if (filters.landlordId) queryParams.append('landlordId', filters.landlordId);
    if (filters.propertyId) queryParams.append('propertyId', filters.propertyId);
    if (filters.status) queryParams.append('status', filters.status);
    if (filters.periodStart) queryParams.append('periodStart', filters.periodStart);
    if (filters.periodEnd) queryParams.append('periodEnd', filters.periodEnd);

    const res = await adminRequests.get(`/statements?${queryParams.toString()}`);
    const statements = res.data?.data?.statements || [];
    dispatch(getStatementsSuccess(statements));
    return statements;
  } catch (err) {
    dispatch(getStatementsFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Get single statement with lines
export const getStatement = (statementId) => async (dispatch) => {
  dispatch(getStatementStart());
  try {
    const res = await adminRequests.get(`/statements/${statementId}?populateRefs=true&includeLines=true`);
    const payload = {
      statement: res.data?.data?.statement || null,
      lines: res.data?.data?.lines || [],
    };
    dispatch(getStatementSuccess(payload));
    return payload;
  } catch (err) {
    dispatch(getStatementFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Create draft statement
export const createDraftStatement = (payload) => async (dispatch, getState) => {
  dispatch(createDraftStart());
  try {
    const { _signal, ...rest } = payload || {};
    const resolvedPayload = {
      ...rest,
      businessId: rest?.businessId || resolveCompanyId(rest, getState),
      landlordId: rest?.landlordId || resolveLandlordIdFromProperty(rest?.propertyId, getState),
    };

    const res = await adminRequests.post("/statements/draft", resolvedPayload, {
      ...(_signal ? { signal: _signal } : {}),
    });
    const statement = res.data?.data?.statement;
    const lines = res.data?.data?.lines || [];
    dispatch(createDraftSuccess(statement));
    return { statement, lines };
  } catch (err) {
    dispatch(createDraftFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Approve statement (makes it immutable)
export const approveStatement = (statementId, approvalNotes = '') => async (dispatch) => {
  dispatch(approveStart());
  try {
    const res = await adminRequests.post(`/statements/${statementId}/approve`, { approvalNotes });
    const statement = res.data?.data?.statement;
    dispatch(approveSuccess(statement));
    return statement;
  } catch (err) {
    dispatch(approveFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Send statement (mark as sent)
export const sendStatement = (statementId) => async (dispatch) => {
  dispatch(sendStart());
  try {
    const res = await adminRequests.post(`/statements/${statementId}/send`);
    const statement = res.data?.data?.statement;
    dispatch(sendSuccess(statement));
    return statement;
  } catch (err) {
    dispatch(sendFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Create revision of existing statement
export const createStatementRevision = (statementId, revisionReason) => async (dispatch) => {
  dispatch(createRevisionStart());
  try {
    const res = await adminRequests.post(`/statements/${statementId}/revise`, { revisionReason });
    const payload = {
      newStatement: res.data?.data?.newStatement,
      originalStatement: res.data?.data?.originalStatement,
    };
    dispatch(createRevisionSuccess(payload));
    return payload;
  } catch (err) {
    dispatch(createRevisionFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Delete draft statement
export const deleteDraftStatement = (statementId) => async (dispatch) => {
  dispatch(deleteDraftStart());
  try {
    await adminRequests.delete(`/statements/${statementId}`);
    dispatch(deleteDraftSuccess(statementId));
    return true;
  } catch (err) {
    dispatch(deleteDraftFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Validate statement audit
export const validateStatementAudit = (statementId) => async (dispatch) => {
  dispatch(validateAuditStart());
  try {
    const res = await adminRequests.get(`/statements/${statementId}/validate`);
    const auditData = res.data?.data || {};
    dispatch(validateAuditSuccess(auditData));
    return auditData;
  } catch (err) {
    dispatch(validateAuditFailure(err.response?.data?.message || err.message));
    throw err;
  }
};

// Download statement PDF
export const downloadStatementPdf = async (statementId) => {
  try {
    const res = await adminRequests.get(`/statements/${statementId}/pdf`, {
      responseType: 'blob'
    });

    // Create blob URL and trigger download
    const blob = new Blob([res.data], { type: 'application/pdf' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `statement-${statementId}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);

    return true;
  } catch (err) {
    throw err;
  }
};
