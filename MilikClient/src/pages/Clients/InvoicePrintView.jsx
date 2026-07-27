import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { selectCurrentCompany } from '../../redux/selectors';
import { clientsApi } from '../../services/clientsApi';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtKES = (n) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 2 }).format(Number(n) || 0);

const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString('en-KE', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';

const STATUS_COLORS = {
  paid:      { bg: '#d1fae5', border: '#6ee7b7', text: '#065f46' },
  partial:   { bg: '#fef3c7', border: '#fcd34d', text: '#92400e' },
  overdue:   { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b' },
  cancelled: { bg: '#f1f5f9', border: '#cbd5e1', text: '#475569' },
  sent:      { bg: '#eff6ff', border: '#93c5fd', text: '#1e40af' },
  draft:     { bg: '#f8fafc', border: '#e2e8f0', text: '#64748b' },
};

// ─── Print Styles ─────────────────────────────────────────────────────────────

const PRINT_STYLES = `
  @page { size: A4; margin: 18mm 16mm; }

  @media print {
    html, body { height: auto !important; overflow: visible !important; }

    /* Hide all app chrome */
    body > * { visibility: hidden !important; }
    #invoice-print-root,
    #invoice-print-root * { visibility: visible !important; }

    /* Hide the floating toolbar */
    #invoice-toolbar { display: none !important; }

    /* Reset the container to fill the page */
    #invoice-print-root {
      position: fixed !important;
      inset: 0 !important;
      background: white !important;
    }
  }
`;

// ─── Component ────────────────────────────────────────────────────────────────

const InvoicePrintView = () => {
  const { id }     = useParams();
  const navigate   = useNavigate();
  const company    = useSelector(selectCurrentCompany);
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const styleRef = useRef(null);

  // Inject print styles once
  useEffect(() => {
    const el = document.createElement('style');
    el.textContent = PRINT_STYLES;
    document.head.appendChild(el);
    styleRef.current = el;
    return () => el.remove();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await clientsApi.getInvoice(id);
      setInvoice(data?.invoice || data?.data || data || null);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load invoice');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handlePrint = () => window.print();

  // ── Loading / Error ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-[#027333]" />
          <span className="text-xs font-semibold text-slate-400 tracking-widest uppercase">Loading Invoice</span>
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-slate-50">
        <p className="text-sm font-semibold text-red-600">{error || 'Invoice not found'}</p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          ← Go back
        </button>
      </div>
    );
  }

  // ── Derived values ──────────────────────────────────────────────────────────
  const client       = invoice.client   || {};
  const contract     = invoice.contract || {};
  const lineItems    = invoice.lineItems || [];
  const subtotal     = invoice.subtotal     || lineItems.reduce((s, l) => s + (l.quantity || 1) * (l.unitPrice || 0), 0);
  const vatRate      = invoice.vatRate      ?? 16;
  const vatAmount    = invoice.vatAmount    ?? (subtotal * vatRate) / 100;
  const total        = invoice.total        || subtotal + vatAmount;
  const paidAmount   = invoice.paidAmount   || 0;
  const balance      = total - paidAmount;
  const isPaid       = invoice.status === 'paid';
  const statusColor  = STATUS_COLORS[invoice.status] || STATUS_COLORS.draft;

  const companyName  = company?.name || '';
  const resolveAddr  = (a) => typeof a === 'string' ? a : [a?.line1 || a?.street, a?.city, a?.country].filter(Boolean).join(', ');
  const companyAddr  = resolveAddr(company?.address);
  const companyPhone = company?.phone || company?.contact?.phone || '';
  const companyEmail = company?.email || company?.contact?.email || '';
  const companyPin   = company?.kraPin || company?.taxPin || '';
  const companyLogo  = company?.logo || null;

  return (
    <>
      {/* ── Floating toolbar (hidden on print) ─────────────────────────────── */}
      <div
        id="invoice-toolbar"
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-4 py-3 shadow-2xl"
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/80 hover:text-white hover:border-white/50 transition-colors"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={handlePrint}
          className="rounded bg-white px-4 py-1.5 text-xs font-bold text-[#0B3B2E] hover:bg-slate-100 transition-colors"
        >
          Print / Save PDF
        </button>
      </div>

      {/* ── Print root ─────────────────────────────────────────────────────── */}
      <div
        id="invoice-print-root"
        style={{
          fontFamily: "'Segoe UI', Arial, sans-serif",
          fontSize: '11px',
          color: '#1e293b',
          background: 'white',
          minHeight: '100vh',
          padding: '32px 40px',
          maxWidth: '900px',
          margin: '0 auto',
          position: 'relative',
        }}
      >
        {/* PAID watermark */}
        {isPaid && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%) rotate(-30deg)',
              fontSize: '110px',
              fontWeight: 900,
              color: 'rgba(16,185,129,0.07)',
              letterSpacing: '0.05em',
              pointerEvents: 'none',
              userSelect: 'none',
              zIndex: 0,
              whiteSpace: 'nowrap',
            }}
          >
            PAID
          </div>
        )}

        <div style={{ position: 'relative', zIndex: 1 }}>

          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
            {/* Company info */}
            <div style={{ flex: 1 }}>
              {companyLogo ? (
                <img
                  src={companyLogo}
                  alt={companyName}
                  style={{ height: '48px', objectFit: 'contain', marginBottom: '10px' }}
                />
              ) : (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '48px',
                    height: '48px',
                    borderRadius: '10px',
                    background: '#0B3B2E',
                    color: 'white',
                    fontWeight: 900,
                    fontSize: '20px',
                    marginBottom: '10px',
                  }}
                >
                  {companyName.charAt(0).toUpperCase()}
                </div>
              )}
              <div style={{ fontWeight: 700, fontSize: '15px', color: '#0B3B2E', marginBottom: '4px' }}>{companyName}</div>
              {companyAddr  && <div style={{ color: '#64748b', lineHeight: 1.6 }}>{companyAddr}</div>}
              {companyPhone && <div style={{ color: '#64748b' }}>Tel: {companyPhone}</div>}
              {companyEmail && <div style={{ color: '#64748b' }}>{companyEmail}</div>}
              {companyPin   && <div style={{ color: '#64748b' }}>PIN: {companyPin}</div>}
            </div>

            {/* TAX INVOICE title block */}
            <div style={{ textAlign: 'right' }}>
              <div
                style={{
                  fontSize: '24px',
                  fontWeight: 900,
                  letterSpacing: '-0.02em',
                  color: '#0B3B2E',
                  textTransform: 'uppercase',
                  marginBottom: '8px',
                }}
              >
                Tax Invoice
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: '13px', fontWeight: 700, color: '#475569', marginBottom: '12px' }}>
                #{invoice.invoiceNumber || invoice._id?.slice(-8).toUpperCase()}
              </div>
              {/* Status badge */}
              <span
                style={{
                  display: 'inline-block',
                  padding: '3px 12px',
                  borderRadius: '999px',
                  border: `1px solid ${statusColor.border}`,
                  background: statusColor.bg,
                  color: statusColor.text,
                  fontWeight: 700,
                  fontSize: '10px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}
              >
                {invoice.status}
              </span>
            </div>
          </div>

          {/* ── Divider ─────────────────────────────────────────────────────── */}
          <div style={{ height: '2px', background: '#0B3B2E', marginBottom: '24px', borderRadius: '1px' }} />

          {/* ── Invoice meta + Bill To ───────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px', marginBottom: '28px' }}>
            {/* Invoice Details */}
            <div>
              <div style={{ fontWeight: 700, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#94a3b8', marginBottom: '10px' }}>
                Invoice Details
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {[
                    ['Issue Date', fmtDate(invoice.issueDate)],
                    ['Due Date',   fmtDate(invoice.dueDate)],
                    ...(invoice.periodStart ? [['Service Period', `${fmtDate(invoice.periodStart)} – ${fmtDate(invoice.periodEnd)}`]] : []),
                    ...(contract.contractNumber ? [['Contract #', contract.contractNumber]] : []),
                  ].map(([label, value]) => (
                    <tr key={label}>
                      <td style={{ paddingBottom: '5px', color: '#64748b', width: '44%' }}>{label}</td>
                      <td style={{ paddingBottom: '5px', fontWeight: 600 }}>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Bill To */}
            <div>
              <div style={{ fontWeight: 700, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#94a3b8', marginBottom: '10px' }}>
                Bill To
              </div>
              <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '4px', color: '#1e293b' }}>
                {client.name || '—'}
              </div>
              {client.code     && <div style={{ color: '#64748b', marginBottom: '2px' }}>Code: {client.code}</div>}
              {client.address  && <div style={{ color: '#64748b', marginBottom: '2px' }}>{resolveAddr(client.address)}</div>}
              {client.taxPin   && <div style={{ color: '#64748b', marginBottom: '2px' }}>PIN: {client.taxPin}</div>}
              {client.email    && <div style={{ color: '#64748b', marginBottom: '2px' }}>{client.email}</div>}
              {client.phone    && <div style={{ color: '#64748b' }}>{client.phone}</div>}
            </div>
          </div>

          {/* ── Line Items ──────────────────────────────────────────────────── */}
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              marginBottom: '0',
              fontSize: '11px',
            }}
          >
            <thead>
              <tr style={{ background: '#0B3B2E', color: 'white' }}>
                {['#', 'Description', 'Qty', 'Unit Price (KES)', 'Amount (KES)'].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      padding: '8px 10px',
                      textAlign: i <= 1 ? 'left' : 'right',
                      fontWeight: 700,
                      fontSize: '10px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item, idx) => {
                const qty    = item.quantity  || 1;
                const price  = item.unitPrice || 0;
                const amount = qty * price;
                return (
                  <tr
                    key={idx}
                    style={{ background: idx % 2 === 0 ? 'white' : '#f8fafc', borderBottom: '1px solid #e2e8f0' }}
                  >
                    <td style={{ padding: '8px 10px', color: '#94a3b8', width: '32px' }}>{idx + 1}</td>
                    <td style={{ padding: '8px 10px', maxWidth: '320px' }}>
                      <div style={{ fontWeight: 600 }}>{item.description || '—'}</div>
                      {item.notes && <div style={{ color: '#94a3b8', fontSize: '10px', marginTop: '2px' }}>{item.notes}</div>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{qty}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2 }).format(price)}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2 }).format(amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* ── Totals ──────────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0' }}>
            <div
              style={{
                width: '280px',
                borderLeft: '1px solid #e2e8f0',
                borderRight: '1px solid #e2e8f0',
                borderBottom: '1px solid #e2e8f0',
              }}
            >
              {[
                { label: 'Subtotal',                    value: fmtKES(subtotal),  bold: false },
                { label: `VAT (${vatRate}%)`,           value: fmtKES(vatAmount), bold: false },
              ].map(({ label, value, bold }) => (
                <div
                  key={label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '6px 12px',
                    borderBottom: '1px solid #f1f5f9',
                    fontWeight: bold ? 700 : 400,
                  }}
                >
                  <span style={{ color: '#64748b' }}>{label}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
                </div>
              ))}
              {/* Total row */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '9px 12px',
                  background: '#0B3B2E',
                  color: 'white',
                }}
              >
                <span style={{ fontWeight: 700, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Total
                </span>
                <span style={{ fontWeight: 700, fontSize: '13px', fontVariantNumeric: 'tabular-nums' }}>{fmtKES(total)}</span>
              </div>

              {/* Paid / Balance rows — only if partially or fully paid */}
              {paidAmount > 0 && (
                <>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '6px 12px',
                      borderBottom: '1px solid #f1f5f9',
                      color: '#059669',
                    }}
                  >
                    <span>Amount Paid</span>
                    <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtKES(paidAmount)}</span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '6px 12px',
                      fontWeight: 700,
                      color: balance > 0 ? '#dc2626' : '#059669',
                    }}
                  >
                    <span>{balance > 0 ? 'Balance Due' : 'Fully Paid'}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{balance > 0 ? fmtKES(balance) : fmtKES(0)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── Payment Info ────────────────────────────────────────────────── */}
          {(invoice.paymentMethod || invoice.paymentReference || invoice.paidAt) && (
            <div
              style={{
                marginTop: '28px',
                padding: '14px 16px',
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '6px',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#166534', marginBottom: '8px' }}>
                Payment Record
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                {invoice.paymentMethod    && <div><span style={{ color: '#64748b' }}>Method: </span><strong>{invoice.paymentMethod}</strong></div>}
                {invoice.paymentReference && <div><span style={{ color: '#64748b' }}>Ref: </span><strong style={{ fontFamily: 'monospace' }}>{invoice.paymentReference}</strong></div>}
                {invoice.paidAt           && <div><span style={{ color: '#64748b' }}>Date: </span><strong>{fmtDate(invoice.paidAt)}</strong></div>}
              </div>
            </div>
          )}

          {/* ── Notes ───────────────────────────────────────────────────────── */}
          {invoice.notes && (
            <div style={{ marginTop: '24px' }}>
              <div style={{ fontWeight: 700, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#94a3b8', marginBottom: '6px' }}>
                Notes
              </div>
              <div style={{ color: '#475569', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{invoice.notes}</div>
            </div>
          )}

          {/* ── Footer ──────────────────────────────────────────────────────── */}
          <div
            style={{
              marginTop: '48px',
              paddingTop: '16px',
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              color: '#94a3b8',
              fontSize: '10px',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, color: '#475569', marginBottom: '2px' }}>
                {companyName}
              </div>
              {companyEmail && <div>{companyEmail}</div>}
              {companyPhone && <div>{companyPhone}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div>This is a computer-generated invoice.</div>
              <div>Generated: {fmtDate(new Date().toISOString())}</div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
};

export default InvoicePrintView;
