import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const AC  = '#064E3B';
const ACL = '#ECFDF5';

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type JournalLine = {
  _id?: string;
  account?: { _id: string; name: string; code?: string } | string;
  description?: string;
  debit:  number;
  credit: number;
};

type Journal = {
  _id: string;
  reference?: string;
  narration: string;
  date: string;
  status: string;
  totalDebit: number;
  totalCredit: number;
  createdAt: string;
  createdBy?: { name?: string };
  approvedBy?: { name?: string };
  lines?: JournalLine[];
  reversalOf?: string;
};

const STATUS_CFG: Record<string, { bg: string; color: string; label: string }> = {
  draft:           { bg: '#F1F5F9', color: '#64748B', label: 'Draft'          },
  pending_review:  { bg: '#FEF3C7', color: '#D97706', label: 'Pending Review' },
  reviewed:        { bg: '#DBEAFE', color: '#1D4ED8', label: 'Reviewed'       },
  approved:        { bg: '#EDE9FE', color: '#7C3AED', label: 'Approved'       },
  posted:          { bg: '#D1FAE5', color: '#065F46', label: 'Posted'         },
  reversed:        { bg: '#FEE2E2', color: '#DC2626', label: 'Reversed'       },
};

type Action = { label: string; icon: string; endpoint: string; color: string; body?: object; confirm?: string };

function getActions(status: string): Action[] {
  switch (status) {
    case 'draft':          return [
      { label: 'Submit for Review', icon: 'send-outline',     endpoint: 'submit',  color: '#D97706', confirm: 'Submit this journal for review?' },
      { label: 'Post Directly',     icon: 'checkmark-circle-outline', endpoint: 'post', color: AC, confirm: 'Post this journal directly to the ledger?' },
    ];
    case 'pending_review': return [
      { label: 'Approve',  icon: 'checkmark-circle-outline', endpoint: 'approve', color: AC        },
      { label: 'Reject',   icon: 'close-circle-outline',     endpoint: 'reject',  color: '#DC2626', confirm: 'Reject this journal?' },
    ];
    case 'reviewed':       return [
      { label: 'Approve',  icon: 'checkmark-circle-outline', endpoint: 'approve', color: AC         },
    ];
    case 'approved':       return [
      { label: 'Post to Ledger', icon: 'layers-outline', endpoint: 'post', color: AC, confirm: 'Post this journal to the ledger?' },
    ];
    case 'posted':         return [
      { label: 'Reverse', icon: 'refresh-outline', endpoint: 'reverse', color: '#DC2626', confirm: 'Create a reversal entry for this journal?' },
    ];
    default: return [];
  }
}

export default function JournalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [journal,    setJournal]    = useState<Journal | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting,     setActing]     = useState(false);

  const load = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const { data } = await api.get(`/journals/${id}`);
      setJournal(data?.data ?? data);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { load(); }, [id]);

  const doAction = (action: Action) => {
    const proceed = async () => {
      setActing(true);
      try {
        await api.post(`/journals/${id}/${action.endpoint}`, action.body ?? {});
        await load(true);
      } catch (err: any) {
        Alert.alert('Error', err?.response?.data?.message ?? 'Action failed.');
      } finally { setActing(false); }
    };
    if (action.confirm) {
      Alert.alert('Confirm', action.confirm, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: proceed },
      ]);
    } else proceed();
  };

  if (loading) return <MilikLoader fullscreen />;
  if (!journal) return (
    <>
      <Stack.Screen options={{ title: 'Journal Entry' }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color="#CBD5E1" />
          <Text style={styles.emptyTxt}>Not found</Text>
        </View>
      </SafeAreaView>
    </>
  );

  const sc      = STATUS_CFG[journal.status] ?? STATUS_CFG.draft;
  const actions = getActions(journal.status);
  const lines   = journal.lines ?? [];

  return (
    <>
      <Stack.Screen options={{ title: journal.reference ? `JV · ${journal.reference}` : 'Journal Entry' }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={AC} />}
          showsVerticalScrollIndicator={false}
        >
          {/* Header card */}
          <View style={styles.heroCard}>
            <View style={styles.heroTop}>
              <View style={{ flex: 1 }}>
                {journal.reference ? <Text style={styles.refTxt}>{journal.reference}</Text> : null}
                <Text style={styles.narration}>{journal.narration}</Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: sc.bg }]}>
                <Text style={[styles.statusTxt, { color: sc.color }]}>{sc.label}</Text>
              </View>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroMeta}>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>DATE</Text>
                <Text style={styles.metaValue}>{fmtDate(journal.date)}</Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>BY</Text>
                <Text style={styles.metaValue}>{journal.createdBy?.name ?? '—'}</Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>AMOUNT</Text>
                <Text style={[styles.metaValue, { color: AC, fontWeight: '900' }]}>{fmt(journal.totalDebit)}</Text>
              </View>
            </View>
          </View>

          {/* Lines */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>JOURNAL LINES ({lines.length})</Text>
            <View style={styles.linesHead}>
              <Text style={[styles.colHdr, { flex: 2 }]}>Account</Text>
              <Text style={[styles.colHdr, { width: 90, textAlign: 'right' }]}>Debit</Text>
              <Text style={[styles.colHdr, { width: 90, textAlign: 'right' }]}>Credit</Text>
            </View>
            {lines.map((line, i) => {
              const acct = typeof line.account === 'object' ? line.account : null;
              return (
                <View key={line._id ?? i} style={[styles.lineRow, i === lines.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={{ flex: 2 }}>
                    <Text style={styles.acctName} numberOfLines={1}>{acct?.name ?? '—'}</Text>
                    {acct?.code ? <Text style={styles.acctCode}>{acct.code}</Text> : null}
                    {line.description ? <Text style={styles.lineDesc} numberOfLines={1}>{line.description}</Text> : null}
                  </View>
                  <Text style={[styles.drAmt, { width: 90 }]}>
                    {line.debit > 0 ? fmt(line.debit) : ''}
                  </Text>
                  <Text style={[styles.crAmt, { width: 90 }]}>
                    {line.credit > 0 ? fmt(line.credit) : ''}
                  </Text>
                </View>
              );
            })}
            {/* Totals */}
            <View style={styles.totalsRow}>
              <Text style={[styles.colHdr, { flex: 2 }]}>TOTAL</Text>
              <Text style={[styles.drTotal, { width: 90 }]}>{fmt(journal.totalDebit)}</Text>
              <Text style={[styles.crTotal, { width: 90 }]}>{fmt(journal.totalCredit)}</Text>
            </View>
          </View>

          {/* Actions */}
          {actions.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>ACTIONS</Text>
              {acting ? (
                <ActivityIndicator color={AC} style={{ paddingVertical: 16 }} />
              ) : (
                <View style={styles.actionsRow}>
                  {actions.map(a => (
                    <TouchableOpacity
                      key={a.label}
                      style={[styles.actionBtn, { borderColor: a.color }]}
                      onPress={() => doAction(a)}
                    >
                      <Ionicons name={a.icon as any} size={18} color={a.color} />
                      <Text style={[styles.actionBtnTxt, { color: a.color }]}>{a.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: '#F0FDF4' },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8' },
  scroll:    { padding: 16, gap: 12, paddingBottom: 48 },

  heroCard:   { backgroundColor: AC, borderRadius: 18, padding: 16, gap: 12 },
  heroTop:    { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  refTxt:     { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.55)', letterSpacing: 0.5, marginBottom: 2 },
  narration:  { fontSize: 16, fontWeight: '700', color: '#fff' },
  statusPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  statusTxt:  { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  heroDivider:{ height: 1, backgroundColor: 'rgba(255,255,255,0.1)' },
  heroMeta:   { flexDirection: 'row' },
  metaItem:   { flex: 1, gap: 3 },
  metaLabel:  { fontSize: 9, color: 'rgba(255,255,255,0.5)', fontWeight: '700', letterSpacing: 0.6 },
  metaValue:  { fontSize: 13, color: '#fff', fontWeight: '600' },

  card:       { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 14 },
  cardTitle:  { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: '#94A3B8', marginBottom: 10 },

  linesHead:  { flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  colHdr:     { fontSize: 9, fontWeight: '800', color: '#94A3B8', letterSpacing: 0.6 },
  lineRow:    { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F8FAFC', gap: 4 },
  acctName:   { fontSize: 13, fontWeight: '600', color: '#0F172A' },
  acctCode:   { fontSize: 10, color: '#94A3B8', marginTop: 1 },
  lineDesc:   { fontSize: 11, color: '#64748B', marginTop: 2 },
  drAmt:      { fontSize: 12, fontWeight: '700', color: '#1D4ED8', textAlign: 'right' },
  crAmt:      { fontSize: 12, fontWeight: '700', color: '#7C3AED', textAlign: 'right' },
  totalsRow:  { flexDirection: 'row', paddingTop: 10, marginTop: 4, borderTopWidth: 1.5, borderTopColor: '#E2E8F0' },
  drTotal:    { fontSize: 13, fontWeight: '900', color: '#1D4ED8', textAlign: 'right' },
  crTotal:    { fontSize: 13, fontWeight: '900', color: '#7C3AED', textAlign: 'right' },

  actionsRow: { gap: 10 },
  actionBtn:  {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 12, paddingVertical: 13, borderWidth: 1.5, backgroundColor: '#fff',
  },
  actionBtnTxt: { fontSize: 14, fontWeight: '700' },
});
