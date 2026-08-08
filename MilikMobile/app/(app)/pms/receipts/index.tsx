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

type Receipt = {
  _id:             string;
  receiptNumber:   string;
  referenceNumber: string;
  paymentDate:     string;
  amount:          number;
  paymentType:     string;
  isConfirmed:     boolean;
  isReversed:      boolean;
  isCancelled:     boolean;
  tenant?:         { name?: string };
  unit?:           { unitNumber?: string };
  property?:       { propertyName?: string; name?: string };
  allocationSummary?: { unapplied?: number };
};

const fmt = (n: number) =>
  Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });

const resolveStatus = (r: Receipt) => {
  if (r.isReversed || r.isCancelled) return { label: 'REVERSED', bg: Colors.borderLight, text: Colors.textMuted };
  if (r.isConfirmed) return { label: 'CONFIRMED', bg: Colors.successLight, text: Colors.success };
  return { label: 'PENDING', bg: Colors.warningLight, text: Colors.warning };
};

export default function ReceiptsScreen() {
  const router = useRouter();
  const [receipts,    setReceipts]    = useState<Receipt[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [search,      setSearch]      = useState('');
  const [page,        setPage]        = useState(1);
  const [hasMore,     setHasMore]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const LIMIT = 50;

  const load = useCallback(async (pg = 1, replace = true) => {
    if (pg === 1) replace ? setLoading(true) : setRefreshing(true);
    else setLoadingMore(true);

    try {
      const params: Record<string, string> = {
        page: String(pg), limit: String(LIMIT),
      };
      if (search.trim()) params.search = search.trim();

      const { data } = await api.get('/rent-payments', { params });
      const items: Receipt[] = data.data ?? (Array.isArray(data) ? data : []);

      setReceipts(prev => replace || pg === 1 ? items : [...prev, ...items]);
      setHasMore(items.length === LIMIT);
      setPage(pg);
    } catch { /* fail silently */ }
    finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [search]);

  useEffect(() => { load(1); }, [load]);

  const onEndReached = () => {
    if (!loadingMore && hasMore) load(page + 1, false);
  };

  const renderItem = ({ item }: { item: Receipt }) => {
    const sc = resolveStatus(item);
    const unapplied = Number(item.allocationSummary?.unapplied ?? 0);
    const propName = item.property?.propertyName ?? item.property?.name ?? '';

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(`/pms/receipts/${item._id}` as any)}
        activeOpacity={0.75}
      >
        <View style={styles.cardTop}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.receiptNum}>
              {item.receiptNumber || item.referenceNumber || '—'}
            </Text>
            <Text style={styles.tenantName} numberOfLines={1}>
              {item.tenant?.name ?? 'Unknown Tenant'}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {[item.unit?.unitNumber, propName].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeText, { color: sc.text }]}>{sc.label}</Text>
            </View>
            <Text style={styles.amount}>KES {fmt(item.amount)}</Text>
          </View>
        </View>
        <View style={styles.cardBottom}>
          <Text style={styles.meta}>{item.paymentType ?? ''}</Text>
          <Text style={styles.meta}>{fmtDate(item.paymentDate)}</Text>
          {unapplied > 0 && (
            <Text style={[styles.meta, { color: Colors.warning, fontWeight: '700' }]}>
              Unallocated: {fmt(unapplied)}
            </Text>
          )}
        </View>
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
            placeholder="Search receipts..."
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

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={receipts}
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
              <Ionicons name="cash-outline" size={48} color={Colors.border} />
              <Text style={styles.emptyText}>No receipts found</Text>
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

      {/* FAB — Record Payment */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/pms/receipts/new' as any)}
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

  searchRow: { paddingHorizontal: 16, paddingVertical: 10 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, height: 42,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text },

  card: {
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
    padding: 14,
  },
  cardTop:    { flexDirection: 'row', gap: 10, marginBottom: 8 },
  cardBottom: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },

  receiptNum: { fontSize: 14, fontWeight: '800', color: Colors.text },
  tenantName: { fontSize: 13, fontWeight: '600', color: Colors.text },
  meta:       { fontSize: 11, color: Colors.textMuted },
  amount:     { fontSize: 14, fontWeight: '800', color: Colors.success },

  badge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },

  fab: {
    position: 'absolute', bottom: 28, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 8,
  },
});
