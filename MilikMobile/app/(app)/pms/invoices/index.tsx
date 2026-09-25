import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';
import ListErrorState from '../../../../components/ui/ListErrorState';
import { usePagedList, useDebounced, Page } from '../../../../hooks/usePagedList';
import { fmtMoney, fmtDate } from '../../../../utils/pmsFormat';
import {
  Period, periodRange, invoiceStatusOf,
  INVOICE_STATUS_LABEL, INVOICE_CATEGORY_LABEL, rowsOf,
} from '../../../../utils/pmsBilling';

type Invoice = {
  _id:             string;
  invoiceNumber?:  string;
  invoiceDate?:    string;
  bookingDate?:    string;
  dueDate?:        string;
  createdAt?:      string;
  category?:       string;
  amount:          number;
  adjustedAmount?: number;
  appliedAmount?:  number;
  outstanding?:    number;
  status?:         string;
  computedStatus?: string;
  ledgerMode?:     string;
  description?:    string;
  tenant?:         { _id?: string; name?: string } | string | null;
  unit?:           { unitNumber?: string } | null;
  property?:       { propertyName?: string; name?: string } | null;
};

// Server filters: ACTIVE = everything not cancelled/reversed, Issued = pending + partially_paid,
// paid / reversed = stored status. (Status values are lowercase on the server.)
type StatusFilter = 'ACTIVE' | 'Issued' | 'paid' | 'reversed';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending:        { bg: Colors.dangerLight,  text: Colors.danger   },
  partially_paid: { bg: Colors.warningLight, text: Colors.warning  },
  paid:           { bg: Colors.successLight, text: Colors.success  },
  cancelled:      { bg: Colors.borderLight,  text: Colors.textMuted },
  reversed:       { bg: '#F1F5F9',           text: '#64748B'       },
};

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'ACTIVE',   label: 'All'      },
  { key: 'Issued',   label: 'Unpaid'   },
  { key: 'paid',     label: 'Paid'     },
  { key: 'reversed', label: 'Reversed' },
];

const PERIOD_TABS: { key: Period; label: string }[] = [
  { key: '1M',  label: '1 Mo'   },
  { key: '3M',  label: '3 Mo'   },
  { key: '6M',  label: '6 Mo'   },
  { key: '1Y',  label: 'This Yr'},
  { key: 'All', label: 'All'    },
];

const LIMIT = 30;

export default function InvoicesScreen() {
  const router = useRouter();
  const { tenant: tenantParam, tenantName: tenantNameParam, status: statusParam } =
    useLocalSearchParams<{ tenant?: string; tenantName?: string; status?: string }>();

  const [tenantId, setTenantId] = useState(tenantParam ?? '');
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState<StatusFilter>(statusParam === 'Issued' ? 'Issued' : 'ACTIVE');
  const [period,   setPeriod]   = useState<Period>('All');
  const q = useDebounced(search.trim(), 400);

  const fetchPage = useCallback(async (page: number): Promise<Page<Invoice>> => {
    const params: Record<string, string | number> = {
      page, limit: LIMIT, paginate: 'true', includeSnapshots: 'true', status: filter,
    };
    if (tenantId) params.tenant = tenantId;
    const { from, to } = periodRange(period);
    if (from) params.fromDate = from;
    if (to)   params.toDate   = to;
    // The API searches by invoice number OR tenant name (not both): numbers contain digits, names rarely do.
    if (q) params.search = q; // invoice no., description, tenant (name, code, phone), unit or property

    const { data } = await api.get('/tenant-invoices', { params });
    let items = rowsOf<Invoice>(data);
    // With snapshots on, the server also appends the tenant's outstanding standalone debit notes
    // (not real invoices, no detail record). Only show them when browsing one tenant's open items.
    const showNotes = !!tenantId && (filter === 'ACTIVE' || filter === 'Issued');
    if (!showNotes) items = items.filter(i => i.ledgerMode !== 'invoice_note');
    const totalPages = Number(data?.pagination?.totalPages ?? 1);
    return { items, hasMore: page < totalPages };
  }, [filter, period, q, tenantId]);

  const { items: invoices, loading, refreshing, loadingMore, error, refresh, retry, loadMore } =
    usePagedList<Invoice>(fetchPage, `${filter}|${period}|${q}|${tenantId}`);

  const renderItem = ({ item }: { item: Invoice }) => {
    const st        = invoiceStatusOf(item);
    const sc        = STATUS_COLORS[st] ?? STATUS_COLORS.pending;
    const catLabel  = INVOICE_CATEGORY_LABEL[item.category ?? ''] ?? item.category ?? 'Invoice';
    const tenantObj = item.tenant && typeof item.tenant === 'object' ? item.tenant : null;
    const tenantName = tenantObj?.name || 'Unknown Tenant';
    const propName  = item.property?.propertyName ?? item.property?.name ?? '';
    const isVoided  = st === 'reversed' || st === 'cancelled';
    const total     = Number(item.adjustedAmount ?? item.amount ?? 0);
    const due       = Number(item.outstanding ?? 0);
    const docDate   = item.bookingDate || item.invoiceDate || item.createdAt;

    const openDetail = () => router.push({
      pathname: '/pms/invoices/[id]' as any,
      params: {
        id:            item._id,
        tenantId:      tenantObj?._id ?? (typeof item.tenant === 'string' ? item.tenant : ''),
        invoiceNumber: item.invoiceNumber ?? '',
        status:        st,
        category:      item.category ?? '',
        amount:        String(total),
        outstanding:   item.outstanding != null ? String(due) : '',
        invoiceDate:   item.invoiceDate ?? '',
        dueDate:       item.dueDate ?? '',
        description:   item.description ?? '',
        tenantName,
        unit:          item.unit?.unitNumber ? `Unit ${item.unit.unitNumber}` : '',
        property:      propName,
      },
    });

    return (
      <TouchableOpacity
        style={[styles.card, isVoided && styles.cardReversed]}
        onPress={openDetail}
        activeOpacity={0.75}
      >
        <View style={styles.cardTop}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.invoiceNum, isVoided && styles.textMuted]}>{item.invoiceNumber || '—'}</Text>
            <Text style={[styles.tenantName, isVoided && styles.textMuted]} numberOfLines={1}>
              {tenantName}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {[item.unit?.unitNumber, propName].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeText, { color: sc.text }]}>
                {(INVOICE_STATUS_LABEL[st] ?? st).toUpperCase()}
              </Text>
            </View>
            <Text style={[styles.amount, isVoided && styles.textMuted]}>KES {fmtMoney(total)}</Text>
          </View>
        </View>
        <View style={styles.cardBottom}>
          <Text style={styles.meta}>{catLabel}</Text>
          <Text style={styles.meta}>{fmtDate(docDate)}</Text>
          {!isVoided && due > 0.009 && (
            <Text style={[styles.meta, { color: Colors.danger, fontWeight: '700' }]}>
              Due: {fmtMoney(due)}
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
            placeholder="Invoice no., tenant, unit or property..."
            placeholderTextColor={Colors.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            autoCorrect={false}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Single-tenant scope (coming from a tenant profile) */}
      {tenantId ? (
        <View style={styles.scopeBar}>
          <Ionicons name="person" size={13} color={Colors.primary} />
          <Text style={styles.scopeText} numberOfLines={1}>{tenantNameParam || 'Selected tenant'}</Text>
          <TouchableOpacity onPress={() => setTenantId('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={15} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>
      ) : null}

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
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.primary} />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            error ? (
              <ListErrorState message={error} onRetry={retry} />
            ) : (
              <View style={styles.centered}>
                <Ionicons name="receipt-outline" size={48} color={Colors.border} />
                <Text style={styles.emptyText}>No invoices found</Text>
              </View>
            )
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
        onPress={() => router.push((tenantId ? `/pms/invoices/new?tenant=${tenantId}` : '/pms/invoices/new') as any)}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color={Colors.white} />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
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

  scopeBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: Colors.primaryFaded,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  scopeText: { flex: 1, fontSize: 12, fontWeight: '600', color: Colors.primary },

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
