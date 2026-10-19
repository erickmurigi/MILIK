import { useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import MilikLoader from '../../../components/ui/MilikLoader';
import { ErrorBanner, ErrorState } from '../../../components/ui/PmsStates';
import { usePmsList, useReloadOnFocus } from '../../../hooks/usePmsList';
import { fmtDate, fmtKES } from '../../../utils/pmsFormat';
import { SBG, SC, pageOf } from '../../../utils/sales';

type Instalment = {
  _id: string; dealId?: string; dealNumber?: string; buyerName?: string; unit?: string;
  installmentNumber?: number; description?: string; dueDate?: string; daysLate: number; amount: number;
};

const parse = (data: any) => pageOf<Instalment>(data);

const severityColor = (daysLate: number) => (daysLate > 60 ? '#DC2626' : daysLate > 30 ? '#D97706' : '#B91C1C');

export default function OverdueInstalmentsScreen() {
  const router = useRouter();
  const listParams = useMemo(() => ({}), []);
  const list = usePmsList<Instalment>({ path: '/sale/reports/overdue-installments', params: listParams, limit: 30, parse });
  useReloadOnFocus(list.reload);

  const totalAmount = list.items.reduce((s, i) => s + Number(i.amount || 0), 0);

  const renderItem = ({ item }: { item: Instalment }) => {
    const color = severityColor(item.daysLate);
    return (
      <TouchableOpacity
        style={[styles.card, { borderLeftColor: color }]}
        activeOpacity={item.dealId ? 0.75 : 1}
        onPress={item.dealId ? () => router.push(`/sales/deals/${item.dealId}` as any) : undefined}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.num} numberOfLines={1}>
            {item.dealNumber || '—'} · {item.buyerName || '—'}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {item.description || (item.installmentNumber ? `Instalment #${item.installmentNumber}` : 'Instalment')}
            {item.unit ? `  ·  ${item.unit}` : ''}
          </Text>
          <Text style={styles.due}>
            Due {fmtDate(item.dueDate)} · <Text style={{ color, fontWeight: '800' }}>{item.daysLate} day{item.daysLate === 1 ? '' : 's'} late</Text>
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <Text style={[styles.amount, { color }]}>{fmtKES(item.amount)}</Text>
          {item.dealId ? <Ionicons name="chevron-forward" size={14} color="#CBD5E1" /> : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {list.loading ? <MilikLoader fullscreen /> : list.error && list.items.length === 0 ? (
        <ErrorState message={list.error} onRetry={list.retry} />
      ) : (
        <>
          {list.error ? <ErrorBanner message={list.error} onRetry={list.retry} /> : null}
          <FlatList
            data={list.items}
            keyExtractor={i => i._id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} tintColor={SC} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.3}
            ListHeaderComponent={list.total > 0 ? (
              <View style={styles.summaryBar}>
                <Text style={styles.count}>{list.total} overdue instalment{list.total === 1 ? '' : 's'}</Text>
                <Text style={styles.sumAmount}>{fmtKES(totalAmount)} shown</Text>
              </View>
            ) : null}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="checkmark-circle-outline" size={48} color="#CBD5E1" />
                <Text style={styles.emptyTxt}>No overdue instalments</Text>
              </View>
            }
            ListFooterComponent={list.loadingMore ? <ActivityIndicator color={SC} style={{ padding: 20 }} /> : null}
          />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: SBG },
  list: { padding: 16, paddingBottom: 40 },

  summaryBar: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  count:      { fontSize: 11, fontWeight: '700', color: '#94A3B8' },
  sumAmount:  { fontSize: 11, fontWeight: '800', color: '#B91C1C' },

  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8', textAlign: 'center' },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E2E8F0', borderLeftWidth: 3,
    padding: 14,
  },
  num:    { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  sub:    { fontSize: 12, color: '#64748B', marginTop: 2 },
  due:    { fontSize: 11, color: '#94A3B8', marginTop: 4 },
  amount: { fontSize: 15, fontWeight: '900' },
});
