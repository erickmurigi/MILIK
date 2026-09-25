import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  RefreshControl, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';
import ListErrorState from '../../../../components/ui/ListErrorState';
import { fmtMoney, fmtDate, apiError } from '../../../../utils/pmsFormat';
import { invoiceStatusOf, INVOICE_STATUS_LABEL, INVOICE_CATEGORY_LABEL, rowsOf } from '../../../../utils/pmsBilling';

type Note = {
  _id:            string;
  noteType?:      string;
  noteNumber?:    string;
  amount:         number;
  noteDate?:      string;
  description?:   string;
  status?:        string;
  sourceInvoice?: { _id?: string } | string | null;
};

type ReceiptApplication = {
  receiptId?:     string;
  receiptNumber?: string;
  receiptDate?:   string;
  appliedAmount:  number;
};

type InvoiceDetail = {
  _id:              string;
  invoiceNumber?:   string;
  status?:          string;
  computedStatus?:  string;
  category?:        string;
  amount:           number;
  adjustedAmount?:  number;
  creditNoteTotal?: number;
  debitNoteTotal?:  number;
  appliedAmount?:   number;
  outstanding?:     number;
  invoiceDate?:     string;
  bookingDate?:     string;
  dueDate?:         string;
  description?:     string;
  tenantId?:        string;
  tenantName?:      string;
  unit?:            string;
  property?:        string;
  receiptApplications?: ReceiptApplication[];
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending:        { bg: Colors.dangerLight,  text: Colors.danger   },
  partially_paid: { bg: Colors.warningLight, text: Colors.warning  },
  paid:           { bg: Colors.successLight, text: Colors.success  },
  cancelled:      { bg: Colors.borderLight,  text: Colors.textMuted },
  reversed:       { bg: Colors.borderLight,  text: Colors.textMuted },
};

const Row = ({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
  </View>
);

// Server list rows -> the flat shape this screen renders.
const fromServer = (raw: Record<string, any>): InvoiceDetail => {
  const t = raw.tenant && typeof raw.tenant === 'object' ? raw.tenant : null;
  return {
    _id:             String(raw._id),
    invoiceNumber:   raw.invoiceNumber,
    status:          raw.status,
    computedStatus:  raw.computedStatus,
    category:        raw.category,
    amount:          Number(raw.amount ?? 0),
    adjustedAmount:  raw.adjustedAmount != null ? Number(raw.adjustedAmount) : undefined,
    creditNoteTotal: raw.creditNoteTotal != null ? Number(raw.creditNoteTotal) : undefined,
    debitNoteTotal:  raw.debitNoteTotal != null ? Number(raw.debitNoteTotal) : undefined,
    appliedAmount:   raw.appliedAmount != null ? Number(raw.appliedAmount) : undefined,
    outstanding:     raw.outstanding != null ? Number(raw.outstanding) : undefined,
    invoiceDate:     raw.invoiceDate,
    bookingDate:     raw.bookingDate,
    dueDate:         raw.dueDate,
    description:     raw.description,
    tenantId:        t?._id ?? (typeof raw.tenant === 'string' ? raw.tenant : undefined),
    tenantName:      t?.name,
    unit:            raw.unit?.unitNumber ? `Unit ${raw.unit.unitNumber}` : undefined,
    property:        raw.property?.propertyName ?? raw.property?.name,
    receiptApplications: Array.isArray(raw.receiptApplications) ? raw.receiptApplications : undefined,
  };
};

export default function InvoiceDetailScreen() {
  const router = useRouter();
  const p = useLocalSearchParams<Record<string, string>>();
  const id = String(p.id ?? '');

  // Render instantly from what the list passed, then replace with the server record.
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(() =>
    p.invoiceNumber || p.amount
      ? {
          _id: id,
          invoiceNumber: p.invoiceNumber || undefined,
          status:        p.status || undefined,
          category:      p.category || undefined,
          amount:        Number(p.amount ?? 0),
          outstanding:   p.outstanding ? Number(p.outstanding) : undefined,
          invoiceDate:   p.invoiceDate || undefined,
          dueDate:       p.dueDate || undefined,
          description:   p.description || undefined,
          tenantId:      p.tenantId || undefined,
          tenantName:    p.tenantName || undefined,
          unit:          p.unit || undefined,
          property:      p.property || undefined,
        }
      : null,
  );
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [stale,        setStale]        = useState(false);
  const [notes,        setNotes]        = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);

  const load = useCallback(async () => {
    let found: InvoiceDetail | null = null;
    let failure: unknown = null;

    // 1) Cheapest path that works on every server version: the tenant's invoice list narrowed by number.
    if (p.tenantId && p.invoiceNumber) {
      try {
        const { data } = await api.get('/tenant-invoices', {
          params: { tenant: p.tenantId, invoiceNumber: p.invoiceNumber, includeSnapshots: 'true' },
        });
        const hit = rowsOf<Record<string, any>>(data).find(r => String(r._id) === id);
        if (hit) found = fromServer(hit);
      } catch (e) { failure = e; }
    }
    // 2) Direct lookup by id (deep links that only carry the id).
    if (!found) {
      try {
        const { data } = await api.get(`/tenant-invoices/${id}`);
        found = fromServer(data?.data ?? data);
      } catch (e) { failure = failure ?? e; }
    }

    if (found) {
      setInvoice(found);
      setError(null);
      setStale(false);
    } else if (!invoice) {
      setError(apiError(failure, 'Could not load this invoice.'));
    } else {
      setStale(true);
    }
    return found;
  }, [id, p.tenantId, p.invoiceNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadNotes = useCallback(async (tenantId?: string) => {
    if (!tenantId) return;
    setNotesLoading(true);
    try {
      const { data } = await api.get('/tenant-invoices/notes', { params: { tenant: tenantId } });
      setNotes(
        rowsOf<Note>(data).filter(n => {
          const src = typeof n.sourceInvoice === 'object' ? n.sourceInvoice?._id : n.sourceInvoice;
          const st  = String(n.status || '').toLowerCase();
          return String(src ?? '') === id && st !== 'cancelled' && st !== 'reversed';
        }),
      );
    } catch { setNotes([]); }
    finally { setNotesLoading(false); }
  }, [id]);

  const loadAll = useCallback(async () => {
    const found = await load();
    await loadNotes(found?.tenantId ?? invoice?.tenantId ?? p.tenantId);
    setLoading(false);
    setRefreshing(false);
  }, [load, loadNotes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadAll(); }, [loadAll]);

  if (loading && !invoice) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: p.invoiceNumber || 'Invoice' }} />
        <MilikLoader fullscreen />
      </SafeAreaView>
    );
  }

  if (!invoice) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Invoice' }} />
        <ListErrorState message={error ?? 'Invoice not found'} onRetry={() => { setLoading(true); loadAll(); }} />
      </SafeAreaView>
    );
  }

  const st          = invoiceStatusOf(invoice);
  const sc          = STATUS_COLORS[st] ?? STATUS_COLORS.pending;
  const total       = Number(invoice.adjustedAmount ?? invoice.amount ?? 0);
  const hasOutstanding = invoice.outstanding != null;
  const outstanding = hasOutstanding
    ? Number(invoice.outstanding)
    : st === 'paid' || st === 'reversed' || st === 'cancelled' ? 0 : Math.max(0, total - Number(invoice.appliedAmount ?? 0));
  const paid        = invoice.appliedAmount != null ? Number(invoice.appliedAmount) : Math.max(0, total - outstanding);
  const isVoided    = st === 'reversed' || st === 'cancelled';
  const canPay      = !isVoided && outstanding > 0.009;
  const allocations = invoice.receiptApplications ?? [];
  const creditNotes = Number(invoice.creditNoteTotal ?? 0);
  const debitNotes  = Number(invoice.debitNoteTotal ?? 0);

  return (
    <>
      <Stack.Screen options={{ title: invoice.invoiceNumber ?? 'Invoice' }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadAll(); }}
              tintColor={Colors.primary}
            />
          }
        >
          {isVoided && (
            <View style={styles.voidedBanner}>
              <Ionicons name="ban-outline" size={15} color={Colors.textMuted} />
              <Text style={styles.voidedText}>This invoice has been {st}</Text>
            </View>
          )}

          {stale && (
            <View style={styles.staleBanner}>
              <Ionicons name="cloud-offline-outline" size={15} color={Colors.warning} />
              <Text style={styles.staleText}>Could not refresh. Showing the details saved from the list.</Text>
            </View>
          )}

          {/* Hero */}
          <View style={styles.heroCard}>
            <View style={styles.heroTop}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.invoiceNum}>{invoice.invoiceNumber || '—'}</Text>
                <TouchableOpacity
                  activeOpacity={0.7}
                  disabled={!invoice.tenantId}
                  onPress={() => invoice.tenantId && router.push(`/pms/tenants/${invoice.tenantId}` as never)}
                >
                  <Text style={styles.tenantName}>{invoice.tenantName || 'Unknown Tenant'}</Text>
                </TouchableOpacity>
                {(invoice.unit || invoice.property) ? (
                  <Text style={styles.meta}>{[invoice.unit, invoice.property].filter(Boolean).join(' · ')}</Text>
                ) : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <View style={[styles.badge, { backgroundColor: sc.bg }]}>
                  <Text style={[styles.badgeText, { color: sc.text }]}>
                    {(INVOICE_STATUS_LABEL[st] ?? st).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.amount}>KES {fmtMoney(total)}</Text>
              </View>
            </View>
          </View>

          {/* Financial details */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>INVOICE DETAILS</Text>
            <Row label="Category"     value={INVOICE_CATEGORY_LABEL[invoice.category ?? ''] ?? invoice.category ?? '—'} />
            <Row label="Invoice Date" value={fmtDate(invoice.invoiceDate)} />
            {invoice.bookingDate && fmtDate(invoice.bookingDate) !== fmtDate(invoice.invoiceDate)
              ? <Row label="Booking Date" value={fmtDate(invoice.bookingDate)} /> : null}
            {invoice.dueDate ? <Row label="Due Date" value={fmtDate(invoice.dueDate)} /> : null}
            <View style={styles.divider} />
            {creditNotes > 0.009 || debitNotes > 0.009 ? (
              <>
                <Row label="Original Amount" value={`KES ${fmtMoney(invoice.amount)}`} />
                {creditNotes > 0.009 ? <Row label="Credit Notes" value={`− KES ${fmtMoney(creditNotes)}`} valueColor={Colors.success} /> : null}
                {debitNotes > 0.009 ? <Row label="Debit Notes" value={`+ KES ${fmtMoney(debitNotes)}`} valueColor={Colors.danger} /> : null}
              </>
            ) : null}
            <Row label="Total Charged" value={`KES ${fmtMoney(total)}`} />
            <Row label="Amount Paid" value={`KES ${fmtMoney(paid)}`} valueColor={Colors.success} />
            <Row
              label="Outstanding"
              value={`KES ${fmtMoney(outstanding)}`}
              valueColor={outstanding > 0.009 ? Colors.danger : Colors.success}
            />
            {invoice.description ? (
              <>
                <View style={styles.divider} />
                <Text style={styles.descriptionLabel}>DESCRIPTION</Text>
                <Text style={styles.description}>{invoice.description}</Text>
              </>
            ) : null}
          </View>

          {/* Payment allocations */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>PAYMENT ALLOCATIONS</Text>
            {allocations.length === 0 ? (
              <View style={styles.emptySection}>
                <Ionicons name="cash-outline" size={32} color={Colors.border} />
                <Text style={styles.emptySectionText}>No payments recorded yet</Text>
              </View>
            ) : (
              allocations.map((a, i) => (
                <TouchableOpacity
                  key={`${a.receiptId ?? a.receiptNumber ?? 'r'}-${i}`}
                  style={styles.allocRow}
                  activeOpacity={a.receiptId ? 0.7 : 1}
                  disabled={!a.receiptId}
                  onPress={() => a.receiptId && router.push(`/pms/receipts/${a.receiptId}` as never)}
                >
                  <View style={styles.allocIcon}>
                    <Ionicons name="receipt-outline" size={14} color={Colors.primary} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.allocRef}>{a.receiptNumber || 'Receipt'}</Text>
                    <Text style={styles.allocDate}>{fmtDate(a.receiptDate)}</Text>
                  </View>
                  <Text style={styles.allocAmt}>KES {fmtMoney(a.appliedAmount)}</Text>
                </TouchableOpacity>
              ))
            )}
          </View>

          {/* Adjustments & notes */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>ADJUSTMENTS & NOTES</Text>
            {notesLoading ? (
              <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 16 }} />
            ) : notes.length === 0 ? (
              <View style={styles.emptySection}>
                <Ionicons name="document-text-outline" size={32} color={Colors.border} />
                <Text style={styles.emptySectionText}>No adjustments on this invoice</Text>
              </View>
            ) : (
              notes.map(note => {
                const isCredit = String(note.noteType || '').toUpperCase() === 'CREDIT_NOTE';
                return (
                  <View key={note._id} style={styles.noteRow}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.noteType}>
                        {isCredit ? 'Credit note' : 'Debit note'}{note.noteNumber ? ` · ${note.noteNumber}` : ''}
                      </Text>
                      {note.description ? <Text style={styles.noteDesc}>{note.description}</Text> : null}
                      <Text style={styles.noteDate}>{note.noteDate ? fmtDate(note.noteDate) : ''}</Text>
                    </View>
                    <Text style={[styles.noteAmount, { color: isCredit ? Colors.success : Colors.danger }]}>
                      {isCredit ? '−' : '+'} KES {fmtMoney(Math.abs(note.amount))}
                    </Text>
                  </View>
                );
              })
            )}
          </View>

          {canPay && invoice.tenantId ? (
            <TouchableOpacity
              style={styles.payBtn}
              activeOpacity={0.85}
              onPress={() =>
                router.push(
                  `/pms/receipts/new?tenant=${invoice.tenantId}&tenantName=${encodeURIComponent(invoice.tenantName ?? '')}&invoice=${id}` as never
                )
              }
            >
              <Ionicons name="card-outline" size={18} color={Colors.white} />
              <Text style={styles.payBtnText}>Record Payment</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },

  voidedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.borderLight,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
  },
  voidedText: { fontSize: 13, color: Colors.textMuted, fontWeight: '600' },
  staleBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.warningLight,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
  },
  staleText: { flex: 1, fontSize: 12, color: Colors.warning, fontWeight: '600' },

  heroCard: {
    backgroundColor: Colors.white, borderRadius: 18,
    borderWidth: 1, borderColor: Colors.border, padding: 16,
  },
  heroTop:    { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  invoiceNum: { fontSize: 16, fontWeight: '900', color: Colors.text },
  tenantName: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  meta:       { fontSize: 12, color: Colors.textMuted },
  amount:     { fontSize: 18, fontWeight: '900', color: Colors.text },
  badge:      { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeText:  { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },

  card: {
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border, padding: 16,
  },
  cardTitle: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1,
    color: Colors.textMuted, marginBottom: 12,
  },

  row:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  rowLabel: { fontSize: 13, color: Colors.textSecondary },
  rowValue: { fontSize: 13, fontWeight: '700', color: Colors.text },
  divider:  { height: 1, backgroundColor: Colors.borderLight, marginVertical: 4 },

  descriptionLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1,
    color: Colors.textMuted, marginTop: 8, marginBottom: 4,
  },
  description: { fontSize: 13, color: Colors.text, lineHeight: 20 },

  emptySection:     { alignItems: 'center', paddingVertical: 24, gap: 8 },
  emptySectionText: { fontSize: 13, color: Colors.textMuted },

  allocRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  allocIcon: {
    width: 28, height: 28, borderRadius: 7,
    backgroundColor: Colors.primaryFaded,
    alignItems: 'center', justifyContent: 'center',
  },
  allocRef:  { fontSize: 13, fontWeight: '600', color: Colors.text },
  allocDate: { fontSize: 11, color: Colors.textMuted },
  allocAmt:  { fontSize: 14, fontWeight: '800', color: Colors.success },

  noteRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  noteType:   { fontSize: 13, fontWeight: '700', color: Colors.text },
  noteDesc:   { fontSize: 12, color: Colors.textMuted },
  noteDate:   { fontSize: 11, color: Colors.textMuted },
  noteAmount: { fontSize: 14, fontWeight: '800' },

  payBtn: {
    backgroundColor: Colors.primary, borderRadius: 14,
    height: 54, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8, marginTop: 4,
  },
  payBtnText: { color: Colors.white, fontSize: 16, fontWeight: '800' },
});
