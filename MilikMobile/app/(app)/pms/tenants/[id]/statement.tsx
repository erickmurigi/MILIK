import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, SectionList, ActivityIndicator,
  TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Colors } from '../../../../../constants/colors';
import api from '../../../../../services/api';

// ── Types ────────────────────────────────────────────────────────────────────
type StatementLine = {
  key:         string;
  date:        Date;
  description: string;
  debit:       number;
  credit:      number;
  balance:     number;
  type:        'invoice' | 'payment' | 'note';
  status?:     string;
};

type SectionData = {
  title: string;        // e.g. "August 2026"
  data:  StatementLine[];
  openingBalance: number;
  closingBalance: number;
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  Math.abs(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });

const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

const monthLabel = (key: string) => {
  const [y, m] = key.split('-');
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
};

const INVOICE_CATEGORY_LABEL: Record<string, string> = {
  RENT_CHARGE:     'Rent',
  UTILITY_CHARGE:  'Utility',
  DEPOSIT_CHARGE:  'Deposit',
  PENALTY_CHARGE:  'Late Penalty',
  DEBIT_NOTE:      'Debit Note',
  TAKE_ON_DEBIT:   'Take-on Balance',
};

// ── Screen ───────────────────────────────────────────────────────────────────
export default function TenantStatementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [tenantName, setTenantName] = useState('');
  const [lines,      setLines]      = useState<StatementLine[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter,     setFilter]     = useState<'all' | 'unpaid'>('all');

  const loadStatement = async () => {
    try {
      const [tenantRes, invRes, payRes] = await Promise.all([
        api.get(`/tenants/${id}`),
        api.get('/tenant-invoices', { params: { tenant: id, limit: 500, page: 1 } }),
        api.get(`/tenants/payments/${id}`, { params: { limit: 500 } }),
      ]);

      const tenant   = tenantRes.data.data || tenantRes.data;
      setTenantName(tenant.name || '');

      const invoices: any[] = invRes.data.data  || [];
      const payments: any[] = payRes.data.data || [];

      // Build raw lines (no running balance yet)
      const raw: Omit<StatementLine, 'balance'>[] = [];

      for (const inv of invoices) {
        if (['cancelled', 'reversed'].includes(inv.status)) continue;
        raw.push({
          key:         `inv-${inv._id}`,
          date:        new Date(inv.invoiceDate || inv.createdAt),
          description: `${INVOICE_CATEGORY_LABEL[inv.category] || inv.category || 'Invoice'} · ${inv.invoiceNumber || ''}`.trim().replace(/·\s*$/, ''),
          debit:       Number(inv.amount || 0),
          credit:      0,
          type:        'invoice',
          status:      inv.status,
        });
      }

      for (const pay of payments) {
        if (pay.isReversed || pay.isCancelled) continue;
        raw.push({
          key:         `pay-${pay._id}`,
          date:        new Date(pay.paymentDate || pay.createdAt),
          description: `Receipt ${pay.receiptNumber || ''}`.trim(),
          debit:       0,
          credit:      Number(pay.amount || 0),
          type:        'payment',
          status:      pay.isConfirmed ? 'confirmed' : 'unconfirmed',
        });
      }

      // Sort ascending by date for running balance computation
      raw.sort((a, b) => a.date.getTime() - b.date.getTime());

      // Compute running balance (positive = owes, negative = credit)
      let running = 0;
      const withBalance: StatementLine[] = raw.map((line) => {
        running += line.debit - line.credit;
        return { ...line, balance: running };
      });

      setLines(withBalance);
    } catch (err) {
      console.error('Statement load error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadStatement(); }, [id]);
  const onRefresh = () => { setRefreshing(true); loadStatement(); };

  // ── Group by month (descending) ────────────────────────────────────────────
  const sections: SectionData[] = useMemo(() => {
    const filtered = filter === 'unpaid'
      ? lines.filter((l) => l.type === 'invoice' && l.status === 'unpaid')
      : lines;

    // Group by month key
    const map = new Map<string, StatementLine[]>();
    for (const line of filtered) {
      const k = monthKey(line.date);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(line);
    }

    // Sort months descending (newest first)
    const sortedKeys = Array.from(map.keys()).sort((a, b) => b.localeCompare(a));

    return sortedKeys.map((k) => {
      const monthLines = map.get(k)!;
      // opening = balance of the line just before the first line of this month
      const firstIdx    = lines.indexOf(monthLines[0]);
      const openBal     = firstIdx > 0 ? lines[firstIdx - 1].balance : 0;
      const closeBal    = monthLines[monthLines.length - 1].balance;
      return {
        title:          monthLabel(k),
        data:           [...monthLines].reverse(), // newest first within month
        openingBalance: openBal,
        closingBalance: closeBal,
      };
    });
  }, [lines, filter]);

  const totals = useMemo(() => ({
    debits:  lines.reduce((s, l) => s + l.debit, 0),
    credits: lines.reduce((s, l) => s + l.credit, 0),
    balance: lines.length > 0 ? lines[lines.length - 1].balance : 0,
  }), [lines]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const renderLine = ({ item }: { item: StatementLine }) => (
    <View style={styles.line}>
      <View style={[
        styles.lineIcon,
        { backgroundColor: item.type === 'invoice' ? Colors.dangerLight : Colors.successLight },
      ]}>
        <Ionicons
          name={item.type === 'invoice' ? 'receipt-outline' : 'cash-outline'}
          size={14}
          color={item.type === 'invoice' ? Colors.danger : Colors.success}
        />
      </View>
      <View style={styles.lineBody}>
        <Text style={styles.lineDesc} numberOfLines={1}>{item.description}</Text>
        <Text style={styles.lineDate}>{fmtDate(item.date)}</Text>
      </View>
      <View style={styles.lineAmounts}>
        {item.debit > 0 ? (
          <Text style={styles.debit}>+{fmt(item.debit)}</Text>
        ) : (
          <Text style={styles.credit}>−{fmt(item.credit)}</Text>
        )}
        <Text style={[styles.runningBal, { color: item.balance > 0 ? Colors.danger : Colors.success }]}>
          {fmt(item.balance)}
        </Text>
      </View>
    </View>
  );

  const renderSectionHeader = ({ section }: { section: SectionData }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{section.title}</Text>
      <Text style={[
        styles.sectionBalance,
        { color: section.closingBalance > 0 ? Colors.danger : Colors.success },
      ]}>
        Closing: KES {fmt(section.closingBalance)}
      </Text>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Statement' }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: `${tenantName} · Statement` }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>

        {/* Summary strip */}
        <View style={styles.summary}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>TOTAL CHARGED</Text>
            <Text style={styles.summaryValue}>{fmt(totals.debits)}</Text>
          </View>
          <View style={[styles.summaryItem, styles.summaryBorder]}>
            <Text style={styles.summaryLabel}>TOTAL PAID</Text>
            <Text style={[styles.summaryValue, { color: Colors.success }]}>{fmt(totals.credits)}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>BALANCE</Text>
            <Text style={[styles.summaryValue, { color: totals.balance > 0 ? Colors.danger : Colors.success }]}>
              {fmt(totals.balance)}
            </Text>
          </View>
        </View>

        {/* Column headers */}
        <View style={styles.colHeader}>
          <Text style={[styles.colLabel, { flex: 1 }]}>TRANSACTION</Text>
          <Text style={[styles.colLabel, styles.colRight]}>AMOUNT</Text>
          <Text style={[styles.colLabel, styles.colRight]}>BALANCE</Text>
        </View>

        {lines.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons name="document-text-outline" size={48} color={Colors.border} />
            <Text style={styles.emptyText}>No transactions found</Text>
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.key}
            renderItem={renderLine}
            renderSectionHeader={renderSectionHeader}
            contentContainerStyle={styles.list}
            stickySectionHeadersEnabled
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
            }
            ListFooterComponent={() => (
              <View style={styles.footer}>
                <Text style={styles.footerText}>
                  {lines.length} transactions · Opening balance 0.00
                </Text>
              </View>
            )}
          />
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  centered:{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText:{ fontSize: 15, color: Colors.textMuted },

  /* Summary strip */
  summary: {
    flexDirection: 'row',
    backgroundColor: Colors.primary,
    paddingVertical: 14, paddingHorizontal: 20,
  },
  summaryItem:   { flex: 1, alignItems: 'center', gap: 3 },
  summaryBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  summaryLabel:  { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: 'rgba(255,255,255,0.6)' },
  summaryValue:  { fontSize: 14, fontWeight: '800', color: Colors.white },

  /* Column headers */
  colHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: Colors.background,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  colLabel:  { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: Colors.textMuted },
  colRight:  { width: 80, textAlign: 'right' },

  /* Section header */
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: Colors.borderLight,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: Colors.border,
  },
  sectionTitle:  { fontSize: 12, fontWeight: '800', color: Colors.text },
  sectionBalance:{ fontSize: 11, fontWeight: '700' },

  /* List */
  list: { paddingBottom: 40 },

  /* Line row */
  line: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: Colors.white,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  lineIcon: {
    width: 30, height: 30, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 10,
  },
  lineBody:  { flex: 1, gap: 2 },
  lineDesc:  { fontSize: 13, fontWeight: '600', color: Colors.text },
  lineDate:  { fontSize: 10, color: Colors.textMuted },

  lineAmounts: { alignItems: 'flex-end', gap: 2 },
  debit:       { fontSize: 13, fontWeight: '700', color: Colors.danger },
  credit:      { fontSize: 13, fontWeight: '700', color: Colors.success },
  runningBal:  { fontSize: 11, fontWeight: '600' },

  /* Footer */
  footer:     { padding: 20, alignItems: 'center' },
  footerText: { fontSize: 11, color: Colors.textMuted },
});
