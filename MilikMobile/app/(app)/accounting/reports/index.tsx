import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const AC  = '#064E3B';

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtShort = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}KES ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}KES ${(abs / 1_000).toFixed(0)}K`;
  return fmt(n);
};

const today       = () => new Date().toISOString().slice(0, 10);
const startOfYear = () => `${new Date().getFullYear()}-01-01`;

// Section shape returned by buildSectionBuckets
type Section = { label: string; total: number; rows: { code?: string; name: string; amount: number }[] };

// Trial balance row shape
type TBRow = { code?: string; name: string; type: string; debit: number; credit: number };

type ActiveReport = 'trialBalance' | 'incomeStatement' | 'balanceSheet' | null;

// Raw API responses
type TBResponse  = { rows: TBRow[]; totals: { debit: number; credit: number; balanced: boolean } };
type ISResponse  = { income: { sections: Section[]; total: number }; expenses: { sections: Section[]; total: number }; summary: { totalIncome: number; totalExpenses: number; netProfit: number; resultLabel: string } };
type BSResponse  = { assets: { sections: Section[]; total: number }; liabilities: { sections: Section[]; total: number }; equity: { sections: Section[]; total: number }; summary: { totalAssets: number; totalLiabilities: number; totalEquity: number; balanced: boolean } };

type ReportData = {
  trialBalance?:    TBResponse;
  incomeStatement?: ISResponse;
  balanceSheet?:    BSResponse;
};

export default function FinancialReportsScreen() {
  const [startDate, setStartDate]   = useState<string>(startOfYear());
  const [endDate,   setEndDate]     = useState<string>(today());
  const [data,      setData]        = useState<ReportData>({});
  const [active,    setActive]      = useState<ActiveReport>(null);
  const [loading,   setLoading]     = useState(false);
  const [refreshing,setRefreshing]  = useState(false);
  const [expanded,  setExpanded]    = useState<Set<string>>(new Set());

  const toggleSection = (key: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const loadReport = useCallback(async (report: ActiveReport, isRefresh = false) => {
    if (!report) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setActive(report);
    try {
      // Trial balance and balance sheet use asOfDate; income statement uses startDate/endDate
      const params =
        report === 'incomeStatement'
          ? { startDate, endDate }
          : { asOfDate: endDate };

      const endpointMap: Record<string, string> = {
        trialBalance:    '/financial-reports/trial-balance',
        incomeStatement: '/financial-reports/income-statement',
        balanceSheet:    '/financial-reports/balance-sheet',
      };
      const { data: res } = await api.get(endpointMap[report], { params });
      setData(prev => ({ ...prev, [report]: res }));
    } catch (e: any) {
      console.warn('[FinancialReports]', e?.response?.status, e?.response?.data?.message ?? e?.message);
    }
    finally { setLoading(false); setRefreshing(false); }
  }, [startDate, endDate]);

  const REPORTS = [
    { key: 'trialBalance'    as ActiveReport, label: 'Trial Balance',     icon: 'scale-outline',       color: '#1D4ED8' },
    { key: 'incomeStatement' as ActiveReport, label: 'Income Statement',  icon: 'trending-up-outline',  color: AC       },
    { key: 'balanceSheet'    as ActiveReport, label: 'Balance Sheet',     icon: 'layers-outline',       color: '#7C3AED'},
  ];

  /* ─── Trial Balance ─── */
  const renderTrialBalance = () => {
    const tb = data.trialBalance;
    if (!tb) return null;
    const balanced = tb.totals?.balanced ?? false;
    const rows     = tb.rows ?? [];
    return (
      <View style={styles.reportContent}>
        <View style={[styles.balanceIndicator, { backgroundColor: balanced ? '#D1FAE5' : '#FEE2E2' }]}>
          <Ionicons name={balanced ? 'checkmark-circle' : 'alert-circle'} size={16} color={balanced ? '#065F46' : '#DC2626'} />
          <Text style={[styles.balanceIndicatorTxt, { color: balanced ? '#065F46' : '#DC2626' }]}>
            {balanced ? 'Balanced — Debits = Credits' : `Imbalance: ${fmt(Math.abs((tb.totals?.debit ?? 0) - (tb.totals?.credit ?? 0)))}`}
          </Text>
        </View>
        <View style={styles.tbHeader}>
          <Text style={[styles.tbCol, { flex: 2 }]}>ACCOUNT</Text>
          <Text style={[styles.tbCol, { width: 90, textAlign: 'right' }]}>DEBIT</Text>
          <Text style={[styles.tbCol, { width: 90, textAlign: 'right' }]}>CREDIT</Text>
        </View>
        {rows.slice(0, 60).map((r, i) => (
          <View key={i} style={styles.tbRow}>
            <Text style={[styles.tbAcct, { flex: 2 }]} numberOfLines={1}>{r.code ? `${r.code} ${r.name}` : r.name}</Text>
            <Text style={[styles.tbDr, { width: 90 }]}>{(r.debit  ?? 0) > 0 ? fmt(r.debit)  : ''}</Text>
            <Text style={[styles.tbCr, { width: 90 }]}>{(r.credit ?? 0) > 0 ? fmt(r.credit) : ''}</Text>
          </View>
        ))}
        <View style={styles.tbTotals}>
          <Text style={[styles.tbTotalLabel, { flex: 2 }]}>TOTAL</Text>
          <Text style={[styles.tbTotalDr, { width: 90 }]}>{fmt(tb.totals?.debit ?? 0)}</Text>
          <Text style={[styles.tbTotalCr, { width: 90 }]}>{fmt(tb.totals?.credit ?? 0)}</Text>
        </View>
      </View>
    );
  };

  /* ─── Income Statement ─── */
  const renderSections = (sections: Section[], colorFn: (a: number) => string, prefix: string) =>
    sections.map((sec, si) => {
      const key = `${prefix}_${si}`;
      return (
        <View key={key}>
          <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection(key)}>
            <View style={styles.sectionHeaderLeft}>
              <Text style={styles.sectionHeaderTxt}>{sec.label.toUpperCase()}</Text>
              <Text style={styles.sectionTotal}>{fmtShort(sec.total)}</Text>
            </View>
            <Ionicons name={expanded.has(key) ? 'chevron-up' : 'chevron-down'} size={16} color="#94A3B8" />
          </TouchableOpacity>
          {expanded.has(key) && (sec.rows ?? []).map((r, ri) => (
            <View key={ri} style={styles.isRow}>
              <Text style={styles.isAcct} numberOfLines={1}>{r.code ? `${r.code} ${r.name}` : r.name}</Text>
              <Text style={[styles.isAmt, { color: colorFn(r.amount) }]}>{fmt(r.amount)}</Text>
            </View>
          ))}
        </View>
      );
    });

  const renderIncomeStatement = () => {
    const is = data.incomeStatement;
    if (!is) return null;
    const net = is.summary?.netProfit ?? 0;
    return (
      <View style={styles.reportContent}>
        <View style={[styles.netCard, { backgroundColor: net >= 0 ? '#D1FAE5' : '#FEE2E2' }]}>
          <Text style={[styles.netLabel, { color: net >= 0 ? '#065F46' : '#DC2626' }]}>{is.summary?.resultLabel?.toUpperCase() ?? (net >= 0 ? 'NET PROFIT' : 'NET LOSS')}</Text>
          <Text style={[styles.netValue, { color: net >= 0 ? '#065F46' : '#DC2626' }]}>{net >= 0 ? '+' : ''}{fmtShort(net)}</Text>
        </View>

        <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('is_income_header')}>
          <View style={styles.sectionHeaderLeft}>
            <Text style={styles.sectionHeaderTxt}>INCOME</Text>
            <Text style={[styles.sectionTotal, { color: '#065F46' }]}>{fmtShort(is.income?.total ?? 0)}</Text>
          </View>
          <Ionicons name={expanded.has('is_income_header') ? 'chevron-up' : 'chevron-down'} size={16} color="#94A3B8" />
        </TouchableOpacity>
        {expanded.has('is_income_header') && renderSections(is.income?.sections ?? [], () => '#065F46', 'is_inc')}

        <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('is_exp_header')}>
          <View style={styles.sectionHeaderLeft}>
            <Text style={styles.sectionHeaderTxt}>EXPENSES</Text>
            <Text style={[styles.sectionTotal, { color: '#DC2626' }]}>{fmtShort(is.expenses?.total ?? 0)}</Text>
          </View>
          <Ionicons name={expanded.has('is_exp_header') ? 'chevron-up' : 'chevron-down'} size={16} color="#94A3B8" />
        </TouchableOpacity>
        {expanded.has('is_exp_header') && renderSections(is.expenses?.sections ?? [], () => '#DC2626', 'is_exp')}
      </View>
    );
  };

  /* ─── Balance Sheet ─── */
  const renderBalanceSheet = () => {
    const bs = data.balanceSheet;
    if (!bs) return null;
    const balanced = bs.summary?.balanced ?? false;
    const parts: { key: string; label: string; total: number; sections: Section[]; color: string }[] = [
      { key: 'bs_assets',      label: 'ASSETS',      total: bs.summary?.totalAssets      ?? 0, sections: bs.assets?.sections      ?? [], color: AC       },
      { key: 'bs_liabilities', label: 'LIABILITIES', total: bs.summary?.totalLiabilities ?? 0, sections: bs.liabilities?.sections ?? [], color: '#DC2626' },
      { key: 'bs_equity',      label: 'EQUITY',      total: bs.summary?.totalEquity      ?? 0, sections: bs.equity?.sections      ?? [], color: '#1D4ED8' },
    ];
    return (
      <View style={styles.reportContent}>
        <View style={[styles.balanceIndicator, { backgroundColor: balanced ? '#D1FAE5' : '#FEE2E2' }]}>
          <Ionicons name={balanced ? 'checkmark-circle' : 'alert-circle'} size={16} color={balanced ? '#065F46' : '#DC2626'} />
          <Text style={[styles.balanceIndicatorTxt, { color: balanced ? '#065F46' : '#DC2626' }]}>
            {balanced ? 'Assets = Liabilities + Equity' : 'Balance sheet does not balance'}
          </Text>
        </View>
        <View style={styles.bsSummary}>
          {parts.map(p => (
            <View key={p.key} style={styles.bsSumItem}>
              <Text style={styles.bsSumLabel}>{p.label}</Text>
              <Text style={[styles.bsSumValue, { color: p.color }]}>{fmtShort(p.total)}</Text>
            </View>
          ))}
        </View>
        {parts.map(p => (
          <View key={p.key}>
            <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection(p.key + '_h')}>
              <View style={styles.sectionHeaderLeft}>
                <Text style={styles.sectionHeaderTxt}>{p.label}</Text>
                <Text style={[styles.sectionTotal, { color: p.color }]}>{fmtShort(p.total)}</Text>
              </View>
              <Ionicons name={expanded.has(p.key + '_h') ? 'chevron-up' : 'chevron-down'} size={16} color="#94A3B8" />
            </TouchableOpacity>
            {expanded.has(p.key + '_h') && renderSections(p.sections, () => p.color, p.key)}
          </View>
        ))}
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
              <TextInput
                style={styles.dateInput}
                value={startDate}
                onChangeText={setStartDate}
                placeholderTextColor="#94A3B8"
              />
            </View>
            <Text style={{ alignSelf: 'flex-end', paddingBottom: 12, color: '#94A3B8' }}>→</Text>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.fieldLabel}>To</Text>
              <TextInput
                style={styles.dateInput}
                value={endDate}
                onChangeText={setEndDate}
                placeholderTextColor="#94A3B8"
              />
            </View>
          </View>
          <Text style={styles.periodHint}>Trial Balance & Balance Sheet use the "To" date as the as-of date</Text>
        </View>

        {/* Report toggles */}
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

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#F0FDF4' },
  scroll: { padding: 16, gap: 12, paddingBottom: 48 },

  periodCard:  { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, gap: 10 },
  periodLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: '#94A3B8' },
  periodRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fieldLabel:  { fontSize: 11, fontWeight: '600', color: '#64748B' },
  dateInput:   { backgroundColor: '#F8FAFC', borderRadius: 10, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 10, paddingVertical: 9, fontSize: 13, color: '#0F172A' },
  periodHint:  { fontSize: 10, color: '#94A3B8', fontStyle: 'italic' },

  reportCard:  { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 14 },
  reportIcon:  { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  reportLabel: { flex: 1, fontSize: 15, fontWeight: '700', color: '#0F172A' },

  reportContent: { backgroundColor: '#fff', borderBottomLeftRadius: 14, borderBottomRightRadius: 14, borderWidth: 1, borderTopWidth: 0, borderColor: '#E2E8F0', padding: 14, gap: 8, marginTop: -4 },

  balanceIndicator:    { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, padding: 10 },
  balanceIndicatorTxt: { fontSize: 13, fontWeight: '700' },

  tbHeader:  { flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  tbCol:     { fontSize: 9, fontWeight: '800', color: '#94A3B8', letterSpacing: 0.6 },
  tbRow:     { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#F8FAFC' },
  tbAcct:    { fontSize: 12, color: '#0F172A', fontWeight: '500' },
  tbDr:      { fontSize: 11, fontWeight: '700', color: '#1D4ED8', textAlign: 'right' },
  tbCr:      { fontSize: 11, fontWeight: '700', color: '#7C3AED', textAlign: 'right' },
  tbTotals:  { flexDirection: 'row', paddingTop: 8, borderTopWidth: 1.5, borderTopColor: '#E2E8F0' },
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

  bsSummary:  { flexDirection: 'row', backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, marginBottom: 4 },
  bsSumItem:  { flex: 1, alignItems: 'center', gap: 3 },
  bsSumLabel: { fontSize: 9, fontWeight: '700', color: '#94A3B8', letterSpacing: 0.5 },
  bsSumValue: { fontSize: 13, fontWeight: '900' },
});
