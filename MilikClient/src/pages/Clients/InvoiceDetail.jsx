// Client invoice detail: a document-style view matching the PDF, with balance, credit/debit notes,
// revenue schedule, eTIMS and the invoice's actions.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import {
  FaArrowLeft, FaBan, FaCheck, FaEdit, FaEnvelope, FaExternalLinkAlt, FaFilePdf, FaMinusCircle, FaMoneyBillWave,
  FaPlusCircle, FaPrint, FaUndo, FaUpload,
} from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import ListToolbar from '../../components/common/ListToolbar';
import Spinner from '../../components/common/Spinner';
import NoteModal from '../../components/Clients/Billing/NoteModal';
import RevenueScheduleTable from '../../components/Clients/Billing/RevenueScheduleTable';
import { EmptyNote, ReasonModal, Section, StatusPill, iconBtn, iconBtnDanger } from '../../components/Clients/Billing/BillingUi';
import {
  RECOGNITION_OPTIONS, daysUntil, invalidateList, invoiceDisplayStatus, isOpenInvoice, money, optionLabel, useBillingSettings,
} from '../../components/Clients/Billing/billingShared';
import { invoicesApi, notesApi, apiError } from '../../services/clientsBillingApi';
import { fmtDate, fmtDateTime } from '../../utils/dates';
import { hasCompanyPermission } from '../../utils/permissions';
import { selectCurrentCompany, selectCurrentUser } from '../../redux/selectors';

const Row = ({ label, value, strong, tone = '' }) => (
  <div className={`flex items-center justify-between px-3 py-1 text-xs ${strong ? 'font-black' : ''} ${tone}`}>
    <span className={strong ? 'uppercase tracking-wide' : 'text-slate-600'}>{label}</span>
    <span className="tabular-nums">{value}</span>
  </div>
);

const InvoiceDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useSelector(selectCurrentUser);
  const company = useSelector(selectCurrentCompany);
  const businessId = company?._id || '';
  const canEdit = hasCompanyPermission(user, company, 'clients', 'edit');
  const canDelete = hasCompanyPermission(user, company, 'clients', 'delete');
  const canReverse = hasCompanyPermission(user, company, 'clients', 'reverse');
  const { settings } = useBillingSettings();

  const [invoice, setInvoice] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [tick, setTick] = useState(0);
  const [modal, setModal] = useState(null); // string | { kind, note }

  useEffect(() => {
    let alive = true;
    invoicesApi.get(id)
      .then((res) => { if (alive) { setInvoice(res.data?.invoice || res.data?.data); setLoadError(''); } })
      .catch((err) => { if (alive) setLoadError(apiError(err, 'Could not load the invoice')); });
    return () => { alive = false; };
  }, [id, tick]);

  const reload = () => { invalidateList(`invoices:${businessId}`); setTick((t) => t + 1); };
  const act = async (fn, ok) => {
    try {
      const res = await fn();
      toast.success(res?.data?.message || ok);
      reload();
    } catch (err) {
      toast.error(apiError(err));
    }
  };
  const pdf = async (preview) => {
    try { await invoicesApi.pdf(id, { preview, number: invoice?.invoiceNumber }); } catch (err) { toast.error(apiError(err, 'Could not open the invoice PDF')); }
  };
  const notePdf = async (n) => {
    try { await notesApi.pdf(n._id, { preview: true, number: n.noteNumber }); } catch (err) { toast.error(apiError(err, 'Could not open the note')); }
  };

  const noteTotals = useMemo(() => {
    const posted = (invoice?.notes || []).filter((n) => n.status === 'posted');
    return {
      credit: posted.filter((n) => n.noteType === 'CREDIT_NOTE').reduce((s, n) => s + Number(n.total || 0), 0),
      debit: posted.filter((n) => n.noteType === 'DEBIT_NOTE').reduce((s, n) => s + Number(n.total || 0), 0),
    };
  }, [invoice]);

  if (!invoice) {
    return (
      <ClientsShell>
        <div className="flex flex-1 items-center justify-center gap-2 text-slate-400">
          {loadError ? <span className="text-xs font-semibold text-red-600">{loadError}</span> : <><Spinner size="sm" /><span className="text-xs font-semibold">Loading invoice…</span></>}
        </div>
      </ClientsShell>
    );
  }

  const cur = invoice.currency || 'KES';
  const st = invoice.status;
  const isDraft = st === 'draft';
  const isOpen = isOpenInvoice(invoice);
  const live = !['draft', 'cancelled'].includes(st);
  const shown = invoiceDisplayStatus({ ...invoice, isOverdue: isOpen && invoice.outstanding > 0.005 && new Date(invoice.dueDate) < new Date() });
  const client = invoice.client || {};
  const lineTax = invoice.taxCalculation === 'line';
  const bank = settings?.bankDetails || {};
  const hasBank = Boolean(bank.bankName || bank.accountNumber);
  const adjusted = invoice.adjustedTotal ?? invoice.total;

  return (
    <ClientsShell>
      <div className="flex h-full min-h-0 flex-col">
        <ListToolbar>
          <ListToolbar.Button variant="outline" icon={FaArrowLeft} onClick={() => navigate('/clients/invoices')}>Invoices</ListToolbar.Button>
          <ListToolbar.Divider />
          {isDraft && canEdit && <ListToolbar.Button variant="outline" icon={FaEdit} onClick={() => navigate(`/clients/invoices/${id}/edit`, { state: { tabTitle: `Edit ${invoice.invoiceNumber}` } })}>Edit</ListToolbar.Button>}
          {isDraft && canEdit && <ListToolbar.Button variant="outlineOk" icon={FaCheck} onClick={() => setModal('post')}>Post</ListToolbar.Button>}
          {st !== 'cancelled' && <ListToolbar.Button icon={FaEnvelope} onClick={() => setModal('send')}>{isDraft ? 'Post & send' : invoice.sentAt ? 'Resend' : 'Send'}</ListToolbar.Button>}
          {isOpen && <ListToolbar.Button variant="dark" icon={FaMoneyBillWave} onClick={() => navigate(`/clients/receipts/new?clientId=${client._id}&invoiceId=${id}`, { state: { tabTitle: 'New Receipt' } })}>Record payment</ListToolbar.Button>}
          {live && st !== 'credited' && canEdit && <ListToolbar.Button variant="outline" icon={FaMinusCircle} onClick={() => setModal('credit')}>Credit note</ListToolbar.Button>}
          {live && canEdit && <ListToolbar.Button variant="outline" icon={FaPlusCircle} onClick={() => setModal('debit')}>Debit note</ListToolbar.Button>}
          {live && invoice.etimsStatus !== 'submitted' && canEdit && <ListToolbar.Button variant="outline" icon={FaUpload} onClick={() => setModal('etims')}>Submit to eTIMS</ListToolbar.Button>}
          <ListToolbar.Divider />
          <ListToolbar.Button variant="outline" icon={FaPrint} onClick={() => pdf(true)}>Print</ListToolbar.Button>
          <ListToolbar.Button variant="outline" icon={FaFilePdf} onClick={() => pdf(false)}>PDF</ListToolbar.Button>
          {canDelete && !['cancelled', 'paid', 'partial', 'partially_paid', 'credited'].includes(st) && !(Number(invoice.paidAmount) > 0) && (
            <><ListToolbar.Divider /><ListToolbar.Button variant="danger" icon={FaBan} onClick={() => setModal('cancel')}>Cancel invoice</ListToolbar.Button></>
          )}
        </ListToolbar>

        <div className="flex-1 overflow-y-auto bg-slate-100/70 p-3">
          <div className="mx-auto grid max-w-6xl gap-3 lg:grid-cols-[1fr_300px]">
            {/* ── Document ── */}
            <div className="relative border border-slate-200 bg-white shadow-sm">
              {st === 'cancelled' && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-7xl font-black uppercase tracking-widest text-red-500/10">Void</div>}
              {isDraft && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-7xl font-black uppercase tracking-widest text-slate-500/10">Draft</div>}
              <div className="flex items-start justify-between gap-4 border-b-4 border-[#0B3B2E] px-6 pb-4 pt-5">
                <div>
                  <p className="text-lg font-black text-slate-900">{company?.companyName || 'Company'}</p>
                  <p className="text-[11px] text-slate-500">{[company?.postalAddress, company?.email, company?.phoneNo].filter(Boolean).join(' · ')}</p>
                  {company?.kraPin && <p className="text-[11px] text-slate-500">PIN {company.kraPin}</p>}
                </div>
                <div className="text-right">
                  <p className="text-xl font-black uppercase tracking-widest text-[#0B3B2E]">{Number(invoice.vatAmount) > 0 ? 'Tax invoice' : 'Invoice'}</p>
                  <p className="text-sm font-bold text-slate-900">{invoice.invoiceNumber}</p>
                  <div className="mt-1"><StatusPill status={shown} /></div>
                </div>
              </div>

              <div className="grid gap-4 px-6 py-4 sm:grid-cols-2">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Bill to</p>
                  <button type="button" className="text-sm font-black text-slate-900 hover:text-[#0B3B2E] hover:underline" onClick={() => navigate(`/clients/${client._id}`, { state: { tabTitle: client.name } })}>{client.name}</button>
                  <p className="text-[11px] text-slate-600">{[client.clientCode, client.taxPin ? `PIN ${client.taxPin}` : ''].filter(Boolean).join(' · ')}</p>
                  {(client.address?.line1 || client.address?.city) && <p className="text-[11px] text-slate-600">{[client.address.line1, client.address.city, client.address.country].filter(Boolean).join(', ')}</p>}
                  <p className="text-[11px] text-slate-600">{[client.email, client.phone && client.phone !== '-' ? client.phone : ''].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <span className="text-slate-500">Issue date</span><span className="text-right font-semibold">{fmtDate(invoice.issueDate)}</span>
                  <span className="text-slate-500">Due date</span><span className={`text-right font-semibold ${shown === 'overdue' ? 'text-red-600' : ''}`}>{fmtDate(invoice.dueDate)}</span>
                  {invoice.periodStart && <><span className="text-slate-500">Period</span><span className="text-right font-semibold">{fmtDate(invoice.periodStart)} – {fmtDate(invoice.periodEnd)}</span></>}
                  {invoice.poNumber && <><span className="text-slate-500">PO no.</span><span className="text-right font-semibold">{invoice.poNumber}</span></>}
                  {invoice.contract && (
                    <>
                      <span className="text-slate-500">Contract</span>
                      <button type="button" className="text-right font-semibold text-[#0B3B2E] hover:underline" onClick={() => navigate(`/clients/contracts/${invoice.contract._id || invoice.contract}`, { state: { tabTitle: invoice.contract.contractNumber } })}>
                        {invoice.contract.contractNumber || 'Contract'}{invoice.contractVersion ? ` v${invoice.contractVersion}` : ''}
                      </button>
                    </>
                  )}
                  <span className="text-slate-500">Currency</span><span className="text-right font-semibold">{cur}{invoice.taxMode === 'inclusive' ? ' · tax inclusive' : ''}</span>
                </div>
              </div>

              <div className="px-6">
                <table className="w-full text-[11px]">
                  <thead className="bg-[#0B3B2E] text-left text-[9px] font-black uppercase tracking-widest text-white">
                    <tr>
                      <th className="px-2 py-1.5">Description</th>
                      <th className="px-2 py-1.5 text-right">Qty</th>
                      <th className="px-2 py-1.5 text-right">Unit price</th>
                      <th className="px-2 py-1.5 text-right">Disc</th>
                      <th className="px-2 py-1.5">Tax</th>
                      <th className="px-2 py-1.5 text-right">Net</th>
                      <th className="px-2 py-1.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(invoice.lineItems || []).map((l) => (
                      <tr key={l._id} className="align-top">
                        <td className="px-2 py-1.5">
                          <span className="font-semibold text-slate-900">{l.itemName || l.description}</span>
                          {l.itemName && l.description && l.description !== l.itemName && <span className="block text-[10px] text-slate-500">{l.description}</span>}
                          {(l.servicePeriodStart || l.revenueRecognition !== 'on_invoice') && (
                            <span className="block text-[10px] text-slate-500">
                              {l.servicePeriodStart ? `${fmtDate(l.servicePeriodStart)} – ${fmtDate(l.servicePeriodEnd)}` : ''}
                              {l.revenueRecognition && l.revenueRecognition !== 'on_invoice' ? ` · ${optionLabel(RECOGNITION_OPTIONS, l.revenueRecognition)}` : ''}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{l.quantity}{l.prorationFactor && l.prorationFactor !== 1 ? <span className="block text-[9px] text-slate-500">× {Math.round(l.prorationFactor * 100)}%</span> : null}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(l.unitPrice)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{l.discountPercent ? `${l.discountPercent}%` : '—'}</td>
                        <td className="px-2 py-1.5">{lineTax ? (l.taxCodeName || l.taxCodeKey || '—') : (l.taxable ? `VAT ${invoice.vatRate}%` : 'No tax')}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(l.amount)}</td>
                        <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{money(lineTax ? l.totalAmount : Number(l.amount || 0) + (l.taxable ? (Number(l.amount || 0) * Number(invoice.vatRate || 0)) / 100 : 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-4">
                <div className="min-w-[220px] flex-1 space-y-2 text-[11px] text-slate-700">
                  {invoice.notes && <div><p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Notes</p><p className="whitespace-pre-wrap">{invoice.notes}</p></div>}
                  {(settings?.mpesaPaybill || hasBank) && (
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">How to pay</p>
                      {settings?.mpesaPaybill && <p>M-Pesa paybill <b>{settings.mpesaPaybill}</b> · account <b>{invoice.invoiceNumber}</b></p>}
                      {hasBank && <p>{[bank.bankName, bank.branch].filter(Boolean).join(', ')} · {bank.accountName} · A/C <b>{bank.accountNumber}</b>{bank.swiftCode ? ` · SWIFT ${bank.swiftCode}` : ''}</p>}
                    </div>
                  )}
                  {invoice.terms && <div><p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Terms</p><p className="whitespace-pre-wrap">{invoice.terms}</p></div>}
                </div>
                <div className="w-full max-w-[280px] border border-slate-200">
                  <Row label="Subtotal (net)" value={money(invoice.subtotal)} />
                  {Number(invoice.discountTotal) > 0 && <Row label="Discount given" value={money(invoice.discountTotal)} tone="text-slate-500" />}
                  <Row label={lineTax ? 'VAT / tax' : `VAT ${invoice.vatRate}%`} value={money(invoice.vatAmount)} />
                  <Row label="Invoice total" value={`${cur} ${money(invoice.total)}`} strong tone="border-t border-slate-200" />
                  {noteTotals.credit > 0 && <Row label="Credit notes" value={`− ${money(noteTotals.credit)}`} />}
                  {noteTotals.debit > 0 && <Row label="Debit notes" value={`+ ${money(noteTotals.debit)}`} />}
                  {(noteTotals.credit > 0 || noteTotals.debit > 0) && <Row label="Adjusted total" value={money(adjusted)} />}
                  {Number(invoice.paidAmount) > 0 && <Row label="Paid" value={`− ${money(invoice.paidAmount)}`} />}
                  <Row label="Balance due" value={`${cur} ${money(invoice.outstanding)}`} strong tone="bg-[#0B3B2E] text-white" />
                </div>
              </div>

              {live && (
                <div className="flex items-center gap-3 border-t border-slate-200 px-6 py-2 text-[10px] text-slate-500">
                  <span className="font-black uppercase tracking-widest">KRA eTIMS</span>
                  <StatusPill status={invoice.etimsStatus === 'submitted' ? 'posted' : invoice.etimsStatus === 'failed' ? 'failed' : 'draft'} label={String(invoice.etimsStatus || 'not_submitted').replace(/_/g, ' ')} />
                  {invoice.etimsCuInvoiceNumber && <span>CU invoice <b className="text-slate-800">{invoice.etimsCuInvoiceNumber}</b></span>}
                  {invoice.etimsQrUrl && <a href={invoice.etimsQrUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-[#0B3B2E] hover:underline">Verify <FaExternalLinkAlt size={8} /></a>}
                </div>
              )}
            </div>

            {/* ── Side panel ── */}
            <div className="space-y-3">
              <Section title="Balance">
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-slate-500">Outstanding</span><span className="text-base font-black tabular-nums text-slate-900">{cur} {money(invoice.outstanding)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Paid</span><span className="font-semibold tabular-nums">{money(invoice.paidAmount)}</span></div>
                  {invoice.paidAt && <div className="flex justify-between"><span className="text-slate-500">Last payment</span><span className="font-semibold">{fmtDate(invoice.paidAt)}</span></div>}
                  {shown === 'overdue' && <p className="font-bold text-red-600">Overdue by {Math.max(0, -(daysUntil(invoice.dueDate) || 0))} days</p>}
                </div>
              </Section>

              <Section title={`Credit & debit notes (${(invoice.notes || []).length})`} bodyClass="p-0">
                {(invoice.notes || []).length ? (
                  <table className="w-full text-[11px]">
                    <tbody className="divide-y divide-slate-100">
                      {invoice.notes.map((n) => (
                        <tr key={n._id} className={n.status === 'reversed' ? 'text-slate-400 line-through' : ''}>
                          <td className="px-2 py-1.5">
                            <span className="font-bold">{n.noteNumber}</span>
                            <span className="block text-[10px] no-underline">{n.noteType === 'CREDIT_NOTE' ? 'Credit' : 'Debit'} · {fmtDate(n.noteDate)}</span>
                            {n.reason && <span className="block truncate text-[10px] text-slate-500" title={n.reason}>{n.reason}</span>}
                          </td>
                          <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{n.noteType === 'CREDIT_NOTE' ? '−' : '+'}{money(n.total)}</td>
                          <td className="w-14 px-1 py-1.5 text-right no-underline">
                            <button type="button" className={iconBtn} title="Print note" onClick={() => notePdf(n)}><FaPrint size={11} /></button>
                            {n.status === 'posted' && canReverse && <button type="button" className={iconBtnDanger} title="Reverse note" onClick={() => setModal({ kind: 'reverse', note: n })}><FaUndo size={11} /></button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <EmptyNote>No notes against this invoice.</EmptyNote>}
              </Section>

              <Section title="History">
                <div className="space-y-0.5 text-[11px] text-slate-700">
                  <p>Created {fmtDateTime(invoice.createdAt)}</p>
                  {invoice.postedAt && <p>Posted {fmtDateTime(invoice.postedAt)}</p>}
                  {invoice.sentAt && <p>Emailed {fmtDateTime(invoice.sentAt)}</p>}
                  {invoice.billingRun && <p>Raised by a billing run</p>}
                  {invoice.cancelledAt && <p className="text-red-700">Cancelled {fmtDateTime(invoice.cancelledAt)}{invoice.cancellationReason ? ` — ${invoice.cancellationReason}` : ''}</p>}
                </div>
              </Section>
            </div>

            {(invoice.revenueSchedules || []).length > 0 && (
              <div className="lg:col-span-2">
                <Section title="Revenue recognition" bodyClass="p-0">
                  <div className="flex max-h-80 flex-col">
                    <RevenueScheduleTable invoiceId={invoice._id} schedules={invoice.revenueSchedules} onChanged={reload} />
                  </div>
                </Section>
              </div>
            )}
          </div>
        </div>
      </div>

      {modal === 'post' && (
        <ReasonModal title={`Post ${invoice.invoiceNumber}`} message="Post this draft to the ledger? Its amounts become final — changes after this need a credit or debit note." withReason={false} danger={false} confirmLabel="Post invoice"
          onClose={() => setModal(null)} onConfirm={async () => { await act(() => invoicesApi.post(id), 'Invoice posted'); setModal(null); }} />
      )}
      {modal === 'send' && (
        <ReasonModal title={`${isDraft ? 'Post & send' : 'Send'} ${invoice.invoiceNumber}`}
          message={isDraft ? <>This draft will be <b>posted to the ledger</b> and emailed to {client.email || 'the client'}.</> : <>Email the invoice to {client.email || 'the client'}?</>}
          withReason={false} danger={false} confirmLabel={isDraft ? 'Post & send' : 'Send'}
          onClose={() => setModal(null)} onConfirm={async () => { await act(() => invoicesApi.send(id), 'Invoice sent'); setModal(null); }} />
      )}
      {modal === 'etims' && (
        <ReasonModal title={`Submit ${invoice.invoiceNumber} to eTIMS`} message="Send this invoice to KRA eTIMS now?" withReason={false} danger={false} confirmLabel="Submit"
          onClose={() => setModal(null)} onConfirm={async () => { await act(() => invoicesApi.submitEtims(id), 'Submitted to eTIMS'); setModal(null); }} />
      )}
      {modal === 'cancel' && (
        <ReasonModal title={`Cancel ${invoice.invoiceNumber}`} message={isDraft ? 'The draft will be cancelled.' : 'The invoice is cancelled and its ledger entries reversed. Contract periods it billed become billable again.'} confirmLabel="Cancel invoice"
          onClose={() => setModal(null)} onConfirm={async (reason) => { await act(() => invoicesApi.cancel(id, reason), 'Invoice cancelled'); setModal(null); }} />
      )}
      {modal?.kind === 'reverse' && (
        <ReasonModal title={`Reverse ${modal.note.noteNumber}`} message="The note's ledger entries are reversed and the invoice balance restored." confirmLabel="Reverse note"
          onClose={() => setModal(null)} onConfirm={async (reason) => { await act(() => notesApi.reverse(modal.note._id, reason), 'Note reversed'); setModal(null); }} />
      )}
      {(modal === 'credit' || modal === 'debit') && <NoteModal invoiceId={id} type={modal} onClose={() => setModal(null)} onDone={reload} />}
    </ClientsShell>
  );
};

export default InvoiceDetail;
