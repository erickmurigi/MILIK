import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { Dropdown, DropdownItem } from '../../../../components/ui/Dropdown';
import { ErrorBanner, ErrorState } from '../../../../components/ui/PmsStates';
import { usePmsList, useReloadOnFocus } from '../../../../hooks/usePmsList';
import { apiError, fmtDate, fmtKES, fmtMoney, fmtNumber } from '../../../../utils/pmsFormat';

// Field names follow the MeterReading model: unitsConsumed / rate (not consumption / ratePerUnit).
type MeterReading = {
  _id:             string;
  utilityType:     string;
  billingPeriod:   string;
  status:          string;   // draft | billed | void
  readingDate:     string;
  previousReading: number;
  currentReading:  number;
  unitsConsumed:   number;
  rate:            number;
  amount:          number;
  isMeterReset?:   boolean;
  tenant?:         { name?: string } | null;
  unit?:           { unitNumber?: string } | null;
  property?:       { propertyName?: string } | null;
  billedInvoice?:  { invoiceNumber?: string; status?: string } | null;
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft:  { bg: Colors.warningLight, text: Colors.warning },
  billed: { bg: Colors.successLight, text: Colors.success },
  void:   { bg: Colors.borderLight,  text: Colors.textMuted },
};

const UTILITY_ICONS: Record<string, string> = {
  water:       'water-outline',
  electricity: 'flash-outline',
  gas:         'flame-outline',
};

const FILTER_TABS = ['all', 'draft', 'billed', 'void'] as const;
type FilterTab = typeof FILTER_TABS[number];

export default function MetersScreen() {
  const router = useRouter();
  const [filter,    setFilter]    = useState<FilterTab>('draft');
  const [busyId,    setBusyId]    = useState<string | null>(null);

  const [properties,   setProperties]   = useState<DropdownItem[]>([]);
  const [propsLoading, setPropsLoading] = useState(false);
  const [propId,       setPropId]       = useState('');
  const [propLabel,    setPropLabel]    = useState('');
  const [propOpen,     setPropOpen]     = useState(false);

  useEffect(() => {
    setPropsLoading(true);
    api.get('/properties', { params: { limit: 500 } })
      .then(({ data }) =>
        setProperties(
          (data.data ?? []).map((p: { _id: string; propertyName?: string; propertyCode?: string }) => ({
            _id: p._id, label: p.propertyName ?? '', sublabel: p.propertyCode,
          }))
        )
      )
      .catch(() => {})
      .finally(() => setPropsLoading(false));
  }, []);

  const list = usePmsList<MeterReading>({
    path: '/meter-readings',
    params: { status: filter === 'all' ? undefined : filter, property: propId || undefined },
    parse: d => ({ rows: d?.data ?? [], pages: d?.pages, total: d?.total }),
  });
  useReloadOnFocus(list.reload);

  const handleBill = useCallback((item: MeterReading) => {
    Alert.alert(
      'Generate utility invoice',
      `Bill ${fmtKES(item.amount)} to ${item.tenant?.name ?? "the unit's active tenant"} for ${item.utilityType} · ${item.billingPeriod}?\n\nThis posts a utility invoice to the tenant's account.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Generate',
          onPress: async () => {
            setBusyId(item._id);
            try {
              // Same payload as the web: invoice and due date follow the reading date.
              const { data } = await api.post(`/meter-readings/${item._id}/bill`, {
                invoiceDate: item.readingDate,
                dueDate:     item.readingDate,
              });
              const no = data?.invoice?.invoiceNumber;
              Alert.alert('Invoice generated', no ? `Utility invoice ${no} created.` : 'Utility invoice created.');
              list.reload();
            } catch (err) {
              Alert.alert('Could not bill reading', apiError(err, 'Failed to generate invoice.'));
              list.reload();
            } finally { setBusyId(null); }
          },
        },
      ],
    );
  }, [list]);

  const handleVoid = useCallback((item: MeterReading) => {
    Alert.alert('Void reading', `Void this ${item.utilityType} reading for ${item.billingPeriod}? It will no longer count as the previous reading or block a new one for the period.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Void', style: 'destructive',
        onPress: async () => {
          setBusyId(item._id);
          try {
            await api.patch(`/meter-readings/${item._id}/void`, {});
            list.reload();
          } catch (err) {
            Alert.alert('Could not void', apiError(err, 'Failed to void reading.'));
          } finally { setBusyId(null); }
        },
      },
    ]);
  }, [list]);

  const handleDelete = useCallback((item: MeterReading) => {
    Alert.alert('Delete reading', `Delete this ${item.status} reading (${item.utilityType} · ${item.billingPeriod})? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          setBusyId(item._id);
          try {
            await api.delete(`/meter-readings/${item._id}`);
            list.reload();
          } catch (err) {
            Alert.alert('Could not delete', apiError(err, 'Failed to delete reading.'));
          } finally { setBusyId(null); }
        },
      },
    ]);
  }, [list]);

  const renderItem = ({ item }: { item: MeterReading }) => {
    const sc       = STATUS_COLORS[item.status] ?? STATUS_COLORS.draft;
    const iconName = UTILITY_ICONS[item.utilityType?.toLowerCase()] ?? 'speedometer-outline';
    const propName = item.property?.propertyName ?? '';
    const busy     = busyId === item._id;
    const draft    = item.status === 'draft';

    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.utilIcon}>
            <Ionicons name={iconName as any} size={20} color={Colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.cardTitle}>
              {item.utilityType ?? 'Utility'} · {item.billingPeriod ?? ''}
            </Text>
            <Text style={styles.tenantName} numberOfLines={1}>
              {item.tenant?.name ?? 'No tenant linked'}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {[item.unit?.unitNumber, propName].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeText, { color: sc.text }]}>{(item.status ?? '').toUpperCase()}</Text>
            </View>
            <Text style={styles.amount}>{fmtKES(item.amount)}</Text>
          </View>
        </View>

        <View style={styles.readingRow}>
          <View style={styles.readingCell}>
            <Text style={styles.readingLabel}>PREV</Text>
            <Text style={styles.readingValue}>{fmtNumber(item.previousReading)}</Text>
          </View>
          <Ionicons name="arrow-forward" size={14} color={Colors.textMuted} />
          <View style={styles.readingCell}>
            <Text style={styles.readingLabel}>CURR</Text>
            <Text style={styles.readingValue}>{fmtNumber(item.currentReading)}</Text>
          </View>
          <View style={[styles.readingCell, { marginLeft: 'auto' }]}>
            <Text style={styles.readingLabel}>USAGE</Text>
            <Text style={[styles.readingValue, { color: Colors.primary }]}>{fmtNumber(item.unitsConsumed)}</Text>
          </View>
          <View style={styles.readingCell}>
            <Text style={styles.readingLabel}>RATE</Text>
            <Text style={styles.readingValue}>{fmtMoney(item.rate)}</Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <View style={{ flex: 1 }}>
            <Text style={styles.date}>{fmtDate(item.readingDate)}</Text>
            {item.status === 'billed' && item.billedInvoice?.invoiceNumber ? (
              <Text style={[styles.date, { color: Colors.success, fontWeight: '700' }]}>Invoice {item.billedInvoice.invoiceNumber}</Text>
            ) : null}
            {item.isMeterReset ? <Text style={styles.date}>Meter reset</Text> : null}
          </View>
          {busy ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <View style={styles.footerBtns}>
              {draft || item.status === 'void' ? (
                <TouchableOpacity style={styles.ghostBtn} onPress={() => handleDelete(item)} disabled={!!busyId}>
                  <Ionicons name="trash-outline" size={14} color={Colors.danger} />
                </TouchableOpacity>
              ) : null}
              {draft ? (
                <TouchableOpacity style={styles.ghostBtn} onPress={() => handleVoid(item)} disabled={!!busyId}>
                  <Text style={styles.ghostBtnText}>Void</Text>
                </TouchableOpacity>
              ) : null}
              {draft ? (
                <TouchableOpacity style={styles.billBtn} onPress={() => handleBill(item)} disabled={!!busyId}>
                  <Ionicons name="receipt-outline" size={13} color={Colors.white} />
                  <Text style={styles.billBtnText}>Generate Bill</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.header}>
        <Dropdown
          label=""
          placeholder="All properties"
          selectedId={propId}
          selectedLabel={propLabel}
          items={properties}
          onSelect={item => { setPropId(item._id); setPropLabel(item.label); setPropOpen(false); }}
          onClear={() => { setPropId(''); setPropLabel(''); }}
          loading={propsLoading}
          open={propOpen}
          onToggle={() => setPropOpen(o => !o)}
        />
      </View>

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

      {list.loading ? (
        <MilikLoader fullscreen />
      ) : list.error && list.items.length === 0 ? (
        <ErrorState message={list.error} onRetry={list.retry} />
      ) : (
        <FlatList
          data={list.items}
          keyExtractor={item => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} tintColor={Colors.primary} />
          }
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.3}
          ListHeaderComponent={list.error ? <ErrorBanner message={list.error} onRetry={list.reload} /> : null}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="speedometer-outline" size={48} color={Colors.border} />
              <Text style={styles.emptyText}>
                {filter === 'draft' ? 'No draft readings waiting to be billed' : 'No meter readings'}
              </Text>
            </View>
          }
          ListFooterComponent={
            list.loadingMore ? (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={Colors.primary} />
              </View>
            ) : null
          }
        />
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/pms/meters/new' as any)}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color={Colors.white} />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyText: { fontSize: 15, color: Colors.textMuted },
  list:      { paddingBottom: 100 },
  fab: {
    position: 'absolute', bottom: 28, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 8,
  },

  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, zIndex: 10 },

  tabs: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
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
    padding: 14, gap: 10,
  },
  cardTop:    { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  utilIcon: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: Colors.primaryFaded,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle:  { fontSize: 14, fontWeight: '700', color: Colors.text },
  tenantName: { fontSize: 12, fontWeight: '600', color: Colors.text },
  meta:       { fontSize: 11, color: Colors.textMuted },
  amount:     { fontSize: 13, fontWeight: '800', color: Colors.text },

  readingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingTop: 8, borderTopWidth: 1, borderTopColor: Colors.borderLight,
  },
  readingCell:  { alignItems: 'center', gap: 2 },
  readingLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: Colors.textMuted },
  readingValue: { fontSize: 13, fontWeight: '700', color: Colors.text },

  badge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },

  cardFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: 8,
  },
  date: { fontSize: 10, color: Colors.textMuted },
  footerBtns: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: 8, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 10, paddingVertical: 6, minHeight: 30,
  },
  ghostBtnText: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary },

  billBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.primary, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6,
    minWidth: 44, justifyContent: 'center',
  },
  billBtnText: { fontSize: 11, fontWeight: '700', color: Colors.white },
});
