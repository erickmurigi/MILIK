import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, SectionList, ActivityIndicator,
  TouchableOpacity, RefreshControl, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Colors } from '../../../../../constants/colors';
import api from '../../../../../services/api';
import MilikLoader from '../../../../../components/ui/MilikLoader';

// ── Types ─────────────────────────────────────────────────────────────────────
type StatementLine = {
  key:         string;
  date:        Date;
  description: string;
  subdesc?:    string;
  debit:       number;
  credit:      number;
  balance:     number;
  type:        'invoice' | 'payment';
  status?:     string;
};

type SectionData = {
  title:          string;
  data:           StatementLine[];
  openingBalance: number;
  closingBalance: number;
};

// ── Constants ─────────────────────────────────────────────────────────────────
const PERIODS = [
  { key: '3m',  label: '3M'  },
  { key: '6m',  label: '6M'  },
  { key: '1y',  label: '1Y'  },
  { key: 'all', label: 'All' },
] as const;
type PeriodKey = typeof PERIODS[number]['key'];

const INVOICE_CATEGORY_LABEL: Record<string, string> = {
  RENT_CHARGE:    'Rent',
  UTILITY_CHARGE: 'Utility',
  DEPOSIT_CHARGE: 'Deposit',
  PENALTY_CHARGE: 'Late Penalty',
  DEBIT_NOTE:     'Debit Note',
  TAKE_ON_DEBIT:  'Take-on Balance',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
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

const periodFromDate = (key: PeriodKey): Date | null => {
  if (key === 'all') return null;
  const now = new Date();
  if (key === '3m') return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
  if (key === '6m') return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
  if (key === '1y') return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  return null;
};

// ── Screen ────────────────────────────────────────────────────────────────────
export default function TenantStatementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [tenantName, setTenantName] = useState('');
  const [lines,      setLines]      = useState<StatementLine[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [period,     setPeriod]     = useState<PeriodKey>('all');

  const loadStatement = async () => {
    try {
      const [tenantRes, invRes, payRes] = await Promise.all([
        api.get(`/tenants/${id}`),
        api.get('/tenant-invoices',      { params: { tenant: id, limit: 500, page: 1 } }),
        api.get(`/tenants/payments/${id}`, { params: { limit: 500 } }),
      ]);

      const tenant = tenantRes.data.data || tenantRes.data;
      setTenantName(tenant.name || '');

      const invoices: any[] = invRes.data.data  || [];
      const payments: any[] = payRes.data.data  || [];

      const raw: Omit<StatementLine, 'balance'>[] = [];

      for (const inv of invoices) {
        if (['cancelled', 'reversed'].includes(inv.status)) continue;
        raw.push({
          key:         `inv-${inv._id}`,
          date:        new Date(inv.invoiceDate || inv.createdAt),
          description: inv.description?.trim() || INVOICE_CATEGORY_LABEL[inv.category] || inv.category || 'Invoice',
          subdesc:     inv.invoiceNumber || undefined,
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
          description: pay.description?.trim() || pay.narration?.trim() || 'Payment Received',
          subdesc:     pay.receiptNumber || pay.referenceNumber || undefined,
          debit:       0,
          credit:      Number(pay.amount || 0),
          type:        'payment',
          status:      pay.isConfirmed ? 'confirmed' : 'unconfirmed',
        });
      }

      // Sort ascending — running balance must be computed chronologically
      raw.sort((a, b) => a.date.getTime() - b.date.getTime());

      let running = 0;
      const withBalance: StatementLine[] = raw.map((line) => {
        running += line.debit - line.credit;
        return { ...line, balance: running };
      });

      setLines(withBalance);
    } catch { /* fail silently */ }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { loadStatement(); }, [id]);
  const onRefresh = () => { setRefreshing(true); loadStatement(); };

  // ── Period filter ─────────────────────────────────────────────────────────
  const fromDate = useMemo(() => periodFromDate(period), [period]);

  // Lines visible in the selected period
  const periodLines = useMemo(
    () => fromDate ? lines.filter((l) => l.date >= fromDate) : lines,
    [lines, fromDate],
  );

  // Opening balance = balance of the last line BEFORE the period window
  const openingBalance = useMemo(() => {
    if (!fromDate || lines.length === 0) return 0;
    const before = lines.filter((l) => l.date < fromDate);
    return before.length > 0 ? before[before.length - 1].balance : 0;
  }, [lines, fromDate]);

  // ── Group by month ─────────────────────────────────────────────────────────
  const sections: SectionData[] = useMemo(() => {
    const map = new Map<string, StatementLine[]>();
    for (const line of periodLines) {
      const k = monthKey(line.date);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(line);
    }

    // oldest month first → user reads down the page as time progresses
    const sortedKeys = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));

    return sortedKeys.map((k) => {
      const monthLines = map.get(k)!;
      const firstIdx   = periodLines.indexOf(monthLines[0]);
      const openBal    = firstIdx > 0 ? periodLines[firstIdx - 1].balance : openingBalance;
      const closeBal   = monthLines[monthLines.length - 1].balance;
      return {
        title:          monthLabel(k),
        data:           monthLines, // already chronological (oldest first)
        openingBalance: openBal,
        closingBalance: closeBal,
      };
    });
  }, [periodLines, openingBalance]);

  // ── Summary values for selected period ────────────────────────────────────
  const periodTotals = useMemo(() => ({
    charged: periodLines.reduce((s, l) => s + l.debit, 0),
    paid:    periodLines.reduce((s, l) => s + l.credit, 0),
  }), [periodLines]);

  // Current balance is always the overall running balance (last line of all transactions)
  const currentBalance = lines.length > 0 ? lines[lines.length - 1].balance : 0;

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
        <Text style={styles.lineDate}>
          {item.subdesc ? `${item.subdesc} · ` : ''}{fmtDate(item.date)}
        </Text>
      </View>
      <View style={styles.lineAmounts}>
        {item.debit > 0
          ? <Text style={styles.debit}>+{fmt(item.debit)}</Text>
          : <Text style={styles.credit}>−{fmt(item.credit)}</Text>}
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
        <MilikLoader fullscreen />
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
            <Text style={styles.summaryLabel}>CHARGED</Text>
            <Text style={styles.summaryValue}>{fmt(periodTotals.charged)}</Text>
          </View>
          <View style={[styles.summaryItem, styles.summaryBorder]}>
            <Text style={styles.summaryLabel}>PAID</Text>
            <Text style={[styles.summaryValue, { color: Colors.success }]}>{fmt(periodTotals.paid)}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>BALANCE</Text>
            <Text style={[styles.summaryValue, { color: currentBalance > 0 ? Colors.danger : Colors.success }]}>
              {fmt(currentBalance)}
            </Text>
          </View>
        </View>

        {/* Period filter chips */}
        <View style={styles.periodRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.periodScroll}>
            {PERIODS.map((p) => (
              <TouchableOpacity
                key={p.key}
                style={[styles.periodChip, period === p.key && styles.periodChipActive]}
                onPress={() => setPeriod(p.key)}
              >
                <Text style={[styles.periodChipText, period === p.key && styles.periodChipTextActive]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}

            {fromDate && openingBalance !== 0 ? (
              <View style={styles.openingBadge}>
                <Text style={styles.openingBadgeText}>
                  Opening: KES {openingBalance > 0 ? '' : '−'}{fmt(openingBalance)}
                </Text>
              </View>
            ) : null}
          </ScrollView>
        </View>

        {/* Column headers */}
        <View style={styles.colHeader}>
          <Text style={[styles.colLabel, { flex: 1 }]}>TRANSACTION</Text>
          <Text style={[styles.colLabel, styles.colRight]}>AMOUNT</Text>
          <Text style={[styles.colLabel, styles.colRight]}>BALANCE</Text>
        </View>

        {periodLines.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons name="document-text-outline" size={48} color={Colors.border} />
            <Text style={styles.emptyText}>No transactions in this period</Text>
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
                  {periodLines.length} transaction{periodLines.length !== 1 ? 's' : ''}
                  {fromDate ? ` · ${period === '3m' ? 'Last 3 months' : period === '6m' ? 'Last 6 months' : 'Last year'}` : ' · All time'}
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
  safe:     { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
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

  /* Period filter */
  periodRow:    { borderBottomWidth: 1, borderBottomColor: Colors.border },
  periodScroll: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  periodChip: {
    paddingHorizontal: 16, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  periodChipActive:    { backgroundColor: Colors.primary, borderColor: Colors.primary },
  periodChipText:      { fontSize: 12, fontWeight: '700', color: Colors.textSecondary },
  periodChipTextActive:{ color: Colors.white },

  openingBadge: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, backgroundColor: Colors.borderLight,
    borderWidth: 1, borderColor: Colors.border,
  },
  openingBadgeText: { fontSize: 11, fontWeight: '600', color: Colors.textMuted },

  /* Column headers */
  colHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: Colors.background,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  colLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: Colors.textMuted },
  colRight: { width: 80, textAlign: 'right' },

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
