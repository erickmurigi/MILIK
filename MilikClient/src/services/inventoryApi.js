import { adminRequests } from "../utils/requestMethods";

const unwrap = (response) => response?.data?.data ?? response?.data;

export const inventoryApi = {
  // Locations
  listLocations:    (p = {}) => adminRequests.get("/inventory/locations", { params: p }).then(unwrap),
  createLocation:   (b)      => adminRequests.post("/inventory/locations", b).then(unwrap),
  updateLocation:   (id, b)  => adminRequests.put(`/inventory/locations/${id}`, b).then(unwrap),
  deleteLocation:   (id)     => adminRequests.delete(`/inventory/locations/${id}`).then(unwrap),

  // Categories
  listCategories:   (p = {}) => adminRequests.get("/inventory/categories", { params: p }).then(unwrap),
  createCategory:   (b)      => adminRequests.post("/inventory/categories", b).then(unwrap),
  updateCategory:   (id, b)  => adminRequests.put(`/inventory/categories/${id}`, b).then(unwrap),
  deleteCategory:   (id)     => adminRequests.delete(`/inventory/categories/${id}`).then(unwrap),

  // Products
  listProducts:     (p = {}) => adminRequests.get("/inventory/products", { params: p }).then(unwrap),
  getProduct:       (id, p = {}) => adminRequests.get(`/inventory/products/${id}`, { params: p }).then(unwrap),
  lookupProduct:    (q)      => adminRequests.get("/inventory/products/lookup", { params: { q } }).then(unwrap),
  createProduct:    (b)      => adminRequests.post("/inventory/products", b).then(unwrap),
  updateProduct:    (id, b)  => adminRequests.put(`/inventory/products/${id}`, b).then(unwrap),
  deleteProduct:    (id)     => adminRequests.delete(`/inventory/products/${id}`).then(unwrap),

  // Suppliers
  listSuppliers:    (p = {}) => adminRequests.get("/inventory/suppliers", { params: p }).then(unwrap),
  getSupplier:      (id)     => adminRequests.get(`/inventory/suppliers/${id}`).then(unwrap),
  createSupplier:   (b)      => adminRequests.post("/inventory/suppliers", b).then(unwrap),
  updateSupplier:   (id, b)  => adminRequests.put(`/inventory/suppliers/${id}`, b).then(unwrap),
  deleteSupplier:   (id)     => adminRequests.delete(`/inventory/suppliers/${id}`).then(unwrap),

  // Stock movements
  listMovements:    (p = {}) => adminRequests.get("/inventory/stock-movements", { params: p }).then(unwrap),
  getBalance:       (p)      => adminRequests.get("/inventory/stock-movements/balance", { params: p }).then(unwrap),
  getValuation:     (p = {}) => adminRequests.get("/inventory/stock-movements/valuation", { params: p }).then(unwrap),
  createManualEntry:(b)      => adminRequests.post("/inventory/stock-movements", b).then(unwrap),

  // Stock transfers
  listTransfers:    (p = {}) => adminRequests.get("/inventory/transfers", { params: p }).then(unwrap),
  getTransfer:      (id)     => adminRequests.get(`/inventory/transfers/${id}`).then(unwrap),
  createTransfer:   (b)      => adminRequests.post("/inventory/transfers", b).then(unwrap),
  updateTransfer:   (id, b)  => adminRequests.put(`/inventory/transfers/${id}`, b).then(unwrap),
  dispatchTransfer: (id)     => adminRequests.post(`/inventory/transfers/${id}/dispatch`).then(unwrap),
  receiveTransfer:  (id, b)  => adminRequests.post(`/inventory/transfers/${id}/receive`, b).then(unwrap),
  cancelTransfer:   (id)     => adminRequests.post(`/inventory/transfers/${id}/cancel`).then(unwrap),

  // Purchase orders
  listPurchaseOrders:  (p = {}) => adminRequests.get("/inventory/purchase-orders", { params: p }).then(unwrap),
  getPurchaseOrder:    (id)     => adminRequests.get(`/inventory/purchase-orders/${id}`).then(unwrap),
  createPurchaseOrder: (b)      => adminRequests.post("/inventory/purchase-orders", b).then(unwrap),
  updatePurchaseOrder: (id, b)  => adminRequests.put(`/inventory/purchase-orders/${id}`, b).then(unwrap),
  receiveGoods:        (id, b)  => adminRequests.post(`/inventory/purchase-orders/${id}/receive-goods`, b).then(unwrap),
  cancelPurchaseOrder: (id)     => adminRequests.post(`/inventory/purchase-orders/${id}/cancel`).then(unwrap),

  // Tills
  listTills:        (p = {}) => adminRequests.get("/inventory/tills", { params: p }).then(unwrap),
  getTill:          (id)     => adminRequests.get(`/inventory/tills/${id}`).then(unwrap),
  createTill:       (b)      => adminRequests.post("/inventory/tills", b).then(unwrap),
  updateTill:       (id, b)  => adminRequests.put(`/inventory/tills/${id}`, b).then(unwrap),
  deleteTill:       (id)     => adminRequests.delete(`/inventory/tills/${id}`).then(unwrap),

  // POS Sessions
  listSessions:     (p = {}) => adminRequests.get("/pos/sessions", { params: p }).then(unwrap),
  getSession:       (id)     => adminRequests.get(`/pos/sessions/${id}`).then(unwrap),
  getActiveSession: (p)      => adminRequests.get("/pos/sessions/active", { params: p }).then(unwrap),
  openSession:      (b)      => adminRequests.post("/pos/sessions", b).then(unwrap),
  closeSession:     (id, b)  => adminRequests.post(`/pos/sessions/${id}/close`, b).then(unwrap),
  cashIn:           (id, b)  => adminRequests.post(`/pos/sessions/${id}/cash-in`, b).then(unwrap),
  cashOut:          (id, b)  => adminRequests.post(`/pos/sessions/${id}/cash-out`, b).then(unwrap),
  getXRead:         (id)     => adminRequests.get(`/pos/sessions/${id}/x-read`).then(unwrap),
  listTillMovements:(p = {}) => adminRequests.get("/pos/till-movements", { params: p }).then(unwrap),

  // POS Sales
  listSales:        (p = {}) => adminRequests.get("/pos/sales", { params: p }).then(unwrap),
  getSale:          (id)     => adminRequests.get(`/pos/sales/${id}`).then(unwrap),
  createSale:       (b)      => adminRequests.post("/pos/sales", b).then(unwrap),
  voidSale:         (id, b)  => adminRequests.post(`/pos/sales/${id}/void`, b).then(unwrap),
  getSalesSummary:  (p = {}) => adminRequests.get("/pos/sales/summary", { params: p }).then(unwrap),
};

export const formatMoney = (value) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

export const todayISO = () => new Date().toISOString().slice(0, 10);

export const normalizeList = (raw, key) => {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw[key])) return raw[key];
  if (raw && Array.isArray(raw.data)) return raw.data;
  return [];
};
