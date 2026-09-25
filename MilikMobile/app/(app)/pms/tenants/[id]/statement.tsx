import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Colors } from '../../../../../constants/colors';
import api from '../../../../../services/api';
import MilikLoader from '../../../../../components/ui/MilikLoader';
import ListErrorState from '../../../../../components/ui/ListErrorState';
import { fmtMoney, apiError } from '../../../../../utils/pmsFormat';
import { fmtDayMonth, INVOICE_CATEGORY_LABEL } from '../../../../../utils/pmsBilling';

type TenantInfo = { _id: string; name?: string; balance?: number };

type RawInvoice = {
  _id:            string;
  invoiceNumber?: string;
  category?:      string;
  amount:         number;
  invoiceDate?:   string;
  dueDate?:       string;
  createdAt?:     string;
  status?:        string;
  metadata?:      { billItemLabel?: string } | null;
};

type RawNote = {
  _id:         string;
  noteNumber?: string;
  noteType?:   string;
  category?:   string;
  amount:      number;
  noteDate?:   string;
  createdAt?:  string;
  status?:     string;
  description?: string;
};

type RawPayment = {
  _id:              string;
  receiptNumber?:   string;
  referenceNumber?: string;
  description?:     string;
  amount:           number;
  paymentDate?:     string;
  createdAt?:       string;
  isConfirmed?:     boolean;
  isReversed?:      boolean;
  isCancelled?:     boolean;
  reversalOf?:      string | null;
  postingStatus?:   string;
};

type EntryType = 'invoice' | 'debit_note' | 'credit_note' | 'payment';

type Entry = {
  id:          string;
  date:        Date;
  ref:         string;
  description: string;
  debit:       number;
  credit:      number;
  type:        EntryType;
};

type LedgerRow = Entry & { balance: number };

type Period = '3M' | '6M' | '1Y' | 'All';

const PERIODS: Period[] = ['3M', '6M', '1Y', 'All'];

const cutoffDate = (p: Period): Date | null => {
  if (p === 'All') return null;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (p === '3M') d.setMonth(d.getMonth() - 3);
  else if (p === '6M') d.setMonth(d.getMonth() - 6);
  else if (p === '1Y') d.setFullYear(d.getFullYear() - 1);
  return d;
};

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const fmtAmt = (n: number): string => (n > 0.009 ? fmtMoney(n) : '—');
const fmtBal = (n: number): string => fmtMoney(Math.abs(n));

const TYPE_RANK: Record<EntryType, number> = { invoice: 0, debit_note: 1, credit_note: 2, payment: 3 };

// Same narration style as the web statement: "Rent Charge – September 2026".
const describeInvoice = (inv: RawInvoice, d: Date): string => {
  const cat  = inv.category ?? '';
  const base = inv.metadata?.billItemLabel
    || (cat === 'RENT_CHARGE' ? 'Rent Charge'
      : cat === 'UTILITY_CHARGE' ? 'Utility Charge'
      : cat === 'DEPOSIT_CHARGE' ? 'Deposit Charge'
      : INVOICE_CATEGORY_LABEL[cat] || 'Charge');
  return `${base} – ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
};

const dateOf = (...vals: (string | undefined)[]): Date => {
  for (const v of vals) {
    if (!v) continue;
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
};

// Mirrors the web isActiveReceipt(): confirmed, not reversed / cancelled, not a reversal entry.
const isActiveReceipt = (p: RawPayment) =>
  p.isConfirmed === true && p.isCancelled !== true && p.isReversed !== true && !p.reversalOf &&
  String(p.postingStatus || '').toLowerCase() !== 'reversed';

export default function TenantStatementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [tenant,     setTenant]     = useState<TenantInfo | null>(null);
  const [invoices,   setInvoices]   = useState<RawInvoice[]>([]);
  const [notes,      setNotes]      = useState<RawNote[]>([]);
  const [payments,   setPayments]   = useState<RawPayment[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [period,     setPeriod]     = useState<Period>('6M');

  const load = useCallback(async () => {
    try {
      // One round trip: tenant + invoices + credit/debit notes + confirmed receipts.
      const { data } = await api.get(`/tenants/${id}/statement-bundle`);
      setTenant(data?.tenant ?? null);
      setInvoices(Array.isArray(data?.invoices) ? data.invoices : []);
      setNotes(Array.isArray(data?.invoiceNotes) ? data.invoiceNotes : []);
      setPayments(Array.isArray(data?.receipts?.items) ? data.receipts.items : []);
      setError(null);
    } catch (e) {
      setError(apiError(e, 'Could not load the statement.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const { rows, totalCharged, totalPaid, openingBalance, closingBalance } = useMemo(() => {
    const all: Entry[] = [];

    for (const inv of invoices) {
      const st = String(inv.status || '').toLowerCase();
      if (st === 'cancelled' || st === 'reversed') continue;
      const d = dateOf(inv.invoiceDate, inv.createdAt, inv.dueDate);
      all.push({
        id: inv._id, date: d, type: 'invoice',
        ref: inv.invoiceNumber || '',
        description: describeInvoice(inv, d),
        debit: Number(inv.amount || 0), credit: 0,
      });
    }

    for (const n of notes) {
      const st = String(n.status || '').toLowerCase();
      if (st === 'cancelled' || st === 'reversed') continue;
      const isCredit = String(n.noteType || '').toUpperCase() === 'CREDIT_NOTE';
      const amt = Math.abs(Number(n.amount || 0));
      all.push({
        id: n._id, date: dateOf(n.noteDate, n.createdAt), type: isCredit ? 'credit_note' : 'debit_note',
        ref: n.noteNumber || '',
        description: n.description || (isCredit ? 'Credit Note' : 'Debit Note'),
        debit: isCredit ? 0 : amt, credit: isCredit ? amt : 0,
      });
    }

    for (const p of payments) {
      if (!isActiveReceipt(p)) continue;
      all.push({
        id: p._id, date: dateOf(p.paymentDate, p.createdAt), type: 'payment',
        ref: p.receiptNumber || p.referenceNumber || '',
        description: p.referenceNumber ? `Payment – ${p.referenceNumber}` : 'Payment',
        debit: 0, credit: Math.abs(Number(p.amount || 0)),
      });
    }

    all.sort((a, b) => a.date.getTime() - b.date.getTime() || TYPE_RANK[a.type] - TYPE_RANK[b.type]);

    // Everything before the cut-off is folded into an opening balance.
    const cutoff = cutoffDate(period);
    let opening = 0;
    const inPeriod: Entry[] = [];
    for (const e of all) {
      if (cutoff && e.date < cutoff) opening += e.debit - e.credit;
      else inPeriod.push(e);
    }

    let balance = opening;
    let charged = 0;
    let paid = 0;
    const ledger: LedgerRow[] = inPeriod.map(e => {
      balance += e.debit - e.credit;
      charged += e.debit;
      paid    += e.credit;
      return { ...e, balance };
    });

    return { rows: ledger, totalCharged: charged, totalPaid: paid, openingBalance: opening, closingBalance: balance };
  }, [invoices, notes, payments, period]);

  const accountBalance = Number(tenant?.balance ?? 0);

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Statement' }} />
        <SafeAreaView style={styles.safe} edges={['bottom']}>
          <MilikLoader fullscreen />
        </SafeAreaView>
      </>
    );
  }

  if (error && !tenant) {
    return (
      <>
        <Stack.Screen options={{ title: 'Statement' }} />
        <SafeAreaView style={styles.safe} edges={['bottom']}>
          <ListErrorState message={error} onRetry={() => { setLoading(true); load(); }} />
        </SafeAreaView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: tenant?.name ? `${tenant.name} — Statement` : 'Statement' }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={Colors.primary}
            />
          }
        >
          {/* Period selector */}
          <View style={styles.periodRow}>
            {PERIODS.map((p) => (
              <TouchableOpacity
                key={p}
                style={[styles.periodTab, period === p && styles.periodTabActive]}
                onPress={() => setPeriod(p)}
                activeOpacity={0.75}
              >
                <Text style={[styles.periodTabText, period === p && styles.periodTabTextActive]}>
                  {p}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Summary card */}
          <View style={styles.summaryCard}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>INVOICED</Text>
              <Text style={[styles.summaryValue, { color: Colors.danger }]}>{fmtMoney(totalCharged)}</Text>
            </View>
            <View style={[styles.summaryItem, styles.summaryBorder]}>
              <Text style={styles.summaryLabel}>RECEIVED</Text>
              <Text style={[styles.summaryValue, { color: Colors.success }]}>{fmtMoney(totalPaid)}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>NET BALANCE</Text>
              <Text style={[styles.summaryValue, { color: closingBalance > 0.009 ? Colors.danger : Colors.success }]}>
                {fmtBal(closingBalance)}
              </Text>
              <Text style={{ fontSize: 9, fontWeight: '700', color: closingBalance > 0.009 ? Colors.danger : Colors.success }}>
                {closingBalance > 0.009 ? 'DR' : closingBalance < -0.009 ? 'CR' : ''}
              </Text>
            </View>
          </View>

          {/* Server-side account balance (authoritative) */}
          {tenant?.balance != null ? (
            <View style={styles.accountBalanceRow}>
              <Text style={styles.accountBalanceLabel}>Current account balance</Text>
              <Text style={[styles.accountBalanceValue, { color: accountBalance > 0.009 ? Colors.danger : Colors.success }]}>
                {accountBalance > 0.009 ? `KES ${fmtMoney(accountBalance)}`
                  : accountBalance < -0.009 ? `CR ${fmtMoney(-accountBalance)}` : 'Settled'}
              </Text>
            </View>
          ) : null}

          {/* Running balance table — horizontal scroll */}
          <View style={styles.tableWrap}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.tableInner}>
                {/* Header */}
                <View style={[styles.tableRow, styles.tableHeader]}>
                  <Text style={[styles.th, styles.colDate]}>DATE</Text>
                  <Text style={[styles.th, styles.colDesc]}>DESCRIPTION</Text>
                  <Text style={[styles.th, styles.colAmt, styles.right]}>DEBIT</Text>
                  <Text style={[styles.th, styles.colAmt, styles.right]}>CREDIT</Text>
                  <Text style={[styles.th, styles.colAmt, styles.right]}>BALANCE</Text>
                </View>

                {/* Opening balance row */}
                {Math.abs(openingBalance) > 0.009 && (
                  <View style={[styles.tableRow, styles.rowOpening]}>
                    <Text style={[styles.td, styles.colDate, { color: Colors.textMuted }]}>B/F</Text>
                    <Text style={[styles.td, styles.colDesc, { color: Colors.textMuted, fontStyle: 'italic' }]}>Opening Balance</Text>
                    <Text style={[styles.td, styles.colAmt, styles.right, { color: Colors.textMuted }]}>—</Text>
                    <Text style={[styles.td, styles.colAmt, styles.right, { color: Colors.textMuted }]}>—</Text>
                    <Text style={[styles.td, styles.tdBold, styles.colAmt, styles.right, { color: openingBalance > 0 ? Colors.danger : Colors.success }]}>
                      {fmtBal(openingBalance)}
                    </Text>
                  </View>
                )}

                {rows.length === 0 && Math.abs(openingBalance) <= 0.009 ? (
                  <View style={styles.emptyWrap}>
                    <Text style={styles.emptyText}>No transactions in this period</Text>
                  </View>
                ) : (
                  rows.map((row, i) => (
                    <View
                      key={`${row.type}-${row.id}`}
                      style={[
                        styles.tableRow,
                        row.type === 'payment' || row.type === 'credit_note' ? styles.rowPayment : styles.rowInvoice,
                        i === rows.length - 1 && styles.tableRowLast,
                      ]}
                    >
                      <Text style={[styles.td, styles.colDate]} numberOfLines={1}>
                        {fmtDayMonth(row.date)}
                      </Text>
                      <View style={[styles.colDesc, styles.descCell]}>
                        <Text style={styles.descText} numberOfLines={2}>{row.description}</Text>
                        {row.ref ? <Text style={styles.refText} numberOfLines={1}>{row.ref}</Text> : null}
                      </View>
                      <Text style={[styles.td, styles.colAmt, styles.right, { color: row.debit > 0 ? Colors.danger : Colors.textMuted }]}>
                        {fmtAmt(row.debit)}
                      </Text>
                      <Text style={[styles.td, styles.colAmt, styles.right, { color: row.credit > 0 ? Colors.success : Colors.textMuted }]}>
                        {fmtAmt(row.credit)}
                      </Text>
                      <Text style={[styles.td, styles.tdBold, styles.colAmt, styles.right, { color: row.balance > 0.009 ? Colors.danger : Colors.success }]}>
                        {fmtBal(row.balance)}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </ScrollView>
          </View>

          {/* Export hint */}
          <View style={styles.exportHint}>
            <Ionicons name="share-outline" size={15} color={Colors.textMuted} />
            <Text style={styles.exportHintText}>
              For a full PDF statement, visit the web portal or contact your admin.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, paddingBottom: 48, gap: 16 },

  periodRow: {
    flexDirection: 'row', gap: 4,
    backgroundColor: Colors.white,
    borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    padding: 4,
  },
  periodTab:         { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9 },
  periodTabActive:   { backgroundColor: Colors.primary },
  periodTabText:     { fontSize: 13, fontWeight: '700', color: Colors.textMuted },
  periodTabTextActive: { color: Colors.white },

  summaryCard: {
    flexDirection: 'row',
    backgroundColor: Colors.white,
    borderRadius: 14, borderWidth: 1, borderColor: Colors.border,
    padding: 16,
  },
  summaryItem:   { flex: 1, alignItems: 'center', gap: 4 },
  summaryBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: Colors.border },
  summaryLabel:  { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: Colors.textMuted },
  summaryValue:  { fontSize: 13, fontWeight: '800', textAlign: 'center' },

  accountBalanceRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  accountBalanceLabel: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600' },
  accountBalanceValue: { fontSize: 14, fontWeight: '800' },

  tableWrap: {
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  tableInner: { minWidth: 500 },

  tableRow:     { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border },
  tableRowLast: { borderBottomWidth: 0 },
  tableHeader:  { backgroundColor: Colors.primaryFaded },
  rowInvoice:   { backgroundColor: Colors.dangerLight },
  rowPayment:   { backgroundColor: Colors.successLight },
  rowOpening:   { backgroundColor: '#F8FAFC' },

  th: {
    fontSize: 9, fontWeight: '800', letterSpacing: 0.6, color: Colors.primary,
    paddingVertical: 9, paddingHorizontal: 8,
  },
  td: {
    fontSize: 11, color: Colors.text,
    paddingVertical: 11, paddingHorizontal: 8,
  },
  tdBold: { fontWeight: '800' },

  descCell: { paddingVertical: 9, paddingHorizontal: 8, gap: 2, justifyContent: 'center' },
  descText: { fontSize: 11, color: Colors.text },
  refText:  { fontSize: 10, color: Colors.textMuted },

  colDate: { width: 64 },
  colDesc: { width: 170 },
  colAmt:  { width: 88 },
  right:   { textAlign: 'right' },

  emptyWrap: { padding: 28, alignItems: 'center' },
  emptyText: { fontSize: 13, color: Colors.textMuted },

  exportHint: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    justifyContent: 'center',
  },
  exportHintText: { flex: 1, fontSize: 12, color: Colors.textMuted },
});
