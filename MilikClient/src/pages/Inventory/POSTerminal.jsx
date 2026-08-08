import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { selectCurrentCompany } from "../../redux/selectors";
import { toast } from "react-toastify";
import { printReceipt } from "../../utils/posReceipt";
import {
  FaBarcode, FaCheck, FaMinus, FaPlus, FaSearch,
  FaTimes, FaTrash, FaCashRegister, FaPrint, FaChevronDown, FaChevronUp,
  FaPause, FaPlay,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { inventoryApi, formatMoney } from "../../services/inventoryApi";
import AppSelect from "../../components/common/AppSelect";

const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

const METHODS = ["cash", "mpesa", "card", "credit"];

const emptyCart    = () => [];
const emptyPayment = () => [{ method: "cash", amount: "" }];

/* ─── Sub-components ─────────────────────────────────────────────── */

const ProductSearchRow = ({ product, onAdd }) => (
  <button
    onClick={() => onAdd(product)}
    className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left hover:bg-emerald-50 transition-colors"
  >
    <div>
      <div className="text-xs font-bold text-slate-800">{product.name}</div>
      <div className="text-[10px] text-slate-500">{product.sku || ""} · {product.unitOfMeasure || "Unit"}</div>
    </div>
    <div className="text-right shrink-0">
      <div className="text-xs font-extrabold text-[#0B3B2E]">{formatMoney(product.sellingPrice)}</div>
    </div>
  </button>
);

const ProductCard = ({ product, onAdd }) => {
  const qty       = product.stockQty ?? null;
  const reorder   = product.reorderLevel ?? 0;
  const isLow     = product.trackStock && qty !== null && qty <= reorder && qty > 0;
  const isOut     = product.trackStock && qty !== null && qty <= 0;
  const stockColor = isOut ? "text-red-500" : isLow ? "text-amber-500" : "text-slate-400";
  return (
    <button
      type="button"
      onClick={() => onAdd(product)}
      disabled={isOut}
      className={`flex flex-col gap-1 border p-2 text-left transition-colors active:scale-95 ${
        isOut
          ? "border-red-200 bg-red-50 opacity-60 cursor-not-allowed"
          : "border-slate-200 bg-white hover:border-[#0B3B2E] hover:bg-[#EDF5F1]"
      }`}
    >
      <div className="text-[11px] font-bold text-slate-800 leading-tight line-clamp-2">{product.name}</div>
      {product.sku && <div className="text-[9px] text-slate-400 font-mono">{product.sku}</div>}
      <div className="mt-auto flex items-end justify-between gap-1">
        <span className="text-xs font-extrabold text-[#0B3B2E]">{formatMoney(product.sellingPrice)}</span>
        {product.trackStock && qty !== null && (
          <span className={`text-[9px] font-bold ${stockColor}`}>
            {isOut ? "Out of stock" : `${qty} ${product.unitOfMeasure || ""}`}
          </span>
        )}
      </div>
    </button>
  );
};

const CartLine = ({ line, onQtyChange, onRemove, onDiscountChange }) => {
  const lineTotal = round2((line.unitPrice - line.discount) * line.qty);
  return (
    <div className="flex items-center gap-2 border-b border-slate-100 px-2 py-1.5">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold text-slate-800 truncate">{line.productName}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-slate-500">@ {formatMoney(line.unitPrice)}</span>
          <input
            type="number" min="0" step="0.01"
            value={line.discount === 0 ? "" : line.discount}
            onChange={(e) => onDiscountChange(line._key, Number(e.target.value || 0))}
            className="w-16 border border-slate-200 px-1 py-0.5 text-[10px] outline-none focus:border-[#0B3B2E]"
            placeholder="- Disc"
          />
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={() => onQtyChange(line._key, line.qty - 1)} className="flex h-5 w-5 items-center justify-center border border-slate-200 hover:bg-slate-100">
          <FaMinus className="text-[9px]" />
        </button>
        <input
          type="number" min="0.001" step="0.001" value={line.qty}
          onChange={(e) => onQtyChange(line._key, Number(e.target.value))}
          className="w-12 border border-slate-200 text-center text-xs py-0.5 outline-none focus:border-[#0B3B2E]"
        />
        <button onClick={() => onQtyChange(line._key, line.qty + 1)} className="flex h-5 w-5 items-center justify-center border border-slate-200 hover:bg-slate-100">
          <FaPlus className="text-[9px]" />
        </button>
      </div>
      <div className="w-20 text-right shrink-0">
        <div className="text-xs font-extrabold text-slate-900">{formatMoney(lineTotal)}</div>
      </div>
      <button onClick={() => onRemove(line._key)} className="text-red-400 hover:text-red-600 shrink-0">
        <FaTrash className="text-[10px]" />
      </button>
    </div>
  );
};

const XReadRow = ({ label, value, neg, bold }) => (
  <div className={`flex justify-between py-0.5 text-[11px] ${bold ? "font-extrabold text-slate-900" : "text-slate-600"}`}>
    <span>{label}</span>
    <span className={neg ? "text-red-600" : bold ? "text-[#0B3B2E]" : ""}>{neg ? "−" : ""}{formatMoney(value)}</span>
  </div>
);

const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString("en-KE", { dateStyle: "short", timeStyle: "short" }) : "—";

/* ─── Main POS Terminal ─────────────────────────────────────────── */

const POSTerminal = () => {
  const navigate   = useNavigate();
  const scanRef        = useRef(null);
  const lastKeyTimeRef = useRef(0);   // timestamp of last keydown in search box
  const isScanRef      = useRef(false); // true when chars are arriving at scanner speed

  /* Location / session state */
  const [locations,        setLocations]        = useState([]);
  const [selectedLocation, setSelectedLocation] = useTabState("/pos/terminal:selectedLocation", "");
  const [tills,            setTills]            = useState([]);
  const [selectedTill,     setSelectedTill]     = useTabState("/pos/terminal:selectedTill", "");
  const [session,          setSession]          = useState(null);
  const [loadingSession,   setLoadingSession]   = useState(false);
  const [openingFloat,     setOpeningFloat]     = useState("");

  /* Product catalog state */
  const [gridProducts,  setGridProducts]  = useState([]);
  const [categories,    setCategories]    = useState([]);
  const [catFilter,     setCatFilter]     = useTabState("/pos/terminal:catFilter", "all");
  const [loadingGrid,   setLoadingGrid]   = useState(false);

  /* Search state */
  const [searchQuery,   setSearchQuery]   = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching,     setSearching]     = useState(false);

  /* Cart state */
  const [cart,         setCart]         = useState(emptyCart());
  const [keyCounter,   setKeyCounter]   = useState(0);
  const [cartDiscount, setCartDiscount] = useState({ type: "amount", value: "" }); // bill-level discount
  const [orderRef,     setOrderRef]     = useState(""); // table / room / order number

  /* Parked (held) carts */
  const [parkedCarts,  setParkedCarts]  = useState([]);
  const [showParked,   setShowParked]   = useState(false);

  /* Checkout state */
  const [customerName,    setCustomerName]    = useState("");
  const [customerPhone,   setCustomerPhone]   = useState("");
  const [payments,        setPayments]        = useState(emptyPayment());
  const [amountTendered,  setAmountTendered]  = useState("");
  const [notes,           setNotes]           = useState("");
  const [showCheckout,    setShowCheckout]    = useState(false);
  const [submitting,      setSubmitting]      = useState(false);
  const [lastReceipt,     setLastReceipt]     = useState(null);
  const [showReceipt,     setShowReceipt]     = useState(false);

  /* Cash In / Out modal state */
  const [showCashModal,  setShowCashModal]  = useState(false);
  const [cashModalType,  setCashModalType]  = useState("cash_in");
  const [cashAmount,     setCashAmount]     = useState("");
  const [cashReason,     setCashReason]     = useState("");
  const [cashSubmitting, setCashSubmitting] = useState(false);

  /* X-Read modal state */
  const [showXRead,    setShowXRead]    = useState(false);
  const [xReadData,    setXReadData]    = useState(null);
  const [loadingXRead, setLoadingXRead] = useState(false);

  /* Close-session modal state */
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeFloat,     setCloseFloat]     = useState("");
  const [closingSession, setClosingSession] = useState(false);

  /* Active company — used to detect company switches and reset POS state */
  const company   = useSelector(selectCurrentCompany);
  const companyId = company?._id;

  /* Totals */
  const subtotal      = round2(cart.reduce((s, l) => s + l.unitPrice * l.qty, 0));
  const totalLineDisc = round2(cart.reduce((s, l) => s + l.discount * l.qty, 0));
  const lineNet       = round2(subtotal - totalLineDisc);
  const cartDiscAmt   = cartDiscount.type === "percent"
    ? round2(lineNet * Math.min(100, Math.max(0, Number(cartDiscount.value || 0))) / 100)
    : round2(Math.max(0, Number(cartDiscount.value || 0)));
  const totalDisc     = round2(totalLineDisc + cartDiscAmt);
  const totalVat      = round2(cart.reduce((s, l) => s + round2((l.unitPrice - l.discount) * l.qty * (l.vatRate / 100)), 0));
  const grandTotal    = round2(lineNet - cartDiscAmt + totalVat);
  const payTotal      = round2(payments.reduce((s, p) => s + Number(p.amount || 0), 0));
  const change        = round2(Number(amountTendered || payTotal) - grandTotal);

  /* Global keyboard shortcuts (active when session is open) */
  useEffect(() => {
    if (!session) return;
    const handler = (e) => {
      // Don't fire if user is typing inside an input/textarea/select
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) {
        // Exception: F-keys always fire
        if (!e.key.startsWith("F")) return;
      }
      switch (e.key) {
        case "F1":
          e.preventDefault();
          scanRef.current?.focus();
          break;
        case "F2":
          e.preventDefault();
          if (cart.length && !showCheckout) {
            setPayments([{ method: "cash", amount: String(grandTotal) }]);
            setAmountTendered(String(grandTotal));
            setShowCheckout(true);
          }
          break;
        case "F3":
          e.preventDefault();
          if (cart.length && !showCheckout) {
            setPayments([{ method: "mpesa", amount: String(grandTotal) }]);
            setAmountTendered(String(grandTotal));
            setShowCheckout(true);
          }
          break;
        case "F4":
          e.preventDefault();
          if (cart.length && !showCheckout) {
            setPayments([{ method: "card", amount: String(grandTotal) }]);
            setAmountTendered(String(grandTotal));
            setShowCheckout(true);
          }
          break;
        case "F9":
          e.preventDefault();
          parkCart();
          break;
        case "F10":
          e.preventDefault();
          if (parkedCarts.length) setShowParked((v) => !v);
          break;
        case "Escape":
          setShowCheckout(false);
          setShowParked(false);
          setShowCashModal(false);
          setShowXRead(false);
          setShowCloseModal(false);
          scanRef.current?.focus();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [session, cart, grandTotal, showCheckout, parkCart, parkedCarts.length]);

  /* Reset ALL POS state when the active company changes (admin switching between companies) */
  useEffect(() => {
    setSession(null);
    setSelectedLocation("");
    setSelectedTill("");
    setTills([]);
    setLocations([]);
    setCart(emptyCart());
    setPayments(emptyPayment());
    setGridProducts([]);
    setCategories([]);
    setLastReceipt(null);
  }, [companyId]);

  /* Load locations */
  useEffect(() => {
    inventoryApi.listLocations({ active: true }).then((res) => {
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      setLocations(list);
      const def = list.find((l) => l.isDefault);
      if (def) setSelectedLocation(def._id);
    }).catch(() => {});
  }, [companyId]);

  /* Load tills when location changes */
  useEffect(() => {
    if (!selectedLocation) { setTills([]); setSelectedTill(""); return; }
    inventoryApi.listTills({ location: selectedLocation, active: true }).then((res) => {
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      setTills(list);
      if (list.length === 1) setSelectedTill(list[0]._id);
      else setSelectedTill("");
    }).catch(() => setTills([]));
  }, [selectedLocation]);

  /* Load active session when till changes */
  useEffect(() => {
    if (!selectedTill) { setSession(null); return; }
    setLoadingSession(true);
    inventoryApi.getActiveSession({ till: selectedTill })
      .then((res) => setSession(res?.data ?? res ?? null))
      .catch(() => setSession(null))
      .finally(() => setLoadingSession(false));
  }, [selectedTill]);

  /* Load categories once when session opens */
  useEffect(() => {
    if (!session) { setCategories([]); return; }
    inventoryApi.listCategories({ active: true })
      .then((res) => setCategories(Array.isArray(res) ? res : (res?.data ?? [])))
      .catch(() => {});
  }, [session]);

  /* Load products — server-side per category + stock qty for selected location */
  const loadProducts = useCallback(async (categoryId = "all") => {
    setLoadingGrid(true);
    try {
      const params = { active: true, limit: 150, location: selectedLocation };
      if (categoryId !== "all") params.category = categoryId;
      const res  = await inventoryApi.listProducts(params);
      setGridProducts(Array.isArray(res) ? res : (res?.data ?? []));
    } finally {
      setLoadingGrid(false);
    }
  }, [selectedLocation]);

  useEffect(() => {
    if (session) loadProducts(catFilter);
  }, [session, catFilter, loadProducts]);

  /* Debounced product search */
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res  = await inventoryApi.listProducts({ search: searchQuery, active: true, limit: 10 });
        const list = Array.isArray(res) ? res : (res?.data ?? []);
        setSearchResults(list);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  /* Products are already filtered server-side by category */
  const filteredProducts = gridProducts;

  /* Cart operations */
  const addToCart = useCallback((product) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === product._id);
      if (existing) {
        return prev.map((l) => l.productId === product._id ? { ...l, qty: round2(l.qty + 1) } : l);
      }
      setKeyCounter((k) => k + 1);
      return [...prev, {
        _key:        keyCounter + 1,
        productId:   product._id,
        productName: product.name,
        sku:         product.sku || "",
        unitPrice:   product.sellingPrice,
        costPrice:   product.costPrice || 0,
        vatRate:     product.vatRate || 0,
        discount:    0,
        qty:         1,
        trackStock:  product.trackStock !== false,
      }];
    });
    setSearchQuery("");
    setSearchResults([]);
    scanRef.current?.focus();
  }, [keyCounter]);

  /* Barcode scanner direct lookup — called when Enter fires after fast input */
  const handleScannerLookup = useCallback(async (barcode) => {
    const q = barcode.trim();
    if (!q) return;
    setSearchQuery("");
    setSearchResults([]);
    isScanRef.current = false;
    try {
      const product = await inventoryApi.lookupProduct(q);
      if (product) {
        addToCart(product);
        toast.success(`✓ ${product.name}`, { autoClose: 1200, position: "bottom-right" });
      } else {
        toast.error(`Barcode not found: ${q}`, { autoClose: 2500 });
        setSearchQuery(q); // fall back to search so cashier can still find it
      }
    } catch {
      toast.error(`Barcode not found: ${q}`, { autoClose: 2500 });
    }
  }, [addToCart]);

  /* onKeyDown for the search input — detects scanner vs keyboard */
  const handleSearchKeyDown = useCallback((e) => {
    const now = Date.now();
    const gap = now - lastKeyTimeRef.current;
    lastKeyTimeRef.current = now;

    if (e.key !== "Enter") {
      if (gap < 60) isScanRef.current = true;   // scanner speed
      else if (gap > 300) isScanRef.current = false; // reset on slow typing
      return;
    }

    // Enter pressed ─────────────────────────────────────────────────────────
    e.preventDefault();

    if (isScanRef.current && searchQuery.trim()) {
      // Barcode scanner path — bypass dropdown, go direct to API lookup
      handleScannerLookup(searchQuery);
      return;
    }

    // Manual typing path — add first search result if dropdown is visible
    if (searchResults.length > 0) {
      addToCart(searchResults[0]);
      setSearchQuery("");
      setSearchResults([]);
    }
  }, [searchQuery, searchResults, addToCart, handleScannerLookup]);

  const updateQty      = (key, qty) => {
    if (qty <= 0) setCart((c) => c.filter((l) => l._key !== key));
    else          setCart((c) => c.map((l) => l._key === key ? { ...l, qty } : l));
  };
  const updateDiscount  = (key, discount) => setCart((c) => c.map((l) => l._key === key ? { ...l, discount: Math.max(0, discount) } : l));
  const removeFromCart  = (key) => setCart((c) => c.filter((l) => l._key !== key));
  const clearCart       = () => {
    setCart(emptyCart()); setPayments(emptyPayment()); setAmountTendered("");
    setCustomerName(""); setCustomerPhone(""); setNotes("");
    setCartDiscount({ type: "amount", value: "" }); setOrderRef("");
  };

  /* Park current cart (hold) */
  const parkCart = useCallback(() => {
    if (!cart.length) return;
    const id = Date.now();
    const label = orderRef.trim() || customerName.trim() || `Hold #${parkedCarts.length + 1}`;
    setParkedCarts((prev) => [
      ...prev,
      { id, label, cart, payments, customerName, customerPhone, notes, cartDiscount, orderRef, parkedAt: new Date() },
    ]);
    clearCart();
    toast.info(`Cart parked as "${label}"`, { autoClose: 1500 });
  }, [cart, payments, customerName, customerPhone, notes, cartDiscount, orderRef, parkedCarts.length]);

  /* Resume a parked cart */
  const resumeCart = useCallback((parked) => {
    if (cart.length) {
      const id = Date.now();
      const label = orderRef.trim() || customerName.trim() || `Hold #${parkedCarts.length + 1}`;
      setParkedCarts((prev) =>
        prev
          .filter((p) => p.id !== parked.id)
          .concat({ id, label, cart, payments, customerName, customerPhone, notes, cartDiscount, orderRef, parkedAt: new Date() })
      );
    } else {
      setParkedCarts((prev) => prev.filter((p) => p.id !== parked.id));
    }
    setCart(parked.cart);
    setPayments(parked.payments ?? emptyPayment());
    setCustomerName(parked.customerName ?? "");
    setCustomerPhone(parked.customerPhone ?? "");
    setNotes(parked.notes ?? "");
    setCartDiscount(parked.cartDiscount ?? { type: "amount", value: "" });
    setOrderRef(parked.orderRef ?? "");
    setShowParked(false);
    toast.success(`Resumed: ${parked.label}`, { autoClose: 1200 });
  }, [cart, payments, customerName, customerPhone, notes, cartDiscount, orderRef, parkedCarts.length]);

  /* Discard a parked cart */
  const discardParked = useCallback((id) => {
    setParkedCarts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  /* Payment operations */
  const addPaymentLine    = () => setPayments((p) => [...p, { method: "cash", amount: "" }]);
  const removePaymentLine = (idx) => setPayments((p) => p.filter((_, i) => i !== idx));
  const setPayLine        = (idx, field, value) => setPayments((p) => p.map((l, i) => i === idx ? { ...l, [field]: value } : l));

  /* Session operations */
  const handleOpenSession = async () => {
    try {
      const s = await inventoryApi.openSession({ till: selectedTill, openingFloat: Number(openingFloat || 0) });
      setSession(s?.data ?? s);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to open session");
    }
  };

  const handleCloseSession = () => {
    setCloseFloat("");
    setShowCloseModal(true);
  };

  const confirmCloseSession = async () => {
    setClosingSession(true);
    try {
      await inventoryApi.closeSession(session._id, { closingFloat: Number(closeFloat || 0) });
      setShowCloseModal(false);
      setSession(null);
      setGridProducts([]);
      setCategories([]);
      setCart(emptyCart());
      toast.success("Session closed");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to close session");
    } finally {
      setClosingSession(false);
    }
  };

  /* Cash In / Out */
  const openCashIn  = () => { setCashModalType("cash_in");  setCashAmount(""); setCashReason(""); setShowCashModal(true); };
  const openCashOut = () => { setCashModalType("cash_out"); setCashAmount(""); setCashReason(""); setShowCashModal(true); };

  const handleCashMovement = async () => {
    const amt = Number(cashAmount);
    if (!amt || amt <= 0) { toast.error("Amount must be greater than zero"); return; }
    setCashSubmitting(true);
    try {
      if (cashModalType === "cash_in") {
        await inventoryApi.cashIn(session._id, { amount: amt, reason: cashReason });
      } else {
        await inventoryApi.cashOut(session._id, { amount: amt, reason: cashReason });
      }
      toast.success(cashModalType === "cash_in" ? "Cash in recorded" : "Cash out recorded");
      setShowCashModal(false);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to record movement");
    } finally {
      setCashSubmitting(false);
    }
  };

  /* X-Read */
  const handleXRead = async () => {
    setXReadData(null);
    setShowXRead(true);
    setLoadingXRead(true);
    try {
      const res = await inventoryApi.getXRead(session._id);
      setXReadData(res?.data ?? res);
    } catch {
      setXReadData(null);
    } finally {
      setLoadingXRead(false);
    }
  };

  /* Checkout */
  const handleCheckout = async () => {
    if (!cart.length) return;
    if (payTotal < grandTotal) {
      toast.error(`Short by ${formatMoney(grandTotal - payTotal)} — adjust payment amount`);
      return;
    }
    setSubmitting(true);
    try {
      // Distribute cart-level discount proportionally across lines
      const lineNetTotal = round2(cart.reduce((s, l) => s + (l.unitPrice - l.discount) * l.qty, 0));
      const saleLines = cart.map((l) => {
        let effectiveDiscount = l.discount;
        if (cartDiscAmt > 0 && lineNetTotal > 0) {
          const lineNet   = round2((l.unitPrice - l.discount) * l.qty);
          const lineShare = round2(cartDiscAmt * lineNet / lineNetTotal);
          effectiveDiscount = round2(l.discount + (l.qty > 0 ? lineShare / l.qty : 0));
        }
        return { product: l.productId, qty: l.qty, unitPrice: l.unitPrice, discount: effectiveDiscount, vatRate: l.vatRate };
      });

      const sale = await inventoryApi.createSale({
        location:       selectedLocation,
        session:        session._id,
        lines:          saleLines,
        payments:       payments.map((p) => ({ method: p.method, amount: Number(p.amount || 0) })),
        customerName,
        customerPhone,
        amountTendered: Number(amountTendered || payTotal),
        notes:          [notes, orderRef ? `Ref: ${orderRef}` : ""].filter(Boolean).join(" | "),
      });
      const receipt = sale?.data ?? sale;
      setLastReceipt(receipt);
      setShowReceipt(true);
      clearCart();
      setShowCheckout(false);
      toast.success("Sale posted successfully");
      printReceipt(receipt, company, { locationName, tillName });
    } catch (err) {
      const msg = err?.response?.data?.message || "Sale failed";
      toast.error(msg);
      if (msg.toLowerCase().includes("session")) {
        setSession(null);
        setShowCheckout(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Pre-session screens ── */
  if (!selectedLocation || !selectedTill) {
    return (
      <DashboardLayout lockContentScroll>
        <div className="flex h-full flex-col items-center justify-center gap-4 bg-[#0B3B2E] p-6">
          <FaCashRegister className="text-6xl text-emerald-400" />
          <h1 className="text-xl font-extrabold text-white">POS Terminal</h1>
          <div className="w-full max-w-xs space-y-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-emerald-300">1. Select Location</label>
              <AppSelect value={selectedLocation} onChange={(v) => setSelectedLocation(v ?? "")} options={locations.map((l) => ({ value: l._id, label: l.name }))} placeholder="— Choose location —" size="md" />
              {selectedLocation && !tills.length && (
                <p className="mt-1 text-center text-[11px] text-amber-300">
                  No tills at this location. Add one in Setup → Tills.
                </p>
              )}
            </div>
            {selectedLocation && tills.length > 0 && (
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-emerald-300">2. Select Till / Register</label>
                <AppSelect value={selectedTill} onChange={(v) => setSelectedTill(v ?? "")} options={tills.map((t) => ({ value: t._id, label: t.name }))} placeholder="— Choose till —" size="md" />
              </div>
            )}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (loadingSession) {
    return (
      <DashboardLayout lockContentScroll>
        <div className="flex h-full items-center justify-center bg-[#0B3B2E] text-white">Loading session…</div>
      </DashboardLayout>
    );
  }

  if (!session) {
    const tillName = tills.find((t) => t._id === selectedTill)?.name || "";
    const locName  = locations.find((l) => l._id === selectedLocation)?.name || "";
    return (
      <DashboardLayout lockContentScroll>
        <div className="flex h-full flex-col items-center justify-center gap-4 bg-[#0B3B2E] p-6">
          <FaCashRegister className="text-6xl text-emerald-400" />
          <h1 className="text-lg font-extrabold text-white">Open Session</h1>
          <p className="text-sm text-emerald-300">{locName} — <strong>{tillName}</strong></p>
          <div className="flex w-full max-w-xs flex-col gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-emerald-300">Opening Float (KES)</label>
              <input type="number" min="0" value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)}
                className="w-full bg-white px-3 py-2 text-sm outline-none" placeholder="0.00" />
              <p className="mt-1 text-[10px] text-emerald-400/70">Count the cash in the drawer and enter the amount.</p>
            </div>
            <button onClick={handleOpenSession} className="bg-emerald-500 py-2 text-sm font-extrabold text-white hover:bg-emerald-400">
              Open Session
            </button>
            <button onClick={() => setSelectedTill("")} className="text-xs text-emerald-300 hover:text-white">← Change Till</button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const locationName = locations.find((l) => l._id === selectedLocation)?.name || "";
  const tillName     = session.till?.name || tills.find((t) => t._id === selectedTill)?.name || "";

  /* ── Active cashier UI ── */
  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full overflow-hidden bg-[#F4F7F5]">

        {/* ── Left: Cart ─────────────────────────────────────────── */}
        <div className="flex w-[420px] shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-[#0B3B2E] px-3 py-2">
            <div className="flex items-center gap-2">
              <FaCashRegister className="text-emerald-400" />
              <span className="text-xs font-extrabold text-white">{locationName}</span>
              <span className="text-[10px] text-emerald-300">· {tillName}</span>
              <span className="text-[10px] text-emerald-300/60">#{session.sessionNumber}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={openCashIn}  className="border border-emerald-600/60 px-2 py-1 text-[10px] font-bold text-emerald-300 hover:bg-emerald-900/60">Cash In</button>
              <button onClick={openCashOut} className="border border-amber-500/50 px-2 py-1 text-[10px] font-bold text-amber-300 hover:bg-amber-900/30">Cash Out</button>
              <button onClick={handleXRead} className="border border-slate-500/50 px-2 py-1 text-[10px] font-bold text-slate-300 hover:bg-slate-700/30">X-Read</button>
              <button onClick={() => navigate("/pos/sales")} className="border border-emerald-700 px-2 py-1 text-[10px] font-bold text-emerald-300 hover:bg-emerald-900">Sales</button>
              <button onClick={handleCloseSession} className="border border-red-400/50 px-2 py-1 text-[10px] font-bold text-red-300 hover:bg-red-900/30">Close</button>
            </div>
          </div>

          {/* Search */}
          <div className="relative border-b border-slate-200 bg-white px-2 py-2">
            <div className="flex items-center gap-2 border border-slate-300 bg-white px-2.5 py-1.5 focus-within:border-[#0B3B2E]">
              <FaBarcode className="text-slate-400 text-xs shrink-0" />
              <input
                ref={scanRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search name / SKU or scan barcode → Enter"
                className="flex-1 text-sm outline-none"
                autoFocus
              />
              {searching && <span className="text-[10px] text-slate-400">Searching…</span>}
              {searchResults.length > 0 && !searching && (
                <span className="shrink-0 text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5">
                  Enter ↵ to add first
                </span>
              )}
              {searchQuery && (
                <button onClick={() => { setSearchQuery(""); setSearchResults([]); isScanRef.current = false; }}><FaTimes className="text-slate-400 text-xs" /></button>
              )}
            </div>
            {searchResults.length > 0 && (
              <div className="absolute left-2 right-2 top-full z-20 border border-slate-200 bg-white shadow-lg max-h-64 overflow-y-auto">
                {searchResults.map((p) => <ProductSearchRow key={p._id} product={p} onAdd={addToCart} />)}
              </div>
            )}
          </div>

          {/* Cart items — min-h-0 prevents flex overflow pushing footer off-screen */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {!cart.length ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-300">
                <FaBarcode className="text-4xl" />
                <span className="text-sm font-semibold text-slate-400">Cart is empty</span>
                <span className="text-xs text-slate-400">Search or click a product →</span>
              </div>
            ) : cart.map((line) => (
              <CartLine key={line._key} line={line} onQtyChange={updateQty} onRemove={removeFromCart} onDiscountChange={updateDiscount} />
            ))}
          </div>

          {/* Totals + Charge — shrink-0 keeps it always visible */}
          <div className="shrink-0 border-t-2 border-slate-200 bg-white px-3 pt-2 pb-2">
            {/* Breakdown rows — compact, only shown when relevant */}
            {cart.length > 0 && (
              <div className="mb-1.5 space-y-0.5">
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>Subtotal</span><span className="font-semibold">{formatMoney(subtotal)}</span>
                </div>
                {totalLineDisc > 0 && (
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>Line discounts</span>
                    <span className="font-semibold text-red-500">-{formatMoney(totalLineDisc)}</span>
                  </div>
                )}
                {/* Cart-level discount row */}
                <div className="flex items-center gap-1 text-[11px]">
                  <span className="text-slate-500 shrink-0">Bill disc.</span>
                  <div className="flex flex-1 items-center gap-1 justify-end">
                    <button
                      type="button"
                      onClick={() => setCartDiscount((d) => ({ ...d, type: d.type === "percent" ? "amount" : "percent", value: "" }))}
                      className="shrink-0 border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold text-slate-600 hover:bg-slate-100"
                    >
                      {cartDiscount.type === "percent" ? "%" : "KES"}
                    </button>
                    <input
                      type="number" min="0" step="0.01"
                      value={cartDiscount.value}
                      onChange={(e) => setCartDiscount((d) => ({ ...d, value: e.target.value }))}
                      placeholder="0"
                      className="w-20 border border-slate-200 px-1.5 py-0.5 text-right text-[11px] outline-none focus:border-[#0B3B2E]"
                    />
                    {cartDiscAmt > 0 && (
                      <span className="shrink-0 font-semibold text-red-500">-{formatMoney(cartDiscAmt)}</span>
                    )}
                  </div>
                </div>
                {totalVat > 0 && (
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>VAT</span><span className="font-semibold">{formatMoney(totalVat)}</span>
                  </div>
                )}
              </div>
            )}
            {/* Total row + clear + hold */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <button onClick={clearCart} disabled={!cart.length} className="flex items-center gap-1 text-[11px] font-bold text-red-400 hover:text-red-600 disabled:opacity-30">
                  <FaTrash className="text-[9px]" /> Clear
                </button>
                <button
                  onClick={parkCart}
                  disabled={!cart.length}
                  title="Park this cart and start a new one (Hold)"
                  className="flex items-center gap-1 text-[11px] font-bold text-amber-600 hover:text-amber-700 disabled:opacity-30"
                >
                  <FaPause className="text-[9px]" /> Hold
                </button>
                {parkedCarts.length > 0 && (
                  <button
                    onClick={() => setShowParked((v) => !v)}
                    className="flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-700"
                  >
                    <FaPlay className="text-[9px]" />
                    Resume
                    <span className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[9px] font-black text-white">
                      {parkedCarts.length}
                    </span>
                  </button>
                )}
              </div>
              <span className="text-xl font-extrabold text-[#0B3B2E]">{formatMoney(grandTotal)}</span>
            </div>
            {/* Charge button — always prominent */}
            <button
              onClick={() => { if (cart.length) { setPayments([{ method: "cash", amount: String(grandTotal) }]); setAmountTendered(String(grandTotal)); setShowCheckout(true); } }}
              disabled={!cart.length}
              className="w-full bg-[#0B3B2E] py-3 text-sm font-extrabold text-white hover:bg-[#0A3127] disabled:bg-slate-200 disabled:text-slate-400 transition-colors"
            >
              {cart.length ? `Charge — ${formatMoney(grandTotal)}` : "Add items to charge"}
            </button>
          </div>
        </div>

        {/* ── Right: Product Catalog ──────────────────────────────── */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Last receipt strip */}
          {lastReceipt && (
            <div className="border-b border-emerald-200 bg-emerald-50">
              <button
                type="button"
                onClick={() => setShowReceipt((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left"
              >
                <span className="text-xs font-bold text-emerald-700">
                  ✓ Sale posted — {lastReceipt.receiptNumber} · {formatMoney(lastReceipt.grandTotal)}
                </span>
                <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                  {showReceipt ? <><FaChevronUp className="text-[8px]" /> Hide</> : <><FaChevronDown className="text-[8px]" /> Details</>}
                </span>
              </button>
              {showReceipt && (
                <div className="border-t border-emerald-200 bg-white px-3 py-2 text-[10px] text-slate-600">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-mono font-bold text-[#0B3B2E]">{lastReceipt.receiptNumber}</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => printReceipt(lastReceipt, company, { locationName, tillName })}
                        className="flex items-center gap-1 border border-slate-200 px-2 py-0.5 text-[9px] font-bold text-slate-600 hover:bg-slate-50"
                      >
                        <FaPrint className="text-[8px]" /> Print
                      </button>
                      <button onClick={() => { setLastReceipt(null); setShowReceipt(false); }} className="text-slate-400 hover:text-slate-600">
                        <FaTimes className="text-[9px]" />
                      </button>
                    </div>
                  </div>
                  {lastReceipt.lines?.map((l, i) => (
                    <div key={i} className="flex justify-between py-0.5">
                      <span className="truncate pr-2">{l.productName} ×{l.qty}</span>
                      <span className="font-bold">{formatMoney(l.lineTotal)}</span>
                    </div>
                  ))}
                  <div className="mt-1 flex justify-between border-t border-slate-100 pt-1 font-bold text-slate-800">
                    <span>Change</span><span>{formatMoney(lastReceipt.change)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Category filter */}
          <div className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-200 bg-white px-2 py-1.5 scrollbar-none">
            <button
              type="button"
              onClick={() => setCatFilter("all")}
              className={`shrink-0 border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors ${catFilter === "all" ? "border-[#0B3B2E] bg-[#0B3B2E] text-white" : "border-slate-200 text-slate-600 hover:border-[#0B3B2E] hover:text-[#0B3B2E]"}`}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat._id}
                type="button"
                onClick={() => setCatFilter(cat._id)}
                className={`shrink-0 border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors ${catFilter === cat._id ? "border-[#0B3B2E] bg-[#0B3B2E] text-white" : "border-slate-200 text-slate-600 hover:border-[#0B3B2E] hover:text-[#0B3B2E]"}`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Product grid */}
          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            {loadingGrid ? (
              <div className="flex items-center justify-center py-16 text-sm text-slate-400">Loading products…</div>
            ) : !filteredProducts.length ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-400">
                <FaBarcode className="text-3xl" />
                <p className="text-sm font-semibold">No products found</p>
                {catFilter !== "all" && (
                  <button type="button" onClick={() => setCatFilter("all")} className="text-xs text-[#0B3B2E] hover:underline">Clear category filter</button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {filteredProducts.map((p) => (
                  <ProductCard key={p._id} product={p} onAdd={addToCart} />
                ))}
              </div>
            )}
          </div>

          {/* Shortcut bar */}
          <div className="border-t border-slate-200 bg-slate-50 px-3 py-1 flex items-center justify-between">
            <span className="text-[10px] text-slate-500">
              {filteredProducts.length} product{filteredProducts.length !== 1 ? "s" : ""}
              {catFilter !== "all" && " in category"} · {cart.length} in cart
            </span>
            <span className="hidden lg:flex items-center gap-2 text-[9px] font-mono text-slate-400">
              <span><kbd className="rounded border border-slate-200 bg-white px-1 py-0.5">F1</kbd> Search</span>
              <span><kbd className="rounded border border-slate-200 bg-white px-1 py-0.5">F2</kbd> Cash</span>
              <span><kbd className="rounded border border-slate-200 bg-white px-1 py-0.5">F3</kbd> M-Pesa</span>
              <span><kbd className="rounded border border-slate-200 bg-white px-1 py-0.5">F4</kbd> Card</span>
              <span><kbd className="rounded border border-slate-200 bg-white px-1 py-0.5">F9</kbd> Hold</span>
              <span><kbd className="rounded border border-slate-200 bg-white px-1 py-0.5">Esc</kbd> Cancel</span>
            </span>
          </div>
        </div>
      </div>

      {/* ── Close Session modal ────────────────────────────────────── */}
      {showCloseModal && session && (
        <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="w-full max-w-sm border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-red-700 px-4 py-3 text-white">
              <h2 className="text-sm font-extrabold uppercase tracking-wide">Close Session — #{session.sessionNumber}</h2>
              <button type="button" onClick={() => setShowCloseModal(false)} className="p-1 text-white/80 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-slate-600">
                <strong>{tillName}</strong> · {locationName} — count the cash in the drawer and enter the total below.
              </p>
              <div>
                <label className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Closing Float (KES)</label>
                <input
                  type="number" min="0" step="0.01" autoFocus
                  value={closeFloat} onChange={(e) => setCloseFloat(e.target.value)} placeholder="0.00"
                  className="h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none"
                />
              </div>
              <div className="rounded border border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                Once closed, no further sales can be posted until a new session is opened on this till.
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button type="button" onClick={() => setShowCloseModal(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
              <button type="button" onClick={confirmCloseSession} disabled={closingSession} className="bg-red-700 px-4 py-2 text-xs font-bold text-white hover:bg-red-800 disabled:opacity-50">
                {closingSession ? "Closing…" : "Close Session"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cash In / Out modal ────────────────────────────────────── */}
      {showCashModal && (
        <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="w-full max-w-sm border border-slate-200 bg-white shadow-2xl">
            <div className={`flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 text-white ${cashModalType === "cash_in" ? "bg-emerald-700" : "bg-amber-700"}`}>
              <h2 className="text-sm font-extrabold uppercase tracking-wide">
                {cashModalType === "cash_in" ? "Cash In" : "Cash Out"} — #{session.sessionNumber}
              </h2>
              <button type="button" onClick={() => setShowCashModal(false)} className="p-1 text-white/80 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-slate-500">{tillName} · Record cash {cashModalType === "cash_in" ? "added to" : "removed from"} the drawer outside of sales.</p>
              <div>
                <label className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Amount (KES) *</label>
                <input
                  type="number" min="0.01" step="0.01" autoFocus
                  value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} placeholder="0.00"
                  className="h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Reason</label>
                <input
                  value={cashReason} onChange={(e) => setCashReason(e.target.value)}
                  placeholder={cashModalType === "cash_in" ? "e.g. Petty cash top-up" : "e.g. Supplier payment, banking"}
                  className="h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button type="button" onClick={() => setShowCashModal(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
              <button
                type="button" onClick={handleCashMovement} disabled={cashSubmitting}
                className={`px-4 py-2 text-xs font-bold text-white disabled:opacity-50 ${cashModalType === "cash_in" ? "bg-emerald-700 hover:bg-emerald-800" : "bg-amber-700 hover:bg-amber-800"}`}
              >
                {cashSubmitting ? "Saving…" : cashModalType === "cash_in" ? "Record Cash In" : "Record Cash Out"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── X-Read modal ───────────────────────────────────────────── */}
      {showXRead && (
        <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="w-full max-w-lg border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
              <h2 className="text-sm font-extrabold uppercase tracking-wide">
                X-Read — {xReadData?.session?.sessionNumber || session.sessionNumber}
              </h2>
              <button type="button" onClick={() => setShowXRead(false)} className="p-1 text-white/80 hover:bg-white/10"><FaTimes /></button>
            </div>
            {loadingXRead ? (
              <div className="flex items-center justify-center py-12 text-sm text-slate-400">Loading…</div>
            ) : xReadData ? (
              <>
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-[11px] text-slate-600">
                  {xReadData.session.location?.name} · <strong>{xReadData.session.till?.name}</strong> · {xReadData.session.openedBy?.name}
                  <span className="ml-2 text-slate-400">Opened {fmtDateTime(xReadData.session.openedAt)}</span>
                </div>
                <div className="divide-y divide-slate-100 px-4 py-3 space-y-3">
                  {/* Cash summary */}
                  <div>
                    <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">Cash Summary</p>
                    <XReadRow label="Opening Float" value={xReadData.summary.openingFloat} />
                    <XReadRow label="Cash Sales"    value={xReadData.summary.cashSales} />
                    {xReadData.summary.totalCashIn  > 0 && <XReadRow label="(+) Cash In"  value={xReadData.summary.totalCashIn} />}
                    {xReadData.summary.totalCashOut > 0 && <XReadRow label="(−) Cash Out" value={xReadData.summary.totalCashOut} neg />}
                    <div className="mt-1 border-t border-slate-200 pt-1">
                      <XReadRow label="Expected Cash" value={xReadData.summary.expectedCash} bold />
                    </div>
                  </div>
                  {/* Sales summary */}
                  <div className="pt-2">
                    <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">Sales Summary</p>
                    {xReadData.summary.cashSales  > 0 && <XReadRow label="Cash"   value={xReadData.summary.cashSales} />}
                    {xReadData.summary.mpesaSales > 0 && <XReadRow label="M-Pesa" value={xReadData.summary.mpesaSales} />}
                    {xReadData.summary.cardSales  > 0 && <XReadRow label="Card"   value={xReadData.summary.cardSales} />}
                    <div className="mt-1 border-t border-slate-200 pt-1">
                      <XReadRow label="Total Sales" value={xReadData.summary.totalSales} bold />
                    </div>
                    <div className="flex justify-between py-0.5 text-[11px] text-slate-600">
                      <span>Sales Count</span>
                      <span className="font-bold text-slate-800">{xReadData.summary.salesCount}</span>
                    </div>
                    {xReadData.summary.voidCount > 0 && (
                      <div className="flex justify-between py-0.5 text-[11px] text-slate-600">
                        <span>Voids</span>
                        <span className="font-bold text-red-600">{xReadData.summary.voidCount}</span>
                      </div>
                    )}
                  </div>
                  {/* Movements log */}
                  {xReadData.movements?.length > 0 && (
                    <div className="pt-2">
                      <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">Movements Log</p>
                      <table className="w-full text-[10px]">
                        <thead>
                          <tr className="text-left text-slate-400">
                            <th className="pb-1 font-bold">Type</th>
                            <th className="pb-1 font-bold text-right">Amount</th>
                            <th className="pb-1 font-bold">Reason</th>
                            <th className="pb-1 font-bold whitespace-nowrap">Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {xReadData.movements.map((m) => (
                            <tr key={m._id} className="border-t border-slate-100">
                              <td className="py-0.5 capitalize text-slate-700 font-semibold">{m.type.replace(/_/g, " ")}</td>
                              <td className={`py-0.5 text-right font-bold ${m.type === "cash_out" ? "text-red-600" : "text-emerald-700"}`}>
                                {m.type === "cash_out" ? "−" : ""}{formatMoney(m.amount)}
                              </td>
                              <td className="py-0.5 text-slate-500">{m.reason || "—"}</td>
                              <td className="py-0.5 text-slate-400 whitespace-nowrap">{fmtDateTime(m.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center py-12 text-sm text-slate-400">Failed to load X-Read data.</div>
            )}
            <div className="flex justify-between border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center gap-1.5 border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
              >
                <FaPrint className="text-[10px]" /> Print Report
              </button>
              <button type="button" onClick={() => setShowXRead(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Parked Carts modal ────────────────────────────────────── */}
      {showParked && (
        <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="w-full max-w-md border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-amber-600 px-4 py-3 text-white">
              <h2 className="text-sm font-extrabold uppercase tracking-wide">
                <FaPause className="inline mr-1.5 text-xs" />
                Parked Carts — {parkedCarts.length}
              </h2>
              <button type="button" onClick={() => setShowParked(false)} className="p-1 text-white/80 hover:bg-white/10">
                <FaTimes />
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {parkedCarts.map((p) => {
                const total = p.cart.reduce((s, l) => s + (l.unitPrice - l.discount) * l.qty, 0);
                const elapsed = Math.round((Date.now() - new Date(p.parkedAt).getTime()) / 60000);
                return (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-slate-800">{p.label}</div>
                      <div className="text-[10px] text-slate-400">
                        {p.cart.length} item{p.cart.length !== 1 ? "s" : ""} · {formatMoney(total)} · {elapsed < 1 ? "just now" : `${elapsed}m ago`}
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-500 truncate">
                        {p.cart.slice(0, 3).map((l) => l.productName).join(", ")}
                        {p.cart.length > 3 ? ` +${p.cart.length - 3} more` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => resumeCart(p)}
                        className="flex items-center gap-1 bg-[#0B3B2E] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#0A3127]"
                      >
                        <FaPlay className="text-[9px]" /> Resume
                      </button>
                      <button
                        onClick={() => discardParked(p.id)}
                        className="flex items-center gap-1 border border-red-200 px-2 py-1.5 text-[11px] font-bold text-red-500 hover:bg-red-50"
                        title="Discard this parked cart"
                      >
                        <FaTrash className="text-[9px]" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-center">
              <button
                type="button"
                onClick={() => setShowParked(false)}
                className="text-xs font-bold text-slate-500 hover:text-slate-700"
              >
                Close — keep shopping
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Checkout modal ─────────────────────────────────────────── */}
      {showCheckout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-[#0B3B2E] px-4 py-3">
              <span className="text-sm font-extrabold text-white">Checkout — {formatMoney(grandTotal)}</span>
              <button onClick={() => setShowCheckout(false)}><FaTimes className="text-slate-300" /></button>
            </div>
            <div className="p-4 space-y-3">
              {/* Customer + Order Ref */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Customer Name</label>
                  <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="w-full border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#0B3B2E]" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Phone</label>
                  <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className="w-full border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#0B3B2E]" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Order / Table / Room Ref <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  value={orderRef}
                  onChange={(e) => setOrderRef(e.target.value)}
                  placeholder="e.g. Table 4, Room 12, Order #001"
                  className="w-full border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#0B3B2E]"
                />
              </div>

              {/* Payments */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Payment</label>
                  <button type="button" onClick={addPaymentLine} className="text-[10px] font-bold text-[#0B3B2E] hover:underline">+ Add Method</button>
                </div>
                {payments.map((p, idx) => (
                  <div key={idx} className="mb-1.5 flex items-center gap-2">
                    <AppSelect value={p.method} onChange={(v) => setPayLine(idx, "method", v ?? "")} options={METHODS.map((m) => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) }))} size="sm" />
                    <input type="number" min="0" step="0.01" value={p.amount} onChange={(e) => setPayLine(idx, "amount", e.target.value)}
                      className="flex-1 border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-[#0B3B2E]" placeholder="Amount" />
                    {payments.length > 1 && (
                      <button onClick={() => removePaymentLine(idx)}><FaTimes className="text-red-400 text-xs" /></button>
                    )}
                  </div>
                ))}
              </div>

              {/* Tendered & Change */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Amount Tendered</label>
                  <input type="number" min="0" step="0.01" value={amountTendered} onChange={(e) => setAmountTendered(e.target.value)}
                    className="w-full border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#0B3B2E]" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Change</label>
                  <div className={`border px-2.5 py-1.5 text-xs font-extrabold ${change < 0 ? "border-red-300 text-red-600 bg-red-50" : "border-emerald-300 text-emerald-700 bg-emerald-50"}`}>
                    {formatMoney(Math.max(0, change))}
                  </div>
                </div>
              </div>

              {payTotal < grandTotal && (
                <div className="text-xs font-bold text-red-600">Short by {formatMoney(grandTotal - payTotal)}</div>
              )}

              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Notes</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#0B3B2E]" />
              </div>

              <button
                onClick={handleCheckout}
                disabled={submitting || payTotal < grandTotal}
                className="flex w-full items-center justify-center gap-2 bg-[#0B3B2E] py-3 text-sm font-extrabold text-white hover:bg-[#0A3127] disabled:opacity-50"
              >
                <FaCheck />
                {submitting ? "Processing…" : `Complete Sale — ${formatMoney(grandTotal)}`}
              </button>
              <p className="text-center text-[10px] text-slate-400">
                A receipt will print automatically after completing the sale.
              </p>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default POSTerminal;
