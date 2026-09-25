import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  ActivityIndicator, RefreshControl, Modal, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { ErrorBanner, ErrorState } from '../../../../components/ui/PmsStates';
import { useDebounced, usePmsList, useReloadOnFocus } from '../../../../hooks/usePmsList';
import { cleanDecimal, fmtDateTime, fmtKES } from '../../../../utils/pmsFormat';
import {
  ACC, CW, CWL, RANGE_CHIPS, cwError, cwMessage, listOf, normalizePlate, paginationOf, rangeParams, round2, type Range,
} from '../../../../utils/carwash';

type Notification = {
  _id:              string;
  transactionCode?: string;
  transactionDate?: string;
  createdAt?:       string;
  amount:           number;
  allocatedAmount?: number;
  senderName?:      string;
  msisdn?:          string;
  maskedMsisdn?:    string;
  billRefNumber?:   string;
  plate?:           string;
  status:           'matched' | 'unmatched' | 'duplicate' | 'rejected' | 'error' | 'stk_pending';
  isReversed?:      boolean;
  resultDesc?:      string;
  notes?:           string;
  matchedJob?:      { jobNumber?: string; plateNumber?: string; customerName?: string } | null;
};

type UnpaidJob = {
  _id: string; jobNumber?: string; plateNumber?: string; customerName?: string;
  serviceName?: string; createdAt?: string; outstanding: number;
};

type StatusSummary = { _id: string; count: number; totalAmount: number };

const TABS = [
  { key: 'unallocated', label: 'Unallocated', status: 'unmatched' },
  { key: 'allocated',   label: 'Allocated',   status: 'matched'   },
  { key: 'all',         label: 'All',         status: ''          },
] as const;
type Tab = typeof TABS[number]['key'];

const STATUS_META: Record<string, { label: string; bg: string; color: string; icon: string }> = {
  matched:     { label: 'Matched',     bg: '#D1FAE5', color: '#059669', icon: 'checkmark-circle'  },
  unmatched:   { label: 'Unmatched',   bg: '#FEF3C7', color: '#D97706', icon: 'time-outline'      },
  duplicate:   { label: 'Duplicate',   bg: '#DBEAFE', color: '#1D4ED8', icon: 'copy-outline'      },
  rejected:    { label: 'Rejected',    bg: '#FEE2E2', color: '#DC2626', icon: 'close-circle'      },
  error:       { label: 'Error',       bg: '#F1F5F9', color: '#64748B', icon: 'alert-circle'      },
  stk_pending: { label: 'STK pending', bg: '#FFEDD5', color: '#C2410C', icon: 'hourglass-outline' },
};

const parse = (data: any) => {
  const p = paginationOf(data);
  return {
    rows:  listOf<Notification>(data, 'notifications'),
    pages: p.pages,
    total: p.total,
    extra: (data?.data?.summary ?? data?.summary ?? []) as StatusSummary[],
  };
};

const maskPhone = (n: Notification) =>
  n.msisdn ? `${n.msisdn.slice(0, 4)}***${n.msisdn.slice(-3)}` : n.maskedMsisdn ? 'Number hidden by M-Pesa' : '—';

/** Part of the payment not yet given to a job. */
const remainingOf = (n: Notification) => Math.max(0, round2(Number(n.amount || 0) - Number(n.allocatedAmount || 0)));

const canAllocate = (n: Notification) =>
  !n.isReversed && n.amount > 0 &&
  (n.status === 'unmatched' || n.status === 'error' || (Number(n.allocatedAmount) > 0 && remainingOf(n) > 0.009 && n.status !== 'matched'));

const canAssign = (n: Notification) =>
  !n.isReversed && n.amount > 0 && (n.status === 'unmatched' || n.status === 'error') && !(Number(n.allocatedAmount) > 0);

// ─── Allocate / assign modal ────────────────────────────────────────────────────

function AllocateModal({ notif, mode, onClose, onDone }: {
  notif: Notification; mode: 'allocate' | 'assign'; onClose: () => void; onDone: (message: string) => void;
}) {
  const [jobs,    setJobs]    = useState<UnpaidJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [search,  setSearch]  = useState('');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [saving,  setSaving]  = useState(false);

  const available = remainingOf(notif);

  const loadJobs = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data } = await api.get('/carwash/mpesa/unpaid-jobs');
      setJobs(listOf<UnpaidJob>(data, 'jobs'));
    } catch (err) {
      setError(cwError(err, 'Could not load the unpaid jobs.'));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { loadJobs(); }, [loadJobs]);

  const shown = useMemo(() => {
    const q = search.trim().toUpperCase();
    const qPlate = normalizePlate(search);
    const rows = q
      ? jobs.filter(j =>
          normalizePlate(j.plateNumber || '').includes(qPlate || '\u0000') ||
          (j.jobNumber || '').toUpperCase().includes(q) ||
          (j.customerName || '').toUpperCase().includes(q))
      : jobs;
    // Jobs for the plate the payer typed come first.
    const mine = normalizePlate(notif.plate || notif.billRefNumber || '');
    if (!mine) return rows;
    return [...rows].sort((a, b) =>
      Number(normalizePlate(b.plateNumber || '') === mine) - Number(normalizePlate(a.plateNumber || '') === mine));
  }, [jobs, search, notif.plate, notif.billRefNumber]);

  const total    = round2(Object.values(amounts).reduce((s, v) => s + (parseFloat(v) || 0), 0));
  const leftover = round2(available - total);
  const isOver   = total > available + 0.009;

  const fill = (job: UnpaidJob) =>
    setAmounts(prev => {
      const others = Object.entries(prev).reduce((s, [k, v]) => (k === job._id ? s : s + (parseFloat(v) || 0)), 0);
      const room   = Math.max(0, available - others);
      return { ...prev, [job._id]: String(round2(Math.min(job.outstanding, room))) };
    });

  const submitAllocations = () => {
    const entries = Object.entries(amounts)
      .map(([jobId, v]) => ({ jobId, amount: parseFloat(v) || 0 }))
      .filter(a => a.amount > 0);
    if (!entries.length) { Alert.alert('Nothing to allocate', 'Enter an amount against at least one job.'); return; }
    if (isOver)          { Alert.alert('Too much', `The total is more than the ${fmtKES(available)} available.`); return; }
    const tooMuch = entries.find(a => a.amount > (jobs.find(j => j._id === a.jobId)?.outstanding ?? 0) + 0.009);
    if (tooMuch) {
      const j = jobs.find(x => x._id === tooMuch.jobId);
      Alert.alert('Check the amount', `${j?.plateNumber || 'This job'} only owes ${fmtKES(j?.outstanding)}.`);
      return;
    }
    Alert.alert(
      'Allocate payment',
      `Give ${fmtKES(total)} of ${notif.transactionCode || 'this payment'} to ${entries.length} job${entries.length > 1 ? 's' : ''}? Payments will be recorded and customers may get an SMS.`,
      [
        { text: 'Back', style: 'cancel' },
        {
          text: 'Allocate',
          onPress: async () => {
            if (saving) return;
            setSaving(true);
            try {
              const { data } = await api.post(`/carwash/mpesa/notifications/${notif._id}/allocate`, { allocations: entries });
              onDone(data?.message || 'Payment allocated.');
            } catch (err) {
              Alert.alert('Allocation failed', cwError(err, 'Could not allocate the payment.'));
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  const assignTo = (job: UnpaidJob) =>
    Alert.alert(
      'Assign payment',
      `Assign ${notif.transactionCode || 'this payment'} (${fmtKES(notif.amount)}) to ${job.plateNumber || 'this job'}${job.jobNumber ? ` #${job.jobNumber}` : ''}? It records a payment of up to ${fmtKES(job.outstanding)}, what the job still owes.`,
      [
        { text: 'Back', style: 'cancel' },
        {
          text: 'Assign',
          onPress: async () => {
            if (saving) return;
            setSaving(true);
            try {
              await api.patch(`/carwash/mpesa/notifications/${notif._id}/reassign`, { jobId: job._id });
              onDone('Payment assigned.');
            } catch (err) {
              Alert.alert('Could not assign the payment', cwError(err, 'Assigning the payment failed.'));
              setSaving(false);
            }
          },
        },
      ],
    );

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={saving ? undefined : onClose}>
      <SafeAreaView style={styles.modal} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>{mode === 'assign' ? 'Assign to a job' : 'Allocate payment'}</Text>
              <Text style={styles.modalSub}>
                {fmtKES(notif.amount)} · {notif.senderName || 'Unknown'} · {notif.transactionCode || '—'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} disabled={saving} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={24} color="#475569" />
            </TouchableOpacity>
          </View>

          {mode === 'allocate' && (
            <View style={styles.amountStrip}>
              <View style={styles.stripItem}><Text style={styles.stripLabel}>AVAILABLE</Text><Text style={[styles.stripVal, { color: '#047857' }]}>{fmtKES(available)}</Text></View>
              <View style={styles.stripItem}><Text style={styles.stripLabel}>ALLOCATING</Text><Text style={[styles.stripVal, isOver && { color: '#DC2626' }]}>{fmtKES(total)}</Text></View>
              <View style={styles.stripItem}><Text style={styles.stripLabel}>LEFT OVER</Text><Text style={[styles.stripVal, leftover < 0 && { color: '#DC2626' }]}>{fmtKES(Math.abs(leftover))}</Text></View>
            </View>
          )}

          <View style={styles.modalSearch}>
            <Ionicons name="search-outline" size={16} color="#94A3B8" />
            <TextInput
              style={styles.modalSearchInput}
              placeholder="Plate, job # or customer"
              placeholderTextColor="#94A3B8"
              value={search}
              onChangeText={setSearch}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </View>

          {loading ? (
            <View style={styles.centered}><MilikLoader size="small" /></View>
          ) : error ? (
            <ErrorState message={error} onRetry={loadJobs} />
          ) : (
            <FlatList
              data={shown}
              keyExtractor={j => j._id}
              extraData={amounts}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={{ padding: 16, gap: 8 }}
              ListEmptyComponent={
                <View style={styles.centered}>
                  <Text style={styles.emptyText}>{search ? 'No unpaid job matches' : 'No unpaid jobs found'}</Text>
                </View>
              }
              renderItem={({ item: job }) => {
                const match = !!normalizePlate(notif.plate || notif.billRefNumber || '') &&
                  normalizePlate(job.plateNumber || '') === normalizePlate(notif.plate || notif.billRefNumber || '');
                const body = (
                  <>
                    <View style={[styles.platePill, { backgroundColor: match ? '#D1FAE5' : CWL }]}>
                      <Text style={{ fontSize: 13, fontWeight: '900', color: match ? '#065F46' : CW }}>{job.plateNumber || '—'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.jobRowName} numberOfLines={1}>{job.customerName || 'Walk-in'}</Text>
                      <Text style={styles.jobRowSub} numberOfLines={1}>
                        {job.jobNumber ? `#${job.jobNumber}` : ''}{job.serviceName ? ` · ${job.serviceName}` : ''}
                      </Text>
                      <Text style={styles.jobRowOwes}>Owes {fmtKES(job.outstanding)}</Text>
                    </View>
                  </>
                );
                if (mode === 'assign') {
                  return (
                    <TouchableOpacity style={styles.jobRow} onPress={() => assignTo(job)} disabled={saving} activeOpacity={0.8}>
                      {body}
                      <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
                    </TouchableOpacity>
                  );
                }
                return (
                  <View style={styles.jobRow}>
                    {body}
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <TextInput
                        style={styles.amtInput}
                        placeholder="0"
                        placeholderTextColor="#CBD5E1"
                        value={amounts[job._id] ?? ''}
                        onChangeText={t => setAmounts(prev => ({ ...prev, [job._id]: cleanDecimal(t) }))}
                        keyboardType="decimal-pad"
                      />
                      <TouchableOpacity onPress={() => fill(job)}><Text style={styles.fillTxt}>Fill</Text></TouchableOpacity>
                    </View>
                  </View>
                );
              }}
            />
          )}

          {mode === 'allocate' && !loading && !error && (
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.confirmBtn, (saving || total <= 0 || isOver) && { opacity: 0.5 }]}
                onPress={submitAllocations}
                disabled={saving || total <= 0 || isOver}
              >
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.confirmTxt}>Allocate {total > 0 ? fmtKES(total) : ''}</Text>}
              </TouchableOpacity>
            </View>
          )}
          {mode === 'assign' && saving ? (
            <View style={styles.savingBar}><ActivityIndicator color={CW} size="small" /><Text style={styles.savingTxt}>Assigning…</Text></View>
          ) : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Screen ─────────────────────────────────────────────────────────────────────

export default function CarWashMpesaScreen() {
  const [tab,    setTab]    = useState<Tab>('unallocated');
  const [range,  setRange]  = useState<Range>('all');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search.trim(), 400);
  const [target, setTarget] = useState<{ notif: Notification; mode: 'allocate' | 'assign' } | null>(null);

  const status = TABS.find(t => t.key === tab)!.status;
  const params = useMemo(() => ({
    status: status || undefined,
    search: debounced || undefined,
    ...rangeParams(range),
  }), [status, debounced, range]);

  const list = usePmsList<Notification, StatusSummary[]>({ path: '/carwash/mpesa/notifications', params, limit: 30, parse });
  useReloadOnFocus(list.reload);

  const summary = useMemo(() => Object.fromEntries((list.extra ?? []).map(s => [s._id, s])), [list.extra]);

  const renderItem = ({ item }: { item: Notification }) => {
    const meta      = STATUS_META[item.status] ?? STATUS_META.error;
    const left      = remainingOf(item);
    const partial   = Number(item.allocatedAmount) > 0 && left > 0.009 && item.status !== 'matched';
    const multi     = !item.matchedJob && /multi-allocation/i.test(item.notes || '');
    const plateText = item.plate || item.billRefNumber;
    return (
      <View style={[styles.card, { borderLeftColor: item.isReversed ? '#DC2626' : meta.color }]}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.amount}>{fmtKES(item.amount)}</Text>
            <Text style={styles.payerName} numberOfLines={1}>{item.senderName || 'Unknown payer'}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <View style={[styles.badge, { backgroundColor: meta.bg }]}>
              <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label.toUpperCase()}</Text>
            </View>
            {item.isReversed ? (
              <View style={[styles.badge, { backgroundColor: '#FEE2E2' }]}>
                <Text style={[styles.badgeText, { color: '#DC2626' }]}>REVERSED</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.cardRow}>
          <Text style={styles.txCode}>{item.transactionCode || '—'}</Text>
          <Text style={styles.txDate}>{fmtDateTime(item.transactionDate || item.createdAt)}</Text>
        </View>
        <View style={styles.cardRow}>
          <Text style={styles.meta}>{maskPhone(item)}</Text>
          {plateText ? <Text style={styles.billRef}>Ref: {plateText}</Text> : null}
        </View>

        {partial ? (
          <Text style={styles.partial}>{fmtKES(item.allocatedAmount)} allocated · {fmtKES(left)} still to allocate</Text>
        ) : null}
        {item.status !== 'matched' && item.status !== 'unmatched' && item.resultDesc ? (
          <Text style={styles.resultDesc} numberOfLines={2}>{item.resultDesc}</Text>
        ) : null}

        {item.matchedJob ? (
          <View style={styles.allocatedBadge}>
            <Ionicons name="car-outline" size={11} color="#059669" />
            <Text style={styles.allocatedText} numberOfLines={1}>
              {item.matchedJob.plateNumber || item.matchedJob.customerName}{item.matchedJob.jobNumber ? `  ·  #${item.matchedJob.jobNumber}` : ''}
            </Text>
          </View>
        ) : multi ? (
          <View style={styles.allocatedBadge}>
            <Ionicons name="git-branch-outline" size={11} color="#059669" />
            <Text style={styles.allocatedText}>{/Allocated to (\d+) job/i.exec(item.notes || '')?.[0] ?? 'Allocated to several jobs'}</Text>
          </View>
        ) : null}

        {(canAllocate(item) || canAssign(item)) ? (
          <View style={styles.actions}>
            {canAllocate(item) ? (
              <TouchableOpacity style={styles.allocateBtn} onPress={() => setTarget({ notif: item, mode: 'allocate' })}>
                <Ionicons name="git-branch-outline" size={13} color="#6D28D9" />
                <Text style={[styles.allocateBtnText, { color: '#6D28D9' }]}>Allocate</Text>
              </TouchableOpacity>
            ) : null}
            {canAssign(item) ? (
              <TouchableOpacity style={[styles.allocateBtn, { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }]} onPress={() => setTarget({ notif: item, mode: 'assign' })}>
                <Ionicons name="link-outline" size={13} color={ACC} />
                <Text style={[styles.allocateBtnText, { color: ACC }]}>Assign to job</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };

  const unmatched = summary.unmatched;
  const matched   = summary.matched;

  return (
    <>
      <Stack.Screen options={{ title: 'M-Pesa Notifications' }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={18} color="#94A3B8" />
          <TextInput
            style={styles.searchInput}
            placeholder="Code, name, plate or phone"
            placeholderTextColor="#94A3B8"
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="characters"
          />
          {list.loading && !list.refreshing
            ? <ActivityIndicator size="small" color={CW} />
            : search ? <TouchableOpacity onPress={() => setSearch('')} accessibilityLabel="Clear search"><Ionicons name="close-circle" size={18} color="#94A3B8" /></TouchableOpacity>
            : null}
        </View>

        <View style={styles.tabsRow}>
          {TABS.map(t => (
            <TouchableOpacity key={t.key} style={[styles.tab, tab === t.key && styles.tabActive]} onPress={() => setTab(t.key)}>
              <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <FlatList
          horizontal
          data={RANGE_CHIPS}
          keyExtractor={c => c.key}
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={styles.chipsRow}
          renderItem={({ item: c }) => (
            <TouchableOpacity style={[styles.chip, range === c.key && styles.chipActive]} onPress={() => setRange(c.key)}>
              <Text style={[styles.chipText, range === c.key && styles.chipTextActive]}>{c.label}</Text>
            </TouchableOpacity>
          )}
        />

        {(unmatched || matched) ? (
          <View style={styles.summaryStrip}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{unmatched?.count ?? 0}</Text>
              <Text style={styles.summaryLabel}>Unallocated</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{matched?.count ?? 0}</Text>
              <Text style={styles.summaryLabel}>Allocated</Text>
            </View>
          </View>
        ) : null}

        {list.loading ? (
          <MilikLoader fullscreen />
        ) : list.error && list.items.length === 0 ? (
          <ErrorState message={cwMessage(list.error)} onRetry={list.retry} />
        ) : (
          <FlatList
            data={list.items}
            keyExtractor={n => n._id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} tintColor={CW} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.3}
            ListHeaderComponent={list.error ? <ErrorBanner message={cwMessage(list.error)} onRetry={list.refresh} /> : null}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="phone-portrait-outline" size={48} color="#CBD5E1" />
                <Text style={styles.emptyText}>
                  {debounced ? 'No notification matches your search' : tab === 'all' ? 'No M-Pesa notifications' : `No ${tab} payments`}
                </Text>
              </View>
            }
            ListFooterComponent={list.loadingMore ? (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={CW} />
              </View>
            ) : null}
          />
        )}

        {target ? (
          <AllocateModal
            notif={target.notif}
            mode={target.mode}
            onClose={() => setTarget(null)}
            onDone={message => {
              setTarget(null);
              list.reload();
              Alert.alert('Done', message);
            }}
          />
        ) : null}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: '#F8FAFC' },
  modal: { flex: 1, backgroundColor: '#fff' },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 40 },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    margin: 16, marginBottom: 8,
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#E2E8F0',
    paddingHorizontal: 14, height: 48,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#0F172A' },

  tabsRow: { flexDirection: 'row', flexGrow: 0, paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  tab: {
    flex: 1, alignItems: 'center', paddingVertical: 8,
    borderRadius: 10, backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  tabActive:     { backgroundColor: CW, borderColor: CW },
  tabText:       { fontSize: 12, fontWeight: '600', color: '#475569' },
  tabTextActive: { color: '#fff' },

  chipsRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 8 },
  chip: { paddingHorizontal: 13, paddingVertical: 6, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  chipActive:     { backgroundColor: CW, borderColor: CW },
  chipText:       { fontSize: 12, fontWeight: '600', color: '#475569' },
  chipTextActive: { color: '#fff' },

  summaryStrip: {
    flexDirection: 'row', marginHorizontal: 16, marginBottom: 8,
    backgroundColor: '#EEF2FF', borderRadius: 12,
    borderWidth: 1, borderColor: '#C7D2FE', padding: 10,
  },
  summaryItem:   { flex: 1, alignItems: 'center', gap: 2 },
  summaryDivider:{ width: 1, backgroundColor: '#C7D2FE', marginVertical: 4 },
  summaryValue:  { fontSize: 15, fontWeight: '900', color: CW },
  summaryLabel:  { fontSize: 10, color: '#6366F1', fontWeight: '600' },

  list:      { paddingHorizontal: 16, paddingBottom: 40 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyText: { fontSize: 15, color: '#94A3B8', textAlign: 'center' },

  card: {
    backgroundColor: '#fff', borderRadius: 14, gap: 6,
    borderWidth: 1, borderColor: '#E2E8F0',
    borderLeftWidth: 3, padding: 14,
  },
  cardHeader:  { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  badge:       { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText:   { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
  cardRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  txCode:      { fontSize: 12, fontWeight: '800', color: '#475569', letterSpacing: 0.8, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  txDate:      { fontSize: 11, color: '#94A3B8' },
  amount:      { fontSize: 22, fontWeight: '900', color: '#0F172A' },
  payerName:   { fontSize: 13, fontWeight: '600', color: '#475569', marginTop: 1 },
  meta:        { fontSize: 11, color: '#94A3B8', flex: 1 },
  billRef:     { fontSize: 10, color: '#64748B', fontWeight: '700' },
  partial:     { fontSize: 11, fontWeight: '700', color: '#B45309' },
  resultDesc:  { fontSize: 11, color: '#94A3B8', fontStyle: 'italic' },

  allocatedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', marginTop: 4,
    backgroundColor: '#D1FAE5', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  allocatedText: { fontSize: 11, fontWeight: '700', color: '#065F46' },

  actions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  allocateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#F5F3FF',
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1, borderColor: '#DDD6FE',
  },
  allocateBtnText: { fontSize: 12, fontWeight: '700' },

  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  modalSub:   { fontSize: 13, color: '#64748B', marginTop: 2 },

  amountStrip: { flexDirection: 'row', backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', paddingVertical: 10, paddingHorizontal: 16 },
  stripItem:   { flex: 1, gap: 2 },
  stripLabel:  { fontSize: 9, fontWeight: '800', letterSpacing: 0.8, color: '#94A3B8' },
  stripVal:    { fontSize: 14, fontWeight: '900', color: '#0F172A' },

  modalSearch: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 12,
    backgroundColor: '#F8FAFC', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0',
    paddingHorizontal: 12, height: 40,
  },
  modalSearchInput: { flex: 1, fontSize: 14, color: '#0F172A' },

  jobRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 12,
    borderWidth: 1, borderColor: '#E2E8F0', padding: 12,
  },
  platePill:  { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  jobRowName: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  jobRowSub:  { fontSize: 11, color: '#94A3B8' },
  jobRowOwes: { fontSize: 11, fontWeight: '700', color: '#DC2626', marginTop: 1 },
  amtInput:   { minWidth: 84, textAlign: 'right', backgroundColor: '#F8FAFC', borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 8, paddingVertical: 6, fontSize: 14, fontWeight: '700', color: '#0F172A' },
  fillTxt:    { fontSize: 11, fontWeight: '800', color: CW },

  modalFooter: { padding: 16, borderTopWidth: 1, borderTopColor: '#E2E8F0', backgroundColor: '#fff' },
  confirmBtn:  { backgroundColor: '#065F46', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  confirmTxt:  { fontSize: 15, fontWeight: '800', color: '#fff' },
  savingBar:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderTopWidth: 1, borderTopColor: '#E2E8F0' },
  savingTxt:   { fontSize: 13, color: '#64748B' },
});
