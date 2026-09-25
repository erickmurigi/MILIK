import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { ErrorBanner, ErrorState } from '../../../../components/ui/PmsStates';
import { useDebounced, usePmsList } from '../../../../hooks/usePmsList';
import { apiError, fmtDateTime, fmtKES } from '../../../../utils/pmsFormat';

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
  tenant?:          { _id?: string; name?: string; unit?: { unitNumber?: string } } | null;
  matchedReceipt?:  { receiptNumber?: string; referenceNumber?: string } | null;
  metadata?:        { autoReceiptSkipReason?: string; manualAssignment?: { assignedByName?: string } };
};
type SummaryRow = { _id: string; count: number; totalAmount: number };
type TenantOption = {
  _id: string; name: string; tenantCode?: string; phone?: string; status?: string;
  unit?: { unitNumber?: string; property?: { propertyName?: string } } | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  unmatched:     { label: 'Unmatched',  bg: Colors.warningLight, text: Colors.warning, dot: Colors.warning },
  matched_tenant:{ label: 'Unmatched',  bg: Colors.warningLight, text: Colors.warning, dot: Colors.warning },
  captured:      { label: 'Captured',   bg: Colors.successLight, text: Colors.success, dot: Colors.success },
  ignored:       { label: 'Ignored',    bg: Colors.borderLight,  text: Colors.textMuted, dot: Colors.border },
  duplicate:     { label: 'Duplicate',  bg: Colors.dangerLight,  text: Colors.danger, dot: Colors.danger },
};

const FILTER_TABS = [
  { key: 'all',       label: 'All' },
  { key: 'unmatched', label: 'Pending' },
  { key: 'captured',  label: 'Captured' },
  { key: 'ignored',   label: 'Ignored' },
  { key: 'duplicate', label: 'Duplicate' },
] as const;
type FilterTab = typeof FILTER_TABS[number]['key'];

const INACTIVE_TENANT = ['terminated', 'moved_out', 'inactive', 'evicted'];

const isPending  = (c: Collection) => c.matchingStatus === 'unmatched' || c.matchingStatus === 'matched_tenant';
const tenantUnit = (t: TenantOption) =>
  [t.unit?.unitNumber ? `Unit ${t.unit.unitNumber}` : '', t.unit?.property?.propertyName].filter(Boolean).join(' · ');

const parseCollections = (d: any) => ({
  rows:  (d?.data ?? []) as Collection[],
  pages: d?.pagination?.pages as number | undefined,
  total: d?.pagination?.total as number | undefined,
  extra: (d?.summary ?? []) as SummaryRow[],
});

// ── Screen ───────────────────────────────────────────────────────────────────
export default function MpesaNotificationsScreen() {
  const [filter, setFilter] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search.trim(), 400);
  const [busyId, setBusyId] = useState<string | null>(null);

  const list = usePmsList<Collection, SummaryRow[]>({
    path: '/mpesa-collections',
    params: { status: filter === 'all' ? undefined : filter, search: debouncedSearch || undefined },
    parse: parseCollections,
  });
  const { items, reload } = list;

  // Assign-tenant modal
  const [assignTarget, setAssignTarget] = useState<Collection | null>(null);
  const [tenantSearch, setTenantSearch] = useState('');
  const [tenantResults, setTenantResults] = useState<TenantOption[]>([]);
  const [tenantSearching, setTenantSearching] = useState(false);
  const [tenantError, setTenantError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const tenantReq = useRef(0);

  const summary = list.extra ?? [];
  const sumMap = Object.fromEntries(summary.map(s => [s._id, s])) as Record<string, SummaryRow | undefined>;
  const pendingCount = (sumMap.unmatched?.count ?? 0) + (sumMap.matched_tenant?.count ?? 0);

  // ── Tenant search (server side — the tenant list can be far bigger than one page) ──
  const searchTenants = useCallback(async (term: string) => {
    const q = term.trim();
    const id = ++tenantReq.current;
    if (q.length < 2) {
      setTenantResults([]); setTenantSearching(false); setTenantError(null);
      return;
    }
    setTenantSearching(true);
    try {
      const { data } = await api.get('/tenants', { params: { search: q, limit: 25 } });
      if (id !== tenantReq.current) return;
      setTenantResults((data?.data ?? []) as TenantOption[]);
      setTenantError(null);
    } catch (err) {
      if (id !== tenantReq.current) return;
      setTenantResults([]);
      setTenantError(apiError(err, 'Tenant search failed.'));
    } finally {
      if (id === tenantReq.current) setTenantSearching(false);
    }
  }, []);

  const debouncedTenantSearch = useDebounced(tenantSearch, 350);
  useEffect(() => {
    if (assignTarget) searchTenants(debouncedTenantSearch);
  }, [assignTarget, debouncedTenantSearch, searchTenants]);

  const closeAssign = () => {
    if (assigning) return;
    tenantReq.current++;
    setAssignTarget(null);
    setTenantSearch('');
    setTenantResults([]);
    setTenantError(null);
  };

  // ── Actions ───────────────────────────────────────────────────────────────
  const openAssign = (item: Collection) => {
    // Same as web: start with what the payer typed as the account reference.
    setTenantSearch(item.accountReference || item.billRefNumber || '');
    setTenantResults([]);
    setTenantError(null);
    setAssignTarget(item);
  };

  const runAssign = async (item: Collection, tenant: { _id: string; name: string }) => {
    setAssigning(true);
    setBusyId(item._id);
    try {
      const { data } = await api.post(`/mpesa-collections/${item._id}/assign-tenant`, { tenantId: tenant._id });
      const updated = data?.data as Collection | undefined;
      const captured = updated?.matchingStatus === 'captured' && !!updated?.matchedReceipt;
      tenantReq.current++;
      setAssignTarget(null);
      setTenantSearch('');
      setTenantResults([]);
      reload();
      if (captured) {
        Alert.alert('Receipt recorded', `${fmtKES(item.amount)} was receipted to ${tenant.name}.`);
      } else {
        const reason = updated?.metadata?.autoReceiptSkipReason;
        Alert.alert(
          `Assigned to ${tenant.name}`,
          reason
            ? `No receipt was recorded yet: ${reason}.`
            : 'The payment is linked to the tenant but no receipt has been recorded yet.',
        );
      }
    } catch (err) {
      Alert.alert('Could not assign', apiError(err, 'Failed to assign tenant.'));
    } finally {
      setAssigning(false);
      setBusyId(null);
    }
  };

  const confirmAssign = (tenant: TenantOption) => {
    if (!assignTarget || assigning) return;
    const item = assignTarget;
    const inactive = !!tenant.status && INACTIVE_TENANT.includes(tenant.status);
    Alert.alert(
      'Assign payment',
      `Assign ${fmtKES(item.amount)} (${item.transactionCode || 'M-Pesa'}) to ${tenant.name}?\n\n` +
        'A receipt will be recorded against this tenant.' +
        (inactive ? `\n\nNote: this tenant is ${tenant.status?.replace('_', ' ')}.` : ''),
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Assign', onPress: () => runAssign(item, tenant) },
      ],
    );
  };

  const retryReceipt = (item: Collection) => {
    if (!item.tenant?._id || busyId) return;
    const tenant = { _id: item.tenant._id, name: item.tenant.name || 'tenant' };
    Alert.alert(
      'Record receipt',
      `Record ${fmtKES(item.amount)} (${item.transactionCode || 'M-Pesa'}) as a receipt for ${tenant.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Record', onPress: () => runAssign(item, tenant) },
      ],
    );
  };

  const doIgnore = (item: Collection) => {
    Alert.alert('Ignore transaction', `Ignore ${fmtKES(item.amount)} from ${item.payerName || item.msisdn || 'this payer'}? You can restore it later.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Ignore', style: 'destructive',
        onPress: async () => {
          setBusyId(item._id);
          try {
            await api.post(`/mpesa-collections/${item._id}/ignore`, {});
            reload();
          } catch (err) {
            Alert.alert('Could not ignore', apiError(err, 'Failed to ignore.'));
          } finally { setBusyId(null); }
        },
      },
    ]);
  };

  const doUnignore = async (item: Collection) => {
    if (busyId) return;
    setBusyId(item._id);
    try {
      await api.post(`/mpesa-collections/${item._id}/unignore`, {});
      reload();
    } catch (err) {
      Alert.alert('Could not restore', apiError(err, 'Failed to restore.'));
    } finally { setBusyId(null); }
  };

  // ── Render collection card ─────────────────────────────────────────────────
  const renderItem = ({ item }: { item: Collection }) => {
    const sm = STATUS_META[item.matchingStatus] ?? STATUS_META.unmatched;
    const pending = isPending(item);
    const hasTenant = !!item.tenant?._id;
    const hasReceipt = !!item.matchedReceipt;
    const canAssign = pending && !hasTenant && !hasReceipt;
    const canRecord = pending && hasTenant && !hasReceipt;
    const canIgnore = pending && !hasReceipt;
    const isIgnored = item.matchingStatus === 'ignored';
    const busy = busyId === item._id;

    return (
      <View style={styles.card}>
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
            <Text style={styles.amount}>{fmtKES(item.amount)}</Text>
            <View style={[styles.badge, { backgroundColor: sm.bg }]}>
              <Text style={[styles.badgeText, { color: sm.text }]}>{sm.label}</Text>
            </View>
          </View>
        </View>

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
        {pending && item.metadata?.autoReceiptSkipReason ? (
          <Text style={styles.skipReason}>⚠ {item.metadata.autoReceiptSkipReason}</Text>
        ) : null}

        <View style={styles.actions}>
          <Text style={styles.date}>{fmtDateTime(item.transactionDate)}</Text>
          <View style={styles.actionBtns}>
            {busy ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : isIgnored ? (
              <TouchableOpacity style={styles.actionBtn} onPress={() => doUnignore(item)}>
                <Ionicons name="refresh-outline" size={14} color={Colors.primary} />
                <Text style={[styles.actionBtnText, { color: Colors.primary }]}>Restore</Text>
              </TouchableOpacity>
            ) : (
              <>
                {canIgnore ? (
                  <TouchableOpacity style={styles.actionBtn} onPress={() => doIgnore(item)} disabled={!!busyId}>
                    <Ionicons name="ban-outline" size={14} color={Colors.danger} />
                    <Text style={[styles.actionBtnText, { color: Colors.danger }]}>Ignore</Text>
                  </TouchableOpacity>
                ) : null}
                {canAssign ? (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionBtnPrimary]}
                    onPress={() => openAssign(item)}
                    disabled={!!busyId}
                  >
                    <Ionicons name="link-outline" size={14} color={Colors.white} />
                    <Text style={[styles.actionBtnText, { color: Colors.white }]}>Assign</Text>
                  </TouchableOpacity>
                ) : null}
                {canRecord ? (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionBtnPrimary]}
                    onPress={() => retryReceipt(item)}
                    disabled={!!busyId}
                  >
                    <Ionicons name="receipt-outline" size={14} color={Colors.white} />
                    <Text style={[styles.actionBtnText, { color: Colors.white }]}>Record</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            )}
          </View>
        </View>
      </View>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.summaryStrip}>
        {[
          { key: 'unmatched', label: 'PENDING',   count: pendingCount },
          { key: 'captured',  label: 'CAPTURED',  count: sumMap.captured?.count ?? 0 },
          { key: 'ignored',   label: 'IGNORED',   count: sumMap.ignored?.count ?? 0 },
          { key: 'duplicate', label: 'DUPLICATE', count: sumMap.duplicate?.count ?? 0 },
        ].map((s, i) => (
          <TouchableOpacity
            key={s.key}
            style={[styles.summaryCell, i > 0 && styles.summaryCellBorder]}
            onPress={() => setFilter(s.key as FilterTab)}
            activeOpacity={0.8}
          >
            <Text style={styles.summaryCount}>{s.count}</Text>
            <Text style={styles.summaryLabel}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Code, payer, phone, tenant or reference..."
            placeholderTextColor={Colors.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            autoCorrect={false}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View style={styles.tabs}>
        {FILTER_TABS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.tab, filter === f.key && styles.tabActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.tabText, filter === f.key && styles.tabTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {list.loading ? (
        <MilikLoader fullscreen />
      ) : list.error && items.length === 0 ? (
        <ErrorState message={list.error} onRetry={list.retry} />
      ) : (
        <FlatList
          data={items}
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
              <Ionicons name="phone-portrait-outline" size={48} color={Colors.border} />
              <Text style={styles.emptyText}>
                {debouncedSearch
                  ? 'No transactions match your search'
                  : filter === 'unmatched' ? 'No pending transactions' : 'No transactions found'}
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

      {/* Assign Tenant Modal */}
      <Modal
        visible={!!assignTarget}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeAssign}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>Assign to Tenant</Text>
              {assignTarget ? (
                <Text style={styles.modalSub}>
                  {fmtKES(assignTarget.amount)} · {assignTarget.transactionCode}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={closeAssign} hitSlop={8} disabled={assigning}>
              <Ionicons name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
          </View>

          {assignTarget && (assignTarget.accountReference || assignTarget.billRefNumber) ? (
            <View style={styles.refNotice}>
              <Ionicons name="alert-circle-outline" size={14} color={Colors.warning} />
              <Text style={styles.refNoticeText}>
                Payer typed “{assignTarget.accountReference || assignTarget.billRefNumber}” as the reference. Search to find the right tenant.
              </Text>
            </View>
          ) : null}

          <View style={styles.modalSearch}>
            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Tenant name, code, phone or ID"
                placeholderTextColor={Colors.textMuted}
                value={tenantSearch}
                onChangeText={setTenantSearch}
                autoCorrect={false}
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
            <FlatList
              data={tenantResults}
              keyExtractor={item => item._id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 16, gap: 8 }}
              renderItem={({ item }: { item: TenantOption }) => {
                const inactive = !!item.status && INACTIVE_TENANT.includes(item.status);
                return (
                  <TouchableOpacity style={styles.tenantOption} onPress={() => confirmAssign(item)} activeOpacity={0.75}>
                    <View style={styles.tenantOptionAvatar}>
                      <Text style={styles.tenantOptionAvatarText}>{(item.name || '?').charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.tenantOptionName} numberOfLines={1}>
                        {item.name}{item.tenantCode ? `  ·  ${item.tenantCode}` : ''}
                      </Text>
                      {tenantUnit(item) || item.phone ? (
                        <Text style={styles.tenantOptionMeta} numberOfLines={1}>
                          {[tenantUnit(item), item.phone].filter(Boolean).join(' · ')}
                        </Text>
                      ) : null}
                      {inactive ? (
                        <Text style={[styles.tenantOptionMeta, { color: Colors.danger, fontWeight: '700' }]}>
                          {item.status?.replace('_', ' ').toUpperCase()}
                        </Text>
                      ) : null}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                tenantSearching ? null : (
                  <View style={{ padding: 32, alignItems: 'center', gap: 8 }}>
                    <Ionicons name="people-outline" size={40} color={Colors.border} />
                    <Text style={{ color: Colors.textMuted, textAlign: 'center' }}>
                      {tenantError
                        ? tenantError
                        : tenantSearch.trim().length < 2
                          ? 'Type at least 2 characters to search tenants'
                          : 'No tenants found'}
                    </Text>
                  </View>
                )
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
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
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
  actionBtns: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  actionBtnPrimary: { backgroundColor: Colors.primary, borderColor: Colors.primary },
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
  refNotice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    paddingHorizontal: 20, paddingVertical: 10,
    backgroundColor: Colors.warningLight,
  },
  refNoticeText: { flex: 1, fontSize: 12, color: Colors.warning, lineHeight: 17 },

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
