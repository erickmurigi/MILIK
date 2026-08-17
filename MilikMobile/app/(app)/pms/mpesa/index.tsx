import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal, Alert, FlatList as FL,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

// ── Types ────────────────────────────────────────────────────────────────────
type Collection = {
  _id:              string;
  transactionCode:  string;
  transactionDate:  string;
  amount:           number;
  payerName:        string;
  msisdn:           string;
  accountReference: string;
  billRefNumber:    string;
  matchingStatus:   string;
  tenant?:          { _id?: string; name?: string; unit?: { unitNumber?: string } };
  matchedReceipt?:  { receiptNumber?: string; referenceNumber?: string };
  metadata?:        { autoReceiptSkipReason?: string };
};
type SummaryRow = { _id: string; count: number; totalAmount: number };
type TenantOption = { _id: string; name: string; unit?: { unitNumber?: string } };

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });

const STATUS_META: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  unmatched:     { label: 'Unmatched',  bg: Colors.warningLight, text: Colors.warning, dot: Colors.warning },
  matched_tenant:{ label: 'Matched',    bg: Colors.warningLight, text: Colors.warning, dot: Colors.warning },
  captured:      { label: 'Captured',   bg: Colors.successLight, text: Colors.success, dot: Colors.success },
  ignored:       { label: 'Ignored',    bg: Colors.borderLight,  text: Colors.textMuted, dot: Colors.border },
  duplicate:     { label: 'Duplicate',  bg: Colors.dangerLight,  text: Colors.danger, dot: Colors.danger },
};

const FILTER_TABS = ['all', 'unmatched', 'captured', 'ignored', 'duplicate'] as const;
type FilterTab = typeof FILTER_TABS[number];

// ── Screen ───────────────────────────────────────────────────────────────────
export default function MpesaNotificationsScreen() {
  const [items,       setItems]       = useState<Collection[]>([]);
  const [summary,     setSummary]     = useState<SummaryRow[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [filter,      setFilter]      = useState<FilterTab>('all');
  const [search,      setSearch]      = useState('');
  const [page,        setPage]        = useState(1);
  const [hasMore,     setHasMore]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Assign tenant modal
  const [assignTarget, setAssignTarget] = useState<Collection | null>(null);
  const [tenantSearch, setTenantSearch] = useState('');
  const [allTenants,   setAllTenants]   = useState<TenantOption[]>([]);
  const [tenantResults, setTenantResults] = useState<TenantOption[]>([]);
  const [tenantSearching, setTenantSearching] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const LIMIT = 50;
  const searchRef = useRef(search);
  searchRef.current = search;

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async (pg = 1, replace = true) => {
    if (pg === 1) replace ? setLoading(true) : setRefreshing(true);
    else setLoadingMore(true);

    try {
      const params: Record<string, string> = {
        page: String(pg), limit: String(LIMIT),
      };
      if (filter !== 'all')         params.status = filter;
      if (searchRef.current.trim()) params.search  = searchRef.current.trim();

      const { data } = await api.get('/mpesa-collections', { params });
      const rows: Collection[] = data.data ?? [];
      if (pg === 1) setSummary(data.summary ?? []);

      setItems(prev => replace || pg === 1 ? rows : [...prev, ...rows]);
      setHasMore(rows.length === LIMIT);
      setPage(pg);
    } catch { /* fail silently */ }
    finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [filter]);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => {
    const t = setTimeout(() => load(1), 400);
    return () => clearTimeout(t);
  }, [search]);

  // ── Summary chips ─────────────────────────────────────────────────────────
  const sumMap = Object.fromEntries(summary.map(s => [s._id, s]));
  const unmatchedCount = (sumMap.unmatched?.count ?? 0) + (sumMap.matched_tenant?.count ?? 0);

  // Load all tenants when assign modal opens
  useEffect(() => {
    if (!assignTarget) return;
    setTenantSearching(true);
    api.get('/tenants', { params: { limit: 100, status: 'active' } })
      .then(({ data }) => {
        const rows: TenantOption[] = data.data ?? data.tenants ?? [];
        setAllTenants(rows);
        setTenantResults(rows);
      })
      .catch(() => { setAllTenants([]); setTenantResults([]); })
      .finally(() => setTenantSearching(false));
  }, [assignTarget]);

  // Filter locally as user types
  useEffect(() => {
    if (!tenantSearch.trim()) { setTenantResults(allTenants); return; }
    const q = tenantSearch.toLowerCase();
    setTenantResults(allTenants.filter(t => t.name.toLowerCase().includes(q)));
  }, [tenantSearch, allTenants]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const openAssign = (item: Collection) => {
    setAssignTarget(item);
    setTenantSearch('');
    setAllTenants([]);
    setTenantResults([]);
  };

  const doAssign = async (tenant: TenantOption) => {
    if (!assignTarget) return;
    setAssigning(true);
    try {
      await api.post(`/mpesa-collections/${assignTarget._id}/assign-tenant`, { tenantId: tenant._id });
      setAssignTarget(null);
      load(1);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to assign tenant.');
    } finally {
      setAssigning(false);
    }
  };

  const doIgnore = (item: Collection) => {
    Alert.alert('Ignore Transaction', `Ignore KES ${fmt(item.amount)} from ${item.payerName || item.msisdn}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Ignore', style: 'destructive',
        onPress: async () => {
          try {
            await api.post(`/mpesa-collections/${item._id}/ignore`);
            load(1);
          } catch (err: any) {
            Alert.alert('Error', err?.response?.data?.message ?? 'Failed to ignore.');
          }
        },
      },
    ]);
  };

  const doUnignore = async (item: Collection) => {
    try {
      await api.post(`/mpesa-collections/${item._id}/unignore`);
      load(1);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to restore.');
    }
  };

  // ── Render collection card ─────────────────────────────────────────────────
  const renderItem = ({ item }: { item: Collection }) => {
    const sm = STATUS_META[item.matchingStatus] ?? STATUS_META.unmatched;
    const canAssign = ['unmatched', 'matched_tenant'].includes(item.matchingStatus);
    const isIgnored = item.matchingStatus === 'ignored';

    return (
      <View style={styles.card}>
        {/* Status dot + top row */}
        <View style={styles.cardTop}>
          <View style={[styles.statusDot, { backgroundColor: sm.dot }]} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.txCode}>{item.transactionCode || item.billRefNumber || '—'}</Text>
            <Text style={styles.payer} numberOfLines={1}>
              {item.payerName || item.msisdn || 'Unknown payer'}
            </Text>
            {item.accountReference ? (
              <Text style={styles.meta}>Ref: {item.accountReference}</Text>
            ) : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={styles.amount}>KES {fmt(item.amount)}</Text>
            <View style={[styles.badge, { backgroundColor: sm.bg }]}>
              <Text style={[styles.badgeText, { color: sm.text }]}>{sm.label}</Text>
            </View>
          </View>
        </View>

        {/* Tenant / receipt link */}
        {item.tenant?.name ? (
          <View style={styles.tenantRow}>
            <Ionicons name="person-circle-outline" size={14} color={Colors.primary} />
            <Text style={styles.tenantText}>{item.tenant.name}</Text>
            {item.tenant.unit?.unitNumber ? (
              <Text style={styles.meta}> · {item.tenant.unit.unitNumber}</Text>
            ) : null}
          </View>
        ) : null}
        {item.matchedReceipt ? (
          <View style={styles.tenantRow}>
            <Ionicons name="receipt-outline" size={14} color={Colors.success} />
            <Text style={[styles.tenantText, { color: Colors.success }]}>
              {item.matchedReceipt.receiptNumber || item.matchedReceipt.referenceNumber || 'Receipt linked'}
            </Text>
          </View>
        ) : null}
        {item.metadata?.autoReceiptSkipReason ? (
          <Text style={styles.skipReason}>⚠ {item.metadata.autoReceiptSkipReason}</Text>
        ) : null}

        {/* Actions */}
        <View style={styles.actions}>
          <Text style={styles.date}>{fmtDate(item.transactionDate)}</Text>
          <View style={styles.actionBtns}>
            {isIgnored ? (
              <TouchableOpacity style={styles.actionBtn} onPress={() => doUnignore(item)}>
                <Ionicons name="refresh-outline" size={14} color={Colors.primary} />
                <Text style={[styles.actionBtnText, { color: Colors.primary }]}>Restore</Text>
              </TouchableOpacity>
            ) : canAssign ? (
              <>
                <TouchableOpacity style={styles.actionBtn} onPress={() => doIgnore(item)}>
                  <Ionicons name="ban-outline" size={14} color={Colors.danger} />
                  <Text style={[styles.actionBtnText, { color: Colors.danger }]}>Ignore</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: Colors.primary, borderColor: Colors.primary }]}
                  onPress={() => openAssign(item)}
                >
                  <Ionicons name="link-outline" size={14} color={Colors.white} />
                  <Text style={[styles.actionBtnText, { color: Colors.white }]}>Assign</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </View>
      </View>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Summary strip */}
      <View style={styles.summaryStrip}>
        {[
          { key: 'unmatched', label: 'Pending', count: unmatchedCount },
          { key: 'captured',  label: 'Captured',  count: sumMap.captured?.count ?? 0 },
          { key: 'ignored',   label: 'Ignored',   count: sumMap.ignored?.count ?? 0 },
          { key: 'duplicate', label: 'Duplicate', count: sumMap.duplicate?.count ?? 0 },
        ].map((s, i) => (
          <TouchableOpacity
            key={s.key}
            style={[styles.summaryCell, i > 0 && styles.summaryCellBorder]}
            onPress={() => setFilter(s.key as FilterTab)}
          >
            <Text style={styles.summaryCount}>{s.count}</Text>
            <Text style={styles.summaryLabel}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Search + filter */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search code, payer..."
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

      <View style={styles.tabs}>
        {FILTER_TABS.map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.tab, filter === f && styles.tabActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.tabText, filter === f && styles.tabTextActive]}>
              {f === 'all' ? 'All' : (STATUS_META[f]?.label ?? f)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <MilikLoader fullscreen />
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(1)} tintColor={Colors.primary} />
          }
          onEndReached={() => { if (!loadingMore && hasMore) load(page + 1, false); }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="phone-portrait-outline" size={48} color={Colors.border} />
              <Text style={styles.emptyText}>
                {filter === 'unmatched' ? 'No pending transactions' : 'No transactions found'}
              </Text>
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

      {/* Assign Tenant Modal */}
      <Modal visible={!!assignTarget} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>Assign to Tenant</Text>
              {assignTarget ? (
                <Text style={styles.modalSub}>
                  KES {fmt(assignTarget.amount)} · {assignTarget.transactionCode}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={() => { setAssignTarget(null); setTenantSearch(''); setAllTenants([]); setTenantResults([]); }}>
              <Ionicons name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.modalSearch}>
            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search tenant name..."
                placeholderTextColor={Colors.textMuted}
                value={tenantSearch}
                onChangeText={setTenantSearch}
                autoFocus
              />
              {tenantSearching && <ActivityIndicator size="small" color={Colors.primary} />}
            </View>
          </View>

          {assigning ? (
            <View style={styles.centered}>
              <MilikLoader size="small" />
              <Text style={{ color: Colors.textMuted, marginTop: 12 }}>Assigning...</Text>
            </View>
          ) : (
            <FL
              data={tenantResults}
              keyExtractor={item => item._id}
              contentContainerStyle={{ padding: 16, gap: 8 }}
              renderItem={({ item }: { item: TenantOption }) => (
                <TouchableOpacity style={styles.tenantOption} onPress={() => doAssign(item)}>
                  <View style={styles.tenantOptionAvatar}>
                    <Text style={styles.tenantOptionAvatarText}>
                      {item.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tenantOptionName}>{item.name}</Text>
                    {item.unit?.unitNumber ? (
                      <Text style={styles.tenantOptionMeta}>Unit {item.unit.unitNumber}</Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                !tenantSearching ? (
                  <View style={{ padding: 32, alignItems: 'center', gap: 8 }}>
                    <Ionicons name="people-outline" size={40} color={Colors.border} />
                    <Text style={{ color: Colors.textMuted }}>No tenants found</Text>
                  </View>
                ) : null
              }
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 15, color: Colors.textMuted },
  list:      { paddingBottom: 40 },

  // Summary strip
  summaryStrip: {
    flexDirection: 'row', backgroundColor: Colors.primary,
  },
  summaryCell: {
    flex: 1, alignItems: 'center', paddingVertical: 14,
  },
  summaryCellBorder: { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.15)' },
  summaryCount: { fontSize: 20, fontWeight: '900', color: Colors.white },
  summaryLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: 'rgba(255,255,255,0.65)', marginTop: 2 },

  // Search + tabs
  searchRow: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, height: 42,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text },
  tabs: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 10, gap: 6 },
  tab: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, backgroundColor: Colors.white,
    borderWidth: 1, borderColor: Colors.border,
  },
  tabActive:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText:       { fontSize: 11, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: Colors.white },

  // Card
  card: {
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
    padding: 14, gap: 8,
  },
  cardTop:   { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  txCode:    { fontSize: 14, fontWeight: '800', color: Colors.text },
  payer:     { fontSize: 13, fontWeight: '600', color: Colors.text },
  meta:      { fontSize: 11, color: Colors.textMuted },
  amount:    { fontSize: 16, fontWeight: '900', color: Colors.text },

  badge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },

  tenantRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tenantText: { fontSize: 12, fontWeight: '600', color: Colors.primary },
  skipReason: { fontSize: 11, color: Colors.warning },

  actions:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  date:       { fontSize: 11, color: Colors.textMuted },
  actionBtns: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  actionBtnText: { fontSize: 12, fontWeight: '700' },

  // Modal
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: Colors.text },
  modalSub:   { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  modalSearch:{ padding: 16 },

  tenantOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, padding: 14,
  },
  tenantOptionAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.primaryFaded,
    alignItems: 'center', justifyContent: 'center',
  },
  tenantOptionAvatarText: { fontSize: 18, fontWeight: '800', color: Colors.primary },
  tenantOptionName:       { fontSize: 14, fontWeight: '700', color: Colors.text },
  tenantOptionMeta:       { fontSize: 12, color: Colors.textMuted },
});
