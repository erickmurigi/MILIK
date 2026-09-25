import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { ErrorBanner, ErrorState } from '../../../../components/ui/PmsStates';
import { useDebounced, usePmsList, useReloadOnFocus } from '../../../../hooks/usePmsList';
import { fmtDateTime, fmtKES } from '../../../../utils/pmsFormat';
import { pageOf } from '../../../../utils/sales';
import {
  INV, INVBG, MOVEMENT_FILTERS, MOVEMENT_STYLE, fmtQty, nameOf, userName, type StockMovement,
} from '../../../../utils/inventory';

const parse = (data: any) => pageOf<StockMovement>(data);

export default function StockMovementsScreen() {
  const [typeFilter, setTypeFilter] = useState('');
  const [search,     setSearch]     = useState('');
  const debounced = useDebounced(search.trim(), 400);

  const params = useMemo(() => ({
    type: typeFilter || undefined,
    search: debounced || undefined,
  }), [typeFilter, debounced]);

  const list = usePmsList<StockMovement>({ path: '/inventory/stock-movements', params, limit: 30, parse });
  useReloadOnFocus(useCallback(() => { list.reload(); }, [list.reload]));

  const renderItem = ({ item }: { item: StockMovement }) => {
    const tc   = MOVEMENT_STYLE[item.type] ?? MOVEMENT_STYLE.adjustment;
    const qty  = Number(item.qty) || 0;
    const isIn = qty > 0;               // the sign is the direction (an adjustment can go either way)
    const uom  = item.product?.unitOfMeasure || 'pcs';
    const by   = userName(item.createdBy);
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={[styles.typeIcon, { backgroundColor: tc.bg }]}>
            <Ionicons name={tc.icon} size={18} color={tc.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.prodName} numberOfLines={1}>{item.product?.name ?? 'Deleted product'}</Text>
            <View style={styles.metaRow}>
              {item.product?.sku ? <Text style={styles.sku}>{item.product.sku}</Text> : null}
              {nameOf(item.location) ? <Text style={styles.loc}>{nameOf(item.location)}</Text> : null}
            </View>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 5 }}>
            <View style={[styles.badge, { backgroundColor: tc.bg }]}>
              <Text style={[styles.badgeTxt, { color: tc.color }]}>{tc.label}</Text>
            </View>
            <Text style={[styles.qty, { color: isIn ? '#065F46' : '#DC2626' }]}>
              {isIn ? '+' : '−'}{fmtQty(Math.abs(qty))} {uom}
            </Text>
          </View>
        </View>
        <View style={styles.cardBottom}>
          <Text style={styles.dateTxt}>{fmtDateTime(item.createdAt)}</Text>
          {item.reference ? <Text style={styles.ref} numberOfLines={1}>{item.reference}</Text> : null}
          {item.unitCost ? <Text style={styles.costTxt}>{fmtKES(item.unitCost)} / unit</Text> : null}
        </View>
        {item.notes ? <Text style={styles.notes} numberOfLines={2}>{item.notes}</Text> : null}
        {by ? <Text style={styles.by}>by {by}</Text> : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color="#94A3B8" />
        <TextInput
          style={styles.searchInput}
          placeholder="Product, SKU, reference..."
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
          {MOVEMENT_FILTERS.map(t => (
            <TouchableOpacity
              key={t.key || 'all'}
              style={[styles.tab, typeFilter === t.key && styles.tabActive]}
              onPress={() => setTypeFilter(t.key)}
            >
              <Text style={[styles.tabTxt, typeFilter === t.key && styles.tabTxtActive]}>{t.label}</Text>
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
            keyExtractor={m => m._id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} tintColor={INV} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="swap-vertical-outline" size={48} color="#CBD5E1" />
                <Text style={styles.emptyTxt}>{typeFilter || debounced ? 'No movements match' : 'No stock movements yet'}</Text>
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

  tabsRow:     { paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  tab:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  tabActive:   { backgroundColor: INV, borderColor: INV },
  tabTxt:      { fontSize: 12, fontWeight: '600', color: '#475569' },
  tabTxtActive:{ color: '#fff' },

  list:      { paddingHorizontal: 16, paddingBottom: 40 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8' },

  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, gap: 8 },
  cardTop:  { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  typeIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  prodName: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  metaRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' },
  sku:      { fontSize: 10, fontWeight: '700', color: '#94A3B8', fontVariant: ['tabular-nums'] },
  loc:      { fontSize: 10, color: '#64748B', backgroundColor: '#F1F5F9', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  badge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt: { fontSize: 10, fontWeight: '800' },
  qty:      { fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },

  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dateTxt:    { fontSize: 11, color: '#94A3B8' },
  ref:        { fontSize: 11, fontWeight: '600', color: '#64748B', fontVariant: ['tabular-nums'], flexShrink: 1 },
  costTxt:    { fontSize: 11, color: '#94A3B8', marginLeft: 'auto' },

  notes: { fontSize: 12, color: '#94A3B8', fontStyle: 'italic' },
  by:    { fontSize: 10, color: '#94A3B8' },
});
