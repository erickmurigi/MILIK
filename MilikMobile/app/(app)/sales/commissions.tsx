import { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import MilikLoader from '../../../components/ui/MilikLoader';
import { ErrorBanner, ErrorState } from '../../../components/ui/PmsStates';
import { usePmsList, useReloadOnFocus } from '../../../hooks/usePmsList';
import { fmtDate, fmtKES } from '../../../utils/pmsFormat';
import { SBG, SC, pageOf, refName } from '../../../utils/sales';

type Commission = {
  _id: string;
  commissionNumber?: string;
  commissionAmount: number;
  netAmount?: number;
  status: string;
  createdAt?: string;
  agent?: { fullName?: string };
  deal?: { dealNumber?: string };
  listing?: { title?: string; listingNumber?: string };
};

const TABS = [
  { key: 'pending,approved', label: 'Due'      },
  { key: 'pending',          label: 'Pending'  },
  { key: 'approved',         label: 'Approved' },
  { key: 'paid',             label: 'Paid'     },
] as const;

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  pending:   { bg: '#FEF3C7', color: '#92400E', label: 'Pending'   },
  approved:  { bg: '#DBEAFE', color: '#1D4ED8', label: 'Approved'  },
  paid:      { bg: '#D1FAE5', color: '#065F46', label: 'Paid'      },
  cancelled: { bg: '#F1F5F9', color: '#64748B', label: 'Cancelled' },
  reversed:  { bg: '#FEE2E2', color: '#DC2626', label: 'Reversed'  },
};

const parse = (data: any) => pageOf<Commission>(data);

export default function CommissionsDueScreen() {
  const [statusFilter, setStatusFilter] = useState<string>(TABS[0].key);

  const listParams = useMemo(() => ({ status: statusFilter || undefined }), [statusFilter]);
  const list = usePmsList<Commission>({ path: '/sale/commissions', params: listParams, limit: 30, parse });
  useReloadOnFocus(list.reload);

  const totalDue = list.items.reduce((s, c) => s + Number(c.commissionAmount || 0), 0);

  const renderItem = ({ item }: { item: Commission }) => {
    const st = STATUS_STYLE[item.status] ?? STATUS_STYLE.pending;
    return (
      <View style={[styles.card, { borderLeftColor: st.color }]}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.num}>{item.commissionNumber || '—'}</Text>
            <Text style={styles.sub} numberOfLines={1}>
              {refName(item.agent, 'fullName') || 'Unassigned'}{item.deal?.dealNumber ? `  ·  ${item.deal.dealNumber}` : ''}
            </Text>
            <Text style={styles.sub2} numberOfLines={1}>
              {refName(item.listing, 'title', 'listingNumber') || '—'}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <View style={[styles.badge, { backgroundColor: st.bg }]}>
              <Text style={[styles.badgeTxt, { color: st.color }]}>{st.label}</Text>
            </View>
            <Text style={styles.amount}>{fmtKES(item.commissionAmount)}</Text>
            {item.createdAt ? <Text style={styles.date}>{fmtDate(item.createdAt)}</Text> : null}
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.tabsRow}>
        {TABS.map(t => (
          <TouchableOpacity key={t.key} style={[styles.tab, statusFilter === t.key && styles.tabActive]} onPress={() => setStatusFilter(t.key)}>
            <Text style={[styles.tabTxt, statusFilter === t.key && styles.tabTxtActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {list.loading ? <MilikLoader fullscreen /> : list.error && list.items.length === 0 ? (
        <ErrorState message={list.error} onRetry={list.retry} />
      ) : (
        <>
          {list.error ? <ErrorBanner message={list.error} onRetry={list.retry} /> : null}
          <FlatList
            data={list.items}
            keyExtractor={c => c._id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} tintColor={SC} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.3}
            ListHeaderComponent={list.total > 0 ? (
              <View style={styles.summaryBar}>
                <Text style={styles.count}>{list.total} commission{list.total === 1 ? '' : 's'}</Text>
                <Text style={styles.sumAmount}>{fmtKES(totalDue)} shown</Text>
              </View>
            ) : null}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="ribbon-outline" size={48} color="#CBD5E1" />
                <Text style={styles.emptyTxt}>No {TABS.find(t => t.key === statusFilter)?.label.toLowerCase()} commissions</Text>
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

  tabsRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 8 },
  tab:         { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  tabActive:   { backgroundColor: SC, borderColor: SC },
  tabTxt:      { fontSize: 12, fontWeight: '600', color: '#475569' },
  tabTxtActive:{ color: '#fff' },

  list: { paddingHorizontal: 16, paddingBottom: 40 },

  summaryBar: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  count:      { fontSize: 11, fontWeight: '700', color: '#94A3B8' },
  sumAmount:  { fontSize: 11, fontWeight: '800', color: SC },

  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8', textAlign: 'center' },

  card: {
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E2E8F0', borderLeftWidth: 3,
    padding: 14,
  },
  cardTop: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  num:     { fontSize: 10, fontWeight: '700', color: '#94A3B8', letterSpacing: 0.5, marginBottom: 2 },
  sub:     { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  sub2:    { fontSize: 12, color: '#64748B', marginTop: 2 },
  amount:  { fontSize: 14, fontWeight: '900', color: '#0F172A' },
  date:    { fontSize: 10, color: '#94A3B8' },

  badge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt: { fontSize: 10, fontWeight: '800' },
});
