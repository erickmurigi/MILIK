import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, ScrollView, TextInput, TouchableOpacity, Modal,
  ActivityIndicator, RefreshControl, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { ErrorBanner, ErrorState } from '../../../../components/ui/PmsStates';
import { useDebounced, usePmsList, useReloadOnFocus } from '../../../../hooks/usePmsList';
import { fmtDate } from '../../../../utils/pmsFormat';
import { HC, LEAVE_STATUSES, applicationsOf, hrError, personName, type LeaveApp } from '../../../../utils/hr';

const STATUS_CFG: Record<string, { bg: string; color: string }> = {
  Pending:   { bg: '#FEF3C7', color: '#D97706' },
  Approved:  { bg: '#D1FAE5', color: '#065F46' },
  Rejected:  { bg: '#FEE2E2', color: '#DC2626' },
  Cancelled: { bg: '#F1F5F9', color: '#64748B' },
  Draft:     { bg: '#E0E7FF', color: '#4F46E5' },
};

type Action = 'approve' | 'reject' | 'cancel';
type Target = { app: LeaveApp; action: Action } | null;

const VERB: Record<Action, { title: string; done: string; ok: string; danger: boolean }> = {
  approve: { title: 'Approve leave',   done: 'approved',  ok: 'Approve',      danger: false },
  reject:  { title: 'Reject leave',    done: 'rejected',  ok: 'Reject',       danger: true  },
  cancel:  { title: 'Cancel leave',    done: 'cancelled', ok: 'Cancel leave', danger: true  },
};

const parse = (data: any) => applicationsOf(data);

export default function LeaveScreen() {
  const router = useRouter();

  const [statusFilter, setStatusFilter] = useState<string>('Pending');
  const [search,       setSearch]       = useState('');
  const debouncedSearch = useDebounced(search.trim(), 400);
  const [acting, setActing] = useState<string | null>(null);
  const [target, setTarget] = useState<Target>(null);
  const [reason, setReason] = useState('');

  const listParams = useMemo(() => ({
    status: statusFilter || undefined,
    search: debouncedSearch || undefined,
  }), [statusFilter, debouncedSearch]);

  const list = usePmsList<LeaveApp>({ path: '/hr/leave-applications', params: listParams, limit: 30, parse });
  // a request submitted on the New screen (or handled elsewhere) shows up when we come back
  useReloadOnFocus(useCallback(() => { list.reload(); }, [list.reload]));

  const ask = (app: LeaveApp, action: Action) => {
    if (acting) return;
    const who = `${personName(app.employee)}'s ${typeof app.leaveType === 'object' ? app.leaveType?.name ?? 'leave' : 'leave'} (${app.days} day${app.days !== 1 ? 's' : ''})`;
    if (action === 'approve') {
      Alert.alert('Approve leave', `Approve ${who}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Approve', onPress: () => run(app, 'approve', '') },
      ]);
      return;
    }
    setReason('');
    setTarget({ app, action });   // reject / cancel ask for an optional reason first
  };

  const run = async (app: LeaveApp, action: Action, note: string) => {
    if (acting) return;
    setActing(app._id);
    try {
      const body =
        action === 'approve' ? (note ? { notes: note } : {}) : (note ? { reason: note } : {});
      await api.patch(`/hr/leave-applications/${app._id}/${action}`, body);
      setTarget(null);
      list.reload();
    } catch (err) {
      setTarget(null);
      Alert.alert('Could not update', hrError(err, `Failed to ${action} this application.`));
      list.reload();   // it may already have been handled by someone else
    } finally { setActing(null); }
  };

  const renderItem = ({ item }: { item: LeaveApp }) => {
    const sc      = STATUS_CFG[item.status] ?? STATUS_CFG.Pending;
    const type    = typeof item.leaveType === 'object' ? item.leaveType : null;
    const empNo   = typeof item.employee === 'object' ? item.employee?.employeeNumber : '';
    const busy    = acting === item._id;
    const note    = item.status === 'Rejected' ? item.rejectionReason
                  : item.status === 'Cancelled' ? item.cancelReason
                  : item.status === 'Approved' ? item.approvalNotes : '';

    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.empName} numberOfLines={1}>{personName(item.employee)}</Text>
            <Text style={styles.leaveType}>
              {type?.name ?? '—'}{type?.isPaid === false ? ' · Unpaid' : ''}{empNo ? `  ·  ${empNo}` : ''}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{item.status}</Text>
            </View>
            <View style={styles.daysBadge}>
              <Text style={styles.daysTxt}>{item.days} day{item.days !== 1 ? 's' : ''}</Text>
            </View>
          </View>
        </View>

        <View style={styles.dateRow}>
          <Ionicons name="calendar-outline" size={12} color="#94A3B8" />
          <Text style={styles.dateTxt}>{fmtDate(item.startDate)} → {fmtDate(item.endDate)}</Text>
        </View>
        {item.createdAt ? <Text style={styles.applied}>Applied {fmtDate(item.createdAt)}</Text> : null}

        {item.reason ? <Text style={styles.reason} numberOfLines={3}>{item.reason}</Text> : null}
        {note ? <Text style={styles.note}>{item.status === 'Rejected' ? 'Rejected: ' : item.status === 'Cancelled' ? 'Cancelled: ' : 'Note: '}{note}</Text> : null}

        {item.status === 'Pending' || item.status === 'Approved' ? (
          <View style={styles.actions}>
            {busy ? (
              <ActivityIndicator color={HC} />
            ) : (
              <>
                {item.status === 'Pending' ? (
                  <>
                    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#FEE2E2' }]} onPress={() => ask(item, 'reject')} disabled={!!acting}>
                      <Ionicons name="close-outline" size={15} color="#DC2626" />
                      <Text style={[styles.actionTxt, { color: '#DC2626' }]}>Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#D1FAE5' }]} onPress={() => ask(item, 'approve')} disabled={!!acting}>
                      <Ionicons name="checkmark-outline" size={15} color="#065F46" />
                      <Text style={[styles.actionTxt, { color: '#065F46' }]}>Approve</Text>
                    </TouchableOpacity>
                  </>
                ) : null}
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#F1F5F9' }]} onPress={() => ask(item, 'cancel')} disabled={!!acting}>
                  <Ionicons name="ban-outline" size={14} color="#475569" />
                  <Text style={[styles.actionTxt, { color: '#475569' }]}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : null}
      </View>
    );
  };

  const filtered = !!(statusFilter || debouncedSearch);
  const v = target ? VERB[target.action] : null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color="#94A3B8" />
        <TextInput
          style={styles.searchInput}
          placeholder="Employee name, number, department..."
          placeholderTextColor="#94A3B8"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          autoCorrect={false}
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color="#94A3B8" />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={{ flexGrow: 0 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow} keyboardShouldPersistTaps="handled">
          {[{ key: '', label: 'All' }, ...LEAVE_STATUSES.map(s => ({ key: s as string, label: s as string }))].map(t => (
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
            keyExtractor={l => l._id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} tintColor={HC} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.3}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="calendar-outline" size={48} color="#CBD5E1" />
                <Text style={styles.emptyTxt}>
                  {debouncedSearch ? 'No leave applications match your search'
                    : statusFilter === 'Pending' ? 'No pending leave requests'
                    : filtered ? `No ${statusFilter.toLowerCase()} leave applications` : 'No leave applications yet'}
                </Text>
              </View>
            }
            ListFooterComponent={list.loadingMore ? <ActivityIndicator color={HC} style={{ padding: 20 }} /> : null}
          />
        </>
      )}

      <TouchableOpacity style={styles.fab} onPress={() => router.push('/hr/leave/new' as any)} activeOpacity={0.85}>
        <Ionicons name="add" size={26} color="#fff" />
      </TouchableOpacity>

      {/* reason prompt for reject / cancel (Alert.prompt is iOS-only) */}
      <Modal visible={!!target} transparent animationType="fade" onRequestClose={() => setTarget(null)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>{v?.title}</Text>
            {target ? (
              <Text style={styles.dialogSub}>
                {personName(target.app.employee)} · {fmtDate(target.app.startDate)} → {fmtDate(target.app.endDate)}
              </Text>
            ) : null}
            <TextInput
              style={styles.dialogInput}
              value={reason}
              onChangeText={setReason}
              placeholder="Reason (optional)"
              placeholderTextColor="#94A3B8"
              multiline
              textAlignVertical="top"
              maxLength={300}
            />
            <View style={styles.dialogBtns}>
              <TouchableOpacity style={[styles.dialogBtn, { backgroundColor: '#F1F5F9' }]} onPress={() => setTarget(null)} disabled={!!acting}>
                <Text style={[styles.dialogBtnTxt, { color: '#475569' }]}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dialogBtn, { backgroundColor: v?.danger ? '#DC2626' : HC }, !!acting && { opacity: 0.6 }]}
                onPress={() => target && run(target.app, target.action, reason.trim())}
                disabled={!!acting}
              >
                {acting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={[styles.dialogBtnTxt, { color: '#fff' }]}>{v?.ok}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F3FF' },

  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, margin: 16, marginBottom: 8, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 14, height: 50 },
  searchInput: { flex: 1, fontSize: 15, color: '#0F172A' },
  tabsRow: { paddingHorizontal: 16, paddingBottom: 10, gap: 8, alignItems: 'center' },
  tab:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  tabActive:   { backgroundColor: HC, borderColor: HC },
  tabTxt:      { fontSize: 12, fontWeight: '600', color: '#475569' },
  tabTxtActive:{ color: '#fff' },

  list:      { paddingHorizontal: 16, paddingBottom: 100 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60, paddingHorizontal: 24 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8', textAlign: 'center' },

  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, gap: 8 },
  cardTop:   { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  empName:   { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  leaveType: { fontSize: 12, color: '#64748B', marginTop: 2, fontWeight: '500' },
  badge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt:  { fontSize: 10, fontWeight: '800' },
  daysBadge: { backgroundColor: HC + '15', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  daysTxt:   { fontSize: 11, fontWeight: '700', color: HC },

  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dateTxt: { fontSize: 12, color: '#64748B' },
  applied: { fontSize: 10, color: '#94A3B8' },
  reason:  { fontSize: 12, color: '#475569', lineHeight: 18 },
  note:    { fontSize: 12, color: '#64748B', fontStyle: 'italic', lineHeight: 18 },

  actions: { flexDirection: 'row', gap: 8, marginTop: 4, alignItems: 'center', justifyContent: 'flex-end' },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 10, paddingVertical: 9 },
  actionTxt: { fontSize: 13, fontWeight: '700' },
  fab: { position: 'absolute', bottom: 28, right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: HC, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 8 },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: '#fff', borderRadius: 18, padding: 18, gap: 10 },
  dialogTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  dialogSub:   { fontSize: 12, color: '#64748B' },
  dialogInput: { minHeight: 80, borderRadius: 10, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#0F172A' },
  dialogBtns:  { flexDirection: 'row', gap: 10, marginTop: 4 },
  dialogBtn:   { flex: 1, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dialogBtnTxt:{ fontSize: 14, fontWeight: '800' },
});
