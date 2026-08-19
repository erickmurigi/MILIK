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

type TenantInfo = { _id: string; name: string };

type RawInvoice = {
  _id:            string;
  invoiceNumber?: string;
  category?:      string;
  amount:         number;
  dueDate?:       string;
  createdAt?:     string;
};

type RawPayment = {
  _id:            string;
  receiptNumber?: string;
  amount:         number;
  paymentDate?:   string;
};

type LedgerRow = {
  id:          string;
  date:        Date;
  description: string;
  debit:       number;
  credit:      number;
  balance:     number;
  type:        'invoice' | 'payment';
};

type Period = '3M' | '6M' | '1Y' | 'All';

const PERIODS: Period[] = ['3M', '6M', '1Y', 'All'];

const cutoffDate = (p: Period): Date | null => {
  if (p === 'All') return null;
  const d = new Date();
  if (p === '3M') d.setMonth(d.getMonth() - 3);
  else if (p === '6M') d.setMonth(d.getMonth() - 6);
  else if (p === '1Y') d.setFullYear(d.getFullYear() - 1);
  return d;
};

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-KE', { day: '2-digit', month: 'short' });

const fmtAmt = (n: number): string =>
  n > 0 ? n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

const fmtBal = (n: number): string =>
  Math.abs(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function TenantStatementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [tenant,     setTenant]     = useState<TenantInfo | null>(null);
  const [invoices,   setInvoices]   = useState<RawInvoice[]>([]);
  const [payments,   setPayments]   = useState<RawPayment[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [period,     setPeriod]     = useState<Period>('6M');

  const load = useCallback(async () => {
    const [tenantRes, invRes, payRes] = await Promise.allSettled([
      api.get(`/tenants/${id}`),
      api.get('/tenant-invoices',      { params: { tenant: id, limit: 200 } }),
      api.get(`/tenants/payments/${id}`, { params: { limit: 200 } }),
    ]);

    if (tenantRes.status === 'fulfilled') {
      const d = tenantRes.value.data;
      setTenant(d.data || d);
    }
    if (invRes.status === 'fulfilled') {
      setInvoices(invRes.value.data?.data ?? []);
    }
    if (payRes.status === 'fulfilled') {
      setPayments(payRes.value.data?.data ?? []);
    }

    setLoading(false);
    setRefreshing(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const { rows, totalCharged, totalPaid } = useMemo(() => {
    const cutoff = cutoffDate(period);
    const entries: Omit<LedgerRow, 'balance'>[] = [];

    for (const inv of invoices) {
      const d = new Date(inv.dueDate || inv.createdAt || Date.now());
      if (cutoff && d < cutoff) continue;
      entries.push({
        id:          inv._id,
        date:        d,
        description: inv.invoiceNumber || inv.category || 'Invoice',
        debit:       inv.amount,
        credit:      0,
        type:        'invoice',
      });
    }

    for (const pay of payments) {
      const d = new Date(pay.paymentDate || Date.now());
      if (cutoff && d < cutoff) continue;
      entries.push({
        id:          pay._id,
        date:        d,
        description: pay.receiptNumber || 'Payment',
        debit:       0,
        credit:      pay.amount,
        type:        'payment',
      });
    }

    entries.sort((a, b) => a.date.getTime() - b.date.getTime());

    let balance      = 0;
    let totalCharged = 0;
    let totalPaid    = 0;

    const rows: LedgerRow[] = entries.map((e) => {
      balance      += e.debit - e.credit;
      totalCharged += e.debit;
      totalPaid    += e.credit;
      return { ...e, balance };
    });

    return { rows, totalCharged, totalPaid };
  }, [invoices, payments, period]);

  const balanceDue = totalCharged - totalPaid;

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

  return (
    <>
      <Stack.Screen options={{ title: tenant ? `${tenant.name} — Statement` : 'Statement' }} />
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
              <Text style={styles.summaryLabel}>TOTAL CHARGED</Text>
              <Text style={[styles.summaryValue, { color: Colors.danger }]}>
                {totalCharged.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Text>
            </View>
            <View style={[styles.summaryItem, styles.summaryBorder]}>
              <Text style={styles.summaryLabel}>TOTAL PAID</Text>
              <Text style={[styles.summaryValue, { color: Colors.success }]}>
                {totalPaid.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>BALANCE DUE</Text>
              <Text style={[styles.summaryValue, { color: balanceDue > 0 ? Colors.danger : Colors.success }]}>
                {fmtBal(balanceDue)}
              </Text>
            </View>
          </View>

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

                {rows.length === 0 ? (
                  <View style={styles.emptyWrap}>
                    <Text style={styles.emptyText}>No transactions in this period</Text>
                  </View>
                ) : (
                  rows.map((row, i) => (
                    <View
                      key={`${row.id}-${i}`}
                      style={[
                        styles.tableRow,
                        row.type === 'invoice' ? styles.rowInvoice : styles.rowPayment,
                        i === rows.length - 1 && styles.tableRowLast,
                      ]}
                    >
                      <Text style={[styles.td, styles.colDate]} numberOfLines={1}>
                        {fmtDate(row.date)}
                      </Text>
                      <Text style={[styles.td, styles.colDesc]} numberOfLines={1}>
                        {row.description}
                      </Text>
                      <Text style={[styles.td, styles.colAmt, styles.right, { color: row.debit > 0 ? Colors.danger : Colors.textMuted }]}>
                        {fmtAmt(row.debit)}
                      </Text>
                      <Text style={[styles.td, styles.colAmt, styles.right, { color: row.credit > 0 ? Colors.success : Colors.textMuted }]}>
                        {fmtAmt(row.credit)}
                      </Text>
                      <Text style={[styles.td, styles.tdBold, styles.colAmt, styles.right, { color: row.balance > 0 ? Colors.danger : Colors.success }]}>
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

  tableWrap: {
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  tableInner: { minWidth: 480 },

  tableRow:     { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border },
  tableRowLast: { borderBottomWidth: 0 },
  tableHeader:  { backgroundColor: Colors.primaryFaded },
  rowInvoice:   { backgroundColor: Colors.dangerLight },
  rowPayment:   { backgroundColor: Colors.successLight },

  th: {
    fontSize: 9, fontWeight: '800', letterSpacing: 0.6, color: Colors.primary,
    paddingVertical: 9, paddingHorizontal: 8,
  },
  td: {
    fontSize: 11, color: Colors.text,
    paddingVertical: 11, paddingHorizontal: 8,
  },
  tdBold: { fontWeight: '800' },

  colDate: { width: 68 },
  colDesc: { width: 150 },
  colAmt:  { width: 80 },
  right:   { textAlign: 'right' },

  emptyWrap: { padding: 28, alignItems: 'center' },
  emptyText: { fontSize: 13, color: Colors.textMuted },

  exportHint: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    justifyContent: 'center',
  },
  exportHintText: { flex: 1, fontSize: 12, color: Colors.textMuted },
});
