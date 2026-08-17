import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const AC  = '#064E3B';
const ACL = '#ECFDF5';

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtShort = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}KES ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}KES ${(abs / 1_000).toFixed(0)}K`;
  return fmt(n);
};

const today = () => new Date().toISOString().slice(0, 10);
const startOfYear = () => `${new Date().getFullYear()}-01-01`;

type TrialEntry = { account: string; code?: string; debit: number; credit: number };
type ISEntry    = { account: string; amount: number };
type BSEntry    = { account: string; amount: number };

type ReportData = {
  trialBalance?:    { entries: TrialEntry[]; totalDebit: number; totalCredit: number };
  incomeStatement?: { income: ISEntry[]; expenses: ISEntry[]; totalIncome: number; totalExpenses: number; netIncome: number };
  balanceSheet?:    { assets: BSEntry[]; liabilities: BSEntry[]; equity: BSEntry[]; totalAssets: number; totalLiabilities: number; totalEquity: number };
};

type ActiveReport = 'trialBalance' | 'incomeStatement' | 'balanceSheet' | null;

export default function FinancialReportsScreen() {
  const [startDate, setStartDate]   = useState<string>(startOfYear());
  const [endDate,   setEndDate]     = useState<string>(today());
  const [data,      setData]        = useState<ReportData>({});
  const [active,    setActive]      = useState<ActiveReport>(null);
  const [loading,   setLoading]     = useState(false);
  const [refreshing,setRefreshing]  = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const toggleSection = (key: string) =>
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const loadReport = useCallback(async (report: ActiveReport, isRefresh = false) => {
    if (!report) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setActive(report);
    try {
      const params = { startDate, endDate };
      const endpointMap: Record<string, string> = {
        trialBalance:    '/financial-reports/trial-balance',
        incomeStatement: '/financial-reports/income-statement',
        balanceSheet:    '/financial-reports/balance-sheet',
      };
      const { data: res } = await api.get(endpointMap[report], { params });
      const d = res?.data ?? res;
      setData(prev => ({ ...prev, [report]: d }));
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, [startDate, endDate]);

  const REPORTS = [
    { key: 'trialBalance'    as ActiveReport, label: 'Trial Balance',     icon: 'scale-outline',      color: '#1D4ED8' },
    { key: 'incomeStatement' as ActiveReport, label: 'Income Statement',  icon: 'trending-up-outline', color: AC       },
    { key: 'balanceSheet'    as ActiveReport, label: 'Balance Sheet',     icon: 'layers-outline',      color: '#7C3AED'},
  ];

  const renderTrialBalance = () => {
    const tb = data.trialBalance;
    if (!tb) return null;
    const balanced = Math.abs(tb.totalDebit - tb.totalCredit) < 0.01;
    return (
      <View style={styles.reportContent}>
        <View style={[styles.balanceIndicator, { backgroundColor: balanced ? '#D1FAE5' : '#FEE2E2' }]}>
          <Ionicons name={balanced ? 'checkmark-circle' : 'alert-circle'} size={16} color={balanced ? '#065F46' : '#DC2626'} />
          <Text style={[styles.balanceIndicatorTxt, { color: balanced ? '#065F46' : '#DC2626' }]}>
            {balanced ? 'Balanced — Debits = Credits' : `Imbalance: ${fmt(Math.abs(tb.totalDebit - tb.totalCredit))}`}
          </Text>
        </View>
        <View style={styles.tbHeader}>
          <Text style={[styles.tbCol, { flex: 2 }]}>ACCOUNT</Text>
          <Text style={[styles.tbCol, { width: 90, textAlign: 'right' }]}>DEBIT</Text>
          <Text style={[styles.tbCol, { width: 90, textAlign: 'right' }]}>CREDIT</Text>
        </View>
        {(tb.entries ?? []).slice(0, 50).map((e, i) => (
          <View key={i} style={styles.tbRow}>
            <Text style={[styles.tbAcct, { flex: 2 }]} numberOfLines={1}>{e.account}</Text>
            <Text style={[styles.tbDr, { width: 90 }]}>{e.debit  > 0 ? fmt(e.debit)  : ''}</Text>
            <Text style={[styles.tbCr, { width: 90 }]}>{e.credit > 0 ? fmt(e.credit) : ''}</Text>
          </View>
        ))}
        <View style={styles.tbTotals}>
          <Text style={[styles.tbTotalLabel, { flex: 2 }]}>TOTAL</Text>
          <Text style={[styles.tbTotalDr, { width: 90 }]}>{fmt(tb.totalDebit)}</Text>
          <Text style={[styles.tbTotalCr, { width: 90 }]}>{fmt(tb.totalCredit)}</Text>
        </View>
      </View>
    );
  };

  const renderIncomeStatement = () => {
    const is = data.incomeStatement;
    if (!is) return null;
    const net = is.netIncome ?? (is.totalIncome - is.totalExpenses);
    return (
      <View style={styles.reportContent}>
        <View style={[styles.netCard, { backgroundColor: net >= 0 ? '#D1FAE5' : '#FEE2E2' }]}>
          <Text style={[styles.netLabel, { color: net >= 0 ? '#065F46' : '#DC2626' }]}>NET {net >= 0 ? 'PROFIT' : 'LOSS'}</Text>
          <Text style={[styles.netValue, { color: net >= 0 ? '#065F46' : '#DC2626' }]}>
            {net >= 0 ? '+' : ''}{fmtShort(net)}
          </Text>
        </View>
        {/* Income section */}
        <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('income')}>
          <View style={styles.sectionHeaderLeft}>
            <Text style={styles.sectionHeaderTxt}>INCOME</Text>
            <Text style={[styles.sectionTotal, { color: '#065F46' }]}>{fmtShort(is.totalIncome)}</Text>
          </View>
          <Ionicons name={expandedSections.has('income') ? 'chevron-up' : 'chevron-down'} size={16} color="#94A3B8" />
        </TouchableOpacity>
        {expandedSections.has('income') && (is.income ?? []).map((e, i) => (
          <View key={i} style={styles.isRow}>
            <Text style={styles.isAcct} numberOfLines={1}>{e.account}</Text>
            <Text style={styles.isAmt}>{fmt(e.amount)}</Text>
          </View>
        ))}
        {/* Expenses section */}
        <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('expenses')}>
          <View style={styles.sectionHeaderLeft}>
            <Text style={styles.sectionHeaderTxt}>EXPENSES</Text>
            <Text style={[styles.sectionTotal, { color: '#DC2626' }]}>{fmtShort(is.totalExpenses)}</Text>
          </View>
          <Ionicons name={expandedSections.has('expenses') ? 'chevron-up' : 'chevron-down'} size={16} color="#94A3B8" />
        </TouchableOpacity>
        {expandedSections.has('expenses') && (is.expenses ?? []).map((e, i) => (
          <View key={i} style={styles.isRow}>
            <Text style={styles.isAcct} numberOfLines={1}>{e.account}</Text>
            <Text style={[styles.isAmt, { color: '#DC2626' }]}>{fmt(e.amount)}</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderBalanceSheet = () => {
    const bs = data.balanceSheet;
    if (!bs) return null;
    return (
      <View style={styles.reportContent}>
        <View style={styles.bsSummary}>
          {[
            { label: 'Assets',      value: bs.totalAssets,      color: AC       },
            { label: 'Liabilities', value: bs.totalLiabilities, color: '#DC2626'},
            { label: 'Equity',      value: bs.totalEquity,      color: '#1D4ED8'},
          ].map(s => (
            <View key={s.label} style={styles.bsSumItem}>
              <Text style={styles.bsSumLabel}>{s.label}</Text>
              <Text style={[styles.bsSumValue, { color: s.color }]}>{fmtShort(s.value)}</Text>
            </View>
          ))}
        </View>
        {(['assets', 'liabilities', 'equity'] as const).map(section => {
          const rows: BSEntry[] = (bs as any)[section] ?? [];
          const total = section === 'assets' ? bs.totalAssets : section === 'liabilities' ? bs.totalLiabilities : bs.totalEquity;
          return (
            <View key={section}>
              <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection(section)}>
                <View style={styles.sectionHeaderLeft}>
                  <Text style={styles.sectionHeaderTxt}>{section.toUpperCase()}</Text>
                  <Text style={styles.sectionTotal}>{fmtShort(total)}</Text>
                </View>
                <Ionicons name={expandedSections.has(section) ? 'chevron-up' : 'chevron-down'} size={16} color="#94A3B8" />
              </TouchableOpacity>
              {expandedSections.has(section) && rows.map((e, i) => (
                <View key={i} style={styles.isRow}>
                  <Text style={styles.isAcct} numberOfLines={1}>{e.account}</Text>
                  <Text style={styles.isAmt}>{fmt(e.amount)}</Text>
                </View>
              ))}
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => active && loadReport(active, true)} tintColor={AC} />}
      >
        {/* Period selector */}
        <View style={styles.periodCard}>
          <Text style={styles.periodLabel}>REPORT PERIOD</Text>
          <View style={styles.periodRow}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.fieldLabel}>From</Text>
              <TextInputCompat value={startDate} onChange={setStartDate} />
            </View>
            <Text style={{ alignSelf: 'flex-end', paddingBottom: 12, color: '#94A3B8' }}>→</Text>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.fieldLabel}>To</Text>
              <TextInputCompat value={endDate} onChange={setEndDate} />
            </View>
          </View>
        </View>

        {/* Report buttons */}
        {REPORTS.map(r => (
          <View key={r.key}>
            <TouchableOpacity
              style={[styles.reportCard, active === r.key && { borderColor: r.color, borderWidth: 2 }]}
              onPress={() => loadReport(r.key)}
              activeOpacity={0.75}
            >
              <View style={[styles.reportIcon, { backgroundColor: r.color + '15' }]}>
                <Ionicons name={r.icon as any} size={22} color={r.color} />
              </View>
              <Text style={styles.reportLabel}>{r.label}</Text>
              {loading && active === r.key
                ? <ActivityIndicator size="small" color={r.color} />
                : <Ionicons name={active === r.key ? 'chevron-up' : 'chevron-down'} size={18} color="#94A3B8" />
              }
            </TouchableOpacity>

            {active === r.key && !loading && (
              r.key === 'trialBalance'    ? renderTrialBalance()    :
              r.key === 'incomeStatement' ? renderIncomeStatement() :
              renderBalanceSheet()
            )}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function TextInputCompat({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { TextInput } = require('react-native');
  return (
    <TextInput
      style={{ backgroundColor: '#fff', borderRadius: 10, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 10, paddingVertical: 9, fontSize: 13, color: '#0F172A' }}
      value={value}
      onChangeText={onChange}
    />
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#F0FDF4' },
  scroll: { padding: 16, gap: 12, paddingBottom: 48 },

  periodCard:  { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, gap: 10 },
  periodLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: '#94A3B8' },
  periodRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fieldLabel:  { fontSize: 11, fontWeight: '600', color: '#64748B' },

  reportCard:  { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 14 },
  reportIcon:  { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  reportLabel: { flex: 1, fontSize: 15, fontWeight: '700', color: '#0F172A' },

  reportContent: { backgroundColor: '#fff', borderRadius: 0, borderBottomLeftRadius: 14, borderBottomRightRadius: 14, borderWidth: 1, borderTopWidth: 0, borderColor: '#E2E8F0', padding: 14, gap: 8, marginTop: -4 },

  balanceIndicator: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, padding: 10 },
  balanceIndicatorTxt: { fontSize: 13, fontWeight: '700' },

  tbHeader: { flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  tbCol:    { fontSize: 9, fontWeight: '800', color: '#94A3B8', letterSpacing: 0.6 },
  tbRow:    { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#F8FAFC' },
  tbAcct:   { fontSize: 12, color: '#0F172A', fontWeight: '500' },
  tbDr:     { fontSize: 11, fontWeight: '700', color: '#1D4ED8', textAlign: 'right' },
  tbCr:     { fontSize: 11, fontWeight: '700', color: '#7C3AED', textAlign: 'right' },
  tbTotals: { flexDirection: 'row', paddingTop: 8, borderTopWidth: 1.5, borderTopColor: '#E2E8F0' },
  tbTotalLabel: { fontSize: 11, fontWeight: '800', color: '#0F172A' },
  tbTotalDr:    { fontSize: 12, fontWeight: '900', color: '#1D4ED8', textAlign: 'right' },
  tbTotalCr:    { fontSize: 12, fontWeight: '900', color: '#7C3AED', textAlign: 'right' },

  netCard:  { borderRadius: 12, padding: 14, alignItems: 'center', gap: 4 },
  netLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  netValue: { fontSize: 28, fontWeight: '900' },

  sectionHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionHeaderTxt:  { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: '#475569' },
  sectionTotal:      { fontSize: 13, fontWeight: '800', color: '#0F172A' },

  isRow:  { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#F8FAFC' },
  isAcct: { flex: 1, fontSize: 12, color: '#0F172A', fontWeight: '500', paddingRight: 8 },
  isAmt:  { fontSize: 12, fontWeight: '700', color: '#0F172A' },

  bsSummary:    { flexDirection: 'row', backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, marginBottom: 4 },
  bsSumItem:    { flex: 1, alignItems: 'center', gap: 3 },
  bsSumLabel:   { fontSize: 9, fontWeight: '700', color: '#94A3B8', letterSpacing: 0.5 },
  bsSumValue:   { fontSize: 13, fontWeight: '900' },
});
