import { adminRequests } from "../utils/requestMethods";

const unwrap = (response) => response?.data?.data ?? response?.data;
const unwrapPage = (response) => {
  const d = response?.data;
  return d && typeof d.total === "number" ? d : { data: Array.isArray(d) ? d : [], total: Array.isArray(d) ? d.length : 0, page: 1, pages: 1 };
};

export const saleApi = {
  // Listings
  listListings: async (params = {}) => unwrapPage(await adminRequests.get("/sale/listings", { params })),
  getListing: async (id, params = {}) => unwrap(await adminRequests.get(`/sale/listings/${id}`, { params })),
  createListing: async (payload) => unwrap(await adminRequests.post("/sale/listings", payload)),
  updateListing: async (id, payload) => unwrap(await adminRequests.put(`/sale/listings/${id}`, payload)),
  updateListingStatus: async (id, status) => unwrap(await adminRequests.patch(`/sale/listings/${id}/status`, { status })),
  deleteListing: async (id) => unwrap(await adminRequests.delete(`/sale/listings/${id}`)),
  uploadListingImages: async (id, formData) => (await adminRequests.post(`/sale/listings/${id}/images`, formData))?.data,
  deleteListingImage: async (id, url) => (await adminRequests.delete(`/sale/listings/${id}/images`, { data: { url } }))?.data,

  // Buyers
  listBuyers: async (params = {}) => unwrapPage(await adminRequests.get("/sale/buyers", { params })),
  getBuyer: async (id, params = {}) => unwrap(await adminRequests.get(`/sale/buyers/${id}`, { params })),
  createBuyer: async (payload) => unwrap(await adminRequests.post("/sale/buyers", payload)),
  updateBuyer: async (id, payload) => unwrap(await adminRequests.put(`/sale/buyers/${id}`, payload)),
  deleteBuyer: async (id) => unwrap(await adminRequests.delete(`/sale/buyers/${id}`)),
  sendBuyerSms: async (id, payload) => unwrap(await adminRequests.post(`/sale/buyers/${id}/sms`, payload)),

  // Agents
  listAgents: async (params = {}) => unwrapPage(await adminRequests.get("/sale/agents", { params })),
  getAgent: async (id, params = {}) => unwrap(await adminRequests.get(`/sale/agents/${id}`, { params })),
  createAgent: async (payload) => unwrap(await adminRequests.post("/sale/agents", payload)),
  updateAgent: async (id, payload) => unwrap(await adminRequests.put(`/sale/agents/${id}`, payload)),
  deleteAgent: async (id) => unwrap(await adminRequests.delete(`/sale/agents/${id}`)),

  // Offers
  listOffers: async (params = {}) => unwrapPage(await adminRequests.get("/sale/offers", { params })),
  getOffer: async (id, params = {}) => unwrap(await adminRequests.get(`/sale/offers/${id}`, { params })),
  createOffer: async (payload) => unwrap(await adminRequests.post("/sale/offers", payload)),
  updateOffer: async (id, payload) => unwrap(await adminRequests.put(`/sale/offers/${id}`, payload)),
  updateOfferStatus: async (id, payload) => unwrap(await adminRequests.patch(`/sale/offers/${id}/status`, payload)),
  deleteOffer: async (id) => unwrap(await adminRequests.delete(`/sale/offers/${id}`)),

  // Deals
  listDeals: async (params = {}) => unwrapPage(await adminRequests.get("/sale/deals", { params })),
  getDeal: async (id, params = {}) => unwrap(await adminRequests.get(`/sale/deals/${id}`, { params })),
  createDeal: async (payload) => unwrap(await adminRequests.post("/sale/deals", payload)),
  updateDeal: async (id, payload) => unwrap(await adminRequests.put(`/sale/deals/${id}`, payload)),
  closeDeal: async (id, payload = {}) => unwrap(await adminRequests.patch(`/sale/deals/${id}/close`, payload)),
  cancelDeal: async (id, payload = {}) => unwrap(await adminRequests.patch(`/sale/deals/${id}/cancel`, payload)),
  deleteDeal: async (id) => unwrap(await adminRequests.delete(`/sale/deals/${id}`)),
  sendDealSms: async (id, payload) => unwrap(await adminRequests.post(`/sale/deals/${id}/sms`, payload)),

  // Payments
  listPayments: async (params = {}) => unwrapPage(await adminRequests.get("/sale/payments", { params })),
  createPayment: async (payload) => unwrap(await adminRequests.post("/sale/payments", payload)),
  updatePayment: async (id, payload) => unwrap(await adminRequests.put(`/sale/payments/${id}`, payload)),
  voidPayment: async (id, payload = {}) => unwrap(await adminRequests.patch(`/sale/payments/${id}/void`, payload)),
  deletePayment: async (id) => unwrap(await adminRequests.delete(`/sale/payments/${id}`)),

  // Commissions
  listCommissions: async (params = {}) => unwrapPage(await adminRequests.get("/sale/commissions", { params })),
  updateCommissionStatus: async (id, payload) => unwrap(await adminRequests.patch(`/sale/commissions/${id}/status`, payload)),

  // Reports
  getDashboardStats: async (params = {}) => unwrap(await adminRequests.get("/sale/reports/dashboard", { params })),
  getSalesReport:    async (params = {}) => unwrap(await adminRequests.get("/sale/reports/sales",          { params })),
  getMonthlyDetail:  async (params = {}) => unwrap(await adminRequests.get("/sale/reports/monthly-detail", { params })),

  // CRM — Leads
  listLeads:      async (params = {}) => unwrapPage(await adminRequests.get("/sale/leads",             { params })),
  getLead:        async (id, params = {}) => unwrap(await adminRequests.get(`/sale/leads/${id}`,        { params })),
  createLead:     async (payload)    => unwrap(await adminRequests.post("/sale/leads",                 payload)),
  updateLead:     async (id, payload) => unwrap(await adminRequests.put(`/sale/leads/${id}`,           payload)),
  deleteLead:     async (id)         => unwrap(await adminRequests.delete(`/sale/leads/${id}`)),
  convertLead:    async (id, payload) => unwrap(await adminRequests.patch(`/sale/leads/${id}/convert`, payload)),
  getLeadsPipeline: async (params = {}) => unwrap(await adminRequests.get("/sale/leads/pipeline",      { params })),

  // CRM — Activities
  listActivities:   async (params = {}) => unwrapPage(await adminRequests.get("/sale/activities",         { params })),
  createActivity:   async (payload)     => unwrap(await adminRequests.post("/sale/activities",            payload)),
  updateActivity:   async (id, payload) => unwrap(await adminRequests.put(`/sale/activities/${id}`,      payload)),
  deleteActivity:   async (id)          => unwrap(await adminRequests.delete(`/sale/activities/${id}`)),
};

export const todayISO = () => new Date().toISOString().slice(0, 10);

export const fmtKES = (value) =>
  `KES ${Number(value || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const normalizeList = (payload, key) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};
