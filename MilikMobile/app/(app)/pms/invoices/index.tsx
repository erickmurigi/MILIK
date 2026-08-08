import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';

type Invoice = {
  _id:           string;
  invoiceNumber: string;
  invoiceDate:   string;
  category:      string;
  amount:        number;
  outstanding:   number;
  status:        string;
  tenant?:       { name?: string };
  unit?:         { unitNumber?: string };
  property?:     { propertyName?: string; name?: string };
};

const CATEGORY_LABELS: Record<string, string> = {
  RENT_CHARGE:    'Rent',
  UTILITY_CHARGE: 'Utility',
  DEPOSIT_CHARGE: 'Deposit',
  PENALTY_CHARGE: 'Penalty',
  DEBIT_NOTE:     'Debit Note',
  TAKE_ON_DEBIT:  'Take-on',
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  unpaid:    { bg: Colors.dangerLight,  text: Colors.danger  },
  partial:   { bg: Colors.warningLight, text: Colors.warning },
  paid:      { bg: Colors.successLight, text: Colors.success },
  cancelled: { bg: Colors.borderLight,  text: Colors.textMuted },
  reversed:  { bg: Colors.borderLight,  text: Colors.textMuted },
};

const fmt = (n: number) =>
  Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });

export default function InvoicesScreen() {
  const router = useRouter();
  const [invoices,   setInvoices]   = useState<Invoice[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search,     setSearch]     = useState('');
  const [filter,     setFilter]     = useState<'all' | 'unpaid' | 'partial' | 'paid'>('all');
  const [page,       setPage]       = useState(1);
  const [hasMore,    setHasMore]    = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const LIMIT = 50;

  const load = useCallback(async (pg = 1, replace = true) => {
    if (pg === 1) replace ? setLoading(true) : setRefreshing(true);
    else setLoadingMore(true);

    try {
      const params: Record<string, string> = {
        page: String(pg), limit: String(LIMIT), paginate: 'true',
      };
      if (filter !== 'all') params.status = filter;
      if (search.trim())    params.search  = search.trim();

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
  }, [filter, search]);

  useEffect(() => { load(1); }, [load]);

  const onEndReached = () => {
    if (!loadingMore && hasMore) load(page + 1, false);
  };

  const renderItem = ({ item }: { item: Invoice }) => {
    const sc = STATUS_COLORS[item.status] ?? STATUS_COLORS.unpaid;
    const catLabel = CATEGORY_LABELS[item.category] ?? item.category ?? 'Invoice';
    const propName = item.property?.propertyName ?? item.property?.name ?? '';

    const openDetail = () => router.push({
      pathname: '/pms/invoices/[id]' as any,
      params: {
        id:            item._id,
        invoiceNumber: item.invoiceNumber ?? '',
        status:        item.status ?? 'unpaid',
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
      <TouchableOpacity style={styles.card} onPress={openDetail} activeOpacity={0.75}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.invoiceNum}>{item.invoiceNumber || '—'}</Text>
            <Text style={styles.tenantName} numberOfLines={1}>
              {item.tenant?.name ?? 'Unknown Tenant'}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {[item.unit?.unitNumber, propName].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeText, { color: sc.text }]}>
                {item.status?.toUpperCase() ?? 'UNPAID'}
              </Text>
            </View>
            <Text style={styles.amount}>KES {fmt(item.amount)}</Text>
          </View>
        </View>
        <View style={styles.cardBottom}>
          <Text style={styles.meta}>{catLabel}</Text>
          <Text style={styles.meta}>{fmtDate(item.invoiceDate)}</Text>
          {(item.outstanding ?? 0) > 0 && (
            <Text style={[styles.meta, { color: Colors.danger, fontWeight: '700' }]}>
              Due: {fmt(item.outstanding)}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const FILTER_TABS = ['all', 'unpaid', 'partial', 'paid'] as const;

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

      {/* Filter tabs */}
      <View style={styles.tabs}>
        {FILTER_TABS.map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.tab, filter === f && styles.tabActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.tabText, filter === f && styles.tabTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={invoices}
          keyExtractor={item => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(1)} tintColor={Colors.primary} />
          }
          onEndReached={onEndReached}
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

      {/* FAB — Book Invoice */}
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
  safe:    { flex: 1, backgroundColor: Colors.background },
  centered:{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText:{ fontSize: 15, color: Colors.textMuted },
  list:    { paddingBottom: 100 },
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

  tabs: {
    flexDirection: 'row', paddingHorizontal: 16, gap: 8,
    paddingBottom: 10,
  },
  tab: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, backgroundColor: Colors.white,
    borderWidth: 1, borderColor: Colors.border,
  },
  tabActive:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText:       { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: Colors.white },

  card: {
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
    padding: 14,
  },
  cardTop:  { flexDirection: 'row', gap: 10, marginBottom: 8 },
  cardBottom: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },

  invoiceNum: { fontSize: 14, fontWeight: '800', color: Colors.text },
  tenantName: { fontSize: 13, fontWeight: '600', color: Colors.text },
  meta:       { fontSize: 11, color: Colors.textMuted },
  amount:     { fontSize: 14, fontWeight: '800', color: Colors.text },

  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
});
