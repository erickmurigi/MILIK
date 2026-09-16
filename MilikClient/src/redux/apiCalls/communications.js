import { adminRequests } from "../../utils/requestMethods";

// Communications
export const getCommunicationTemplates = async ({ business, contextType }) => {
  const params = new URLSearchParams();
  if (business) params.append('business', business);
  if (contextType) params.append('contextType', contextType);
  const query = params.toString();
  const res = await adminRequests.get(`/communications/templates${query ? `?${query}` : ''}`);
  return res.data;
};

export const previewCommunicationMessage = async (payload) => {
  const res = await adminRequests.post('/communications/preview', payload);
  return res.data;
};

export const sendCommunicationMessage = async (payload) => {
  const res = await adminRequests.post('/communications/send', payload);
  return res.data;
};

export const getSmsLogs = async (business, { limit = 30, channel, contextType, status } = {}) => {
  const params = new URLSearchParams({ business, limit });
  if (channel) params.set('channel', channel);
  if (contextType) params.set('contextType', contextType);
  if (status) params.set('status', status);
  const res = await adminRequests.get(`/communications/sms-logs?${params}`);
  return res.data;
};

export const sendTestSms = async (payload) => {
  const res = await adminRequests.post('/communications/test-sms', payload);
  return res.data;
};
