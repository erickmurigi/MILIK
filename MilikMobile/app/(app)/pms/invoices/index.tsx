import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

type Invoice = {
  _id:           string;
  invoiceNumber: string;
  invoiceDate:   string;
  category:      string;
  amount:        number;
  outstanding:   number;
  status:        string;
  description?:  string;
  tenant?:       { name?: string };
  unit?:         { unitNumber?: string };
  property?:     { propertyName?: string; name?: string };
};

type StatusFilter = 'all' | 'pending' | 'partially_paid' | 'paid' | 'reversed';
type Period       = '1M'  | '3M'  | '6M'  | '1Y'  | 'All';

const CATEGORY_LABELS: Record<string, string> = {
  RENT_CHARGE:         'Rent',
  UTILITY_CHARGE:      'Utility',
  DEPOSIT_CHARGE:      'Deposit',
  LATE_PENALTY_CHARGE: 'Penalty',
  DEBIT_NOTE:          'Debit Note',
  TAKE_ON_DEBIT:       'Take-on',
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending:        { bg: Colors.dangerLight,  text: Colors.danger   },
  partially_paid: { bg: Colors.warningLight, text: Colors.warning  },
  paid:           { bg: Colors.successLight, text: Colors.success  },
  cancelled:      { bg: Colors.borderLight,  text: Colors.textMuted },
  reversed:       { bg: '#F1F5F9',           text: '#64748B'       },
};

const STATUS_LABELS: Record<string, string> = {
  pending:        'Unpaid',
  partially_paid: 'Partial',
  paid:           'Paid',
  cancelled:      'Cancelled',
  reversed:       'Reversed',
};

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all',           label: 'All'      },
  { key: 'pending',       label: 'Unpaid'   },
  { key: 'partially_paid',label: 'Partial'  },
  { key: 'paid',          label: 'Paid'     },
  { key: 'reversed',      label: 'Reversed' },
];

const PERIOD_TABS: { key: Period; label: string }[] = [
  { key: '1M',  label: '1 Mo'   },
  { key: '3M',  label: '3 Mo'   },
  { key: '6M',  label: '6 Mo'   },
  { key: '1Y',  label: 'This Yr'},
  { key: 'All', label: 'All'    },
];

const getPeriodDates = (p: Period): { fromDate?: string; toDate?: string } => {
  if (p === 'All') return {};
  const today  = new Date();
  const toDate = today.toISOString().slice(0, 10);
  let from: Date;
  if      (p === '1M') from = new Date(today.getFullYear(), today.getMonth(),     1);
  else if (p === '3M') from = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  else if (p === '6M') from = new Date(today.getFullYear(), today.getMonth() - 5, 1);
  else                 from = new Date(today.getFullYear(), 0, 1); // 1Y
  return { fromDate: from.toISOString().slice(0, 10), toDate };
};

const fmt = (n: number) =>
  Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });

export default function InvoicesScreen() {
  const router = useRouter();
  const [invoices,    setInvoices]    = useState<Invoice[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [search,      setSearch]      = useState('');
  const [filter,      setFilter]      = useState<StatusFilter>('all');
  const [period,      setPeriod]      = useState<Period>('3M');
  const [page,        setPage]        = useState(1);
  const [hasMore,     setHasMore]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const LIMIT     = 50;
  const searchRef = useRef(search);
  searchRef.current = search;

  const load = useCallback(async (pg = 1, replace = true) => {
    if (pg === 1) replace ? setLoading(true) : setRefreshing(true);
    else setLoadingMore(true);

    try {
      const params: Record<string, string> = {
        page: String(pg), limit: String(LIMIT), paginate: 'true',
      };

      // "all" tab excludes reversed/cancelled via ACTIVE; "reversed" tab shows only reversed
      if (filter === 'all')      params.status = 'ACTIVE';
      else                       params.status = filter;

      const { fromDate, toDate } = getPeriodDates(period);
      if (fromDate) params.fromDate = fromDate;
      if (toDate)   params.toDate   = toDate;

      if (searchRef.current.trim()) params.search = searchRef.current.trim();

      const { data } = await api.get('/tenant-invoices', { params });
      const items: Invoice[] = data.data ?? data ?? [];

      setInvoices(prev => replace || pg === 1 ? items : [...prev, ...items]);
      setHasMore(items.length === LIMIT);
      setPage(pg);
    } catch { /* fail silently */ }
    finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [filter, period]);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => {
    const t = setTimeout(() => load(1), 400);
    return () => clearTimeout(t);
  }, [search]);

  const renderItem = ({ item }: { item: Invoice }) => {
    const sc      = STATUS_COLORS[item.status] ?? STATUS_COLORS.pending;
    const catLabel = CATEGORY_LABELS[item.category] ?? item.category ?? 'Invoice';
    const propName = item.property?.propertyName ?? item.property?.name ?? '';
    const isReversed = item.status === 'reversed';

    const openDetail = () => router.push({
      pathname: '/pms/invoices/[id]' as any,
      params: {
        id:            item._id,
        invoiceNumber: item.invoiceNumber ?? '',
        status:        item.status ?? 'pending',
        category:      item.category ?? '',
        amount:        String(item.amount ?? 0),
        outstanding:   String(item.outstanding ?? 0),
        invoiceDate:   item.invoiceDate ?? '',
        tenantName:    item.tenant?.name ?? '',
        unit:          item.unit?.unitNumber ? `Unit ${item.unit.unitNumber}` : '',
        property:      propName,
      },
    });

    return (
      <TouchableOpacity
        style={[styles.card, isReversed && styles.cardReversed]}
        onPress={openDetail}
        activeOpacity={0.75}
      >
        <View style={styles.cardTop}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.invoiceNum, isReversed && styles.textMuted]}>{item.invoiceNumber || '—'}</Text>
            <Text style={[styles.tenantName, isReversed && styles.textMuted]} numberOfLines={1}>
              {item.tenant?.name ?? 'Unknown Tenant'}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {[item.unit?.unitNumber, propName].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeText, { color: sc.text }]}>
                {(STATUS_LABELS[item.status] ?? item.status ?? 'Unpaid').toUpperCase()}
              </Text>
            </View>
            <Text style={[styles.amount, isReversed && styles.textMuted]}>KES {fmt(item.amount)}</Text>
          </View>
        </View>
        <View style={styles.cardBottom}>
          <Text style={styles.meta}>{catLabel}</Text>
          <Text style={styles.meta}>{fmtDate(item.invoiceDate)}</Text>
          {!isReversed && (item.outstanding ?? 0) > 0 && (
            <Text style={[styles.meta, { color: Colors.danger, fontWeight: '700' }]}>
              Due: {fmt(item.outstanding)}
            </Text>
          )}
        </View>
        {item.description ? (
          <Text style={styles.description} numberOfLines={2}>{item.description}</Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Search */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search invoices..."
            placeholderTextColor={Colors.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            onSubmitEditing={() => load(1)}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Status filter tabs */}
      <FlatList
        horizontal
        data={STATUS_TABS}
        keyExtractor={t => t.key}
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={styles.tabsRow}
        renderItem={({ item: t }) => (
          <TouchableOpacity
            style={[styles.tab, filter === t.key && styles.tabActive,
              t.key === 'reversed' && filter !== 'reversed' && styles.tabReversed]}
            onPress={() => setFilter(t.key)}
          >
            <Text style={[styles.tabText, filter === t.key && styles.tabTextActive,
              t.key === 'reversed' && filter !== 'reversed' && styles.tabReversedText]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* Period filter */}
      <View style={styles.periodRow}>
        <Ionicons name="calendar-outline" size={13} color={Colors.textMuted} style={{ marginRight: 2 }} />
        {PERIOD_TABS.map(p => (
          <TouchableOpacity
            key={p.key}
            style={[styles.periodChip, period === p.key && styles.periodChipActive]}
            onPress={() => setPeriod(p.key)}
          >
            <Text style={[styles.periodText, period === p.key && styles.periodTextActive]}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <MilikLoader fullscreen />
      ) : (
        <FlatList
          data={invoices}
          keyExtractor={item => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(1, false)} tintColor={Colors.primary} />
          }
          onEndReached={() => { if (!loadingMore && hasMore) load(page + 1, false); }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="receipt-outline" size={48} color={Colors.border} />
              <Text style={styles.emptyText}>No invoices found</Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={Colors.primary} />
              </View>
            ) : null
          }
        />
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/pms/invoices/new' as any)}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color={Colors.white} />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText:{ fontSize: 15, color: Colors.textMuted },
  list:     { paddingBottom: 100 },
  fab: {
    position: 'absolute', bottom: 28, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 8,
  },

  searchRow: { paddingHorizontal: 16, paddingVertical: 10 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, height: 42,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text },

  tabsRow: { paddingHorizontal: 16, paddingBottom: 8, gap: 7 },
  tab: {
    paddingHorizontal: 13, paddingVertical: 6,
    borderRadius: 20, backgroundColor: Colors.white,
    borderWidth: 1, borderColor: Colors.border,
  },
  tabActive:       { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabReversed:     { borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
  tabText:         { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive:   { color: Colors.white },
  tabReversedText: { color: '#94A3B8' },

  periodRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 16, paddingBottom: 10,
  },
  periodChip: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 12, backgroundColor: Colors.white,
    borderWidth: 1, borderColor: Colors.border,
  },
  periodChipActive: { backgroundColor: Colors.primaryFaded, borderColor: Colors.primary },
  periodText:       { fontSize: 11, fontWeight: '600', color: Colors.textMuted },
  periodTextActive: { color: Colors.primary, fontWeight: '700' },

  card: {
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
    padding: 14,
  },
  cardReversed: { opacity: 0.65, borderStyle: 'dashed' },
  cardTop:      { flexDirection: 'row', gap: 10, marginBottom: 8 },
  cardBottom:   { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },

  invoiceNum:  { fontSize: 14, fontWeight: '800', color: Colors.text },
  tenantName:  { fontSize: 13, fontWeight: '600', color: Colors.text },
  textMuted:   { color: Colors.textMuted },
  meta:        { fontSize: 11, color: Colors.textMuted },
  amount:      { fontSize: 14, fontWeight: '800', color: Colors.text },
  description: { fontSize: 12, color: Colors.textSecondary, marginTop: 6, fontStyle: 'italic' },

  badge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
});
