import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { ErrorBanner, ErrorState } from '../../../../components/ui/PmsStates';
import { useDebounced, usePmsList, useReloadOnFocus } from '../../../../hooks/usePmsList';
import { fmtDate, fmtKES } from '../../../../utils/pmsFormat';
import { pageOf } from '../../../../utils/sales';
import {
  INV, INVBG, PO_FILTERS, PO_STATUS, fmtQty, nameOf, type PurchaseOrder,
} from '../../../../utils/inventory';

const parse = (data: any) => pageOf<PurchaseOrder>(data);

export default function PurchaseOrdersScreen() {
  const router = useRouter();

  const [statusFilter, setStatusFilter] = useState('');
  const [search,       setSearch]       = useState('');
  const debounced = useDebounced(search.trim(), 400);

  const params = useMemo(() => ({
    status: statusFilter || undefined,
    search: debounced || undefined,
  }), [statusFilter, debounced]);

  const list = usePmsList<PurchaseOrder>({ path: '/inventory/purchase-orders', params, limit: 30, parse });
  // received / cancelled on the detail screen -> the row's status is fresh when we come back
  useReloadOnFocus(useCallback(() => { list.reload(); }, [list.reload]));

  const renderItem = ({ item }: { item: PurchaseOrder }) => {
    const sc  = PO_STATUS[item.status] ?? PO_STATUS.draft;
    const loc = nameOf(item.location);
    const totalQty    = (item.lines ?? []).reduce((s, l) => s + Number(l.qtyOrdered || 0), 0);
    const receivedQty = (item.lines ?? []).reduce((s, l) => s + Number(l.qtyReceived || 0), 0);
    return (
      <TouchableOpacity
        style={[styles.card, { borderLeftColor: sc.color }]}
        onPress={() => router.push(`/inventory/purchase-orders/${item._id}` as any)}
        activeOpacity={0.75}
      >
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.poNum}>{item.poNumber}</Text>
            <Text style={styles.supplier} numberOfLines={1}>{nameOf(item.supplier) || 'No supplier'}</Text>
            {loc ? <Text style={styles.location} numberOfLines={1}>Receiving at {loc}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
            </View>
            <Text style={styles.amount}>{fmtKES(item.totalAmount)}</Text>
          </View>
        </View>
        <View style={styles.cardBottom}>
          <Text style={styles.dateTxt}>
            {fmtDate(item.orderDate)}
            {item.expectedDate ? `  ·  Expected ${fmtDate(item.expectedDate)}` : ''}
          </Text>
          {totalQty > 0 && item.status !== 'cancelled' ? (
            <Text style={styles.qtyTxt}>{fmtQty(receivedQty)}/{fmtQty(totalQty)} received</Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color="#94A3B8" />
        <TextInput
          style={styles.searchInput}
          placeholder="PO number, supplier..."
          placeholderTextColor="#94A3B8"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          autoCorrect={false}
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color="#94A3B8" />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={{ flexGrow: 0 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow} keyboardShouldPersistTaps="handled">
          {PO_FILTERS.map(t => (
            <TouchableOpacity
              key={t.key || 'all'}
              style={[styles.tab, statusFilter === t.key && styles.tabActive]}
              onPress={() => setStatusFilter(t.key)}
            >
              <Text style={[styles.tabTxt, statusFilter === t.key && styles.tabTxtActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {list.loading ? <MilikLoader fullscreen /> : list.error && list.items.length === 0 ? (
        <ErrorState message={list.error} onRetry={list.retry} />
      ) : (
        <>
          {list.error ? <ErrorBanner message={list.error} onRetry={list.retry} /> : null}
          <FlatList
            data={list.items}
            keyExtractor={po => po._id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} tintColor={INV} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="document-text-outline" size={48} color="#CBD5E1" />
                <Text style={styles.emptyTxt}>{statusFilter || debounced ? 'No purchase orders match' : 'No purchase orders yet'}</Text>
              </View>
            }
            ListFooterComponent={list.loadingMore ? <ActivityIndicator color={INV} style={{ padding: 20 }} /> : null}
          />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: INVBG },

  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, margin: 16, marginBottom: 10, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 14, height: 50 },
  searchInput: { flex: 1, fontSize: 15, color: '#0F172A' },

  tabsRow: { paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  tab:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  tabActive:   { backgroundColor: INV, borderColor: INV },
  tabTxt:      { fontSize: 12, fontWeight: '600', color: '#475569' },
  tabTxtActive:{ color: '#fff' },

  list:      { paddingHorizontal: 16, paddingBottom: 40 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8' },

  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', borderLeftWidth: 3, padding: 14, gap: 8 },
  cardTop:    { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  poNum:      { fontSize: 12, fontWeight: '800', color: INV, letterSpacing: 0.3, marginBottom: 2, fontVariant: ['tabular-nums'] },
  supplier:   { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  location:   { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  badge:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt:   { fontSize: 10, fontWeight: '800' },
  amount:     { fontSize: 15, fontWeight: '900', color: '#0F172A' },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dateTxt:    { fontSize: 11, color: '#94A3B8' },
  qtyTxt:     { fontSize: 11, fontWeight: '600', color: '#64748B' },
});
