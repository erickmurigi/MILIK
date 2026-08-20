import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert, Modal, TextInput, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const AC  = '#064E3B';
const ACL = '#ECFDF5';

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type PettyCashAccount = {
  _id:        string;
  name:       string;
  balance:    number;
  floatLimit: number;
  custodian?: { name?: string };
  isActive:   boolean;
};

type Disbursement = {
  _id:              string;
  description:      string;
  amount:           number;
  date:             string;
  status:           string; // 'active' | 'void'
  voucherNumber?:   string;
  pettyCashAccount?:{ name?: string; voucherPrefix?: string };
  property?:        { propertyName?: string };
  payee?:           string;
};

type DisbFilter = 'all' | 'active' | 'void';
type Period     = '1M'  | '3M'  | '6M'  | '1Y' | 'All';

const TABS = [{ key: 'accounts', label: 'Accounts' }, { key: 'disbursements', label: 'Disbursements' }] as const;
type Tab = typeof TABS[number]['key'];

const DISB_FILTER_TABS: { key: DisbFilter; label: string }[] = [
  { key: 'all',    label: 'All'    },
  { key: 'active', label: 'Active' },
  { key: 'void',   label: 'Voided' },
];

const PERIOD_TABS: { key: Period; label: string }[] = [
  { key: '1M',  label: '1 Mo'    },
  { key: '3M',  label: '3 Mo'    },
  { key: '6M',  label: '6 Mo'    },
  { key: '1Y',  label: 'This Yr' },
  { key: 'All', label: 'All'     },
];

const getPeriodDates = (p: Period): { startDate?: string; endDate?: string } => {
  if (p === 'All') return {};
  const today = new Date();
  const endDate = today.toISOString().slice(0, 10);
  let from: Date;
  if      (p === '1M') from = new Date(today.getFullYear(), today.getMonth(),     1);
  else if (p === '3M') from = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  else if (p === '6M') from = new Date(today.getFullYear(), today.getMonth() - 5, 1);
  else                 from = new Date(today.getFullYear(), 0, 1);
  return { startDate: from.toISOString().slice(0, 10), endDate };
};

export default function PettyCashScreen() {
  const [tab,           setTab]           = useState<Tab>('accounts');
  const [accounts,      setAccounts]      = useState<PettyCashAccount[]>([]);
  const [disbursements, setDisbursements] = useState<Disbursement[]>([]);
  const [acctLoading,   setAcctLoading]   = useState(true);
  const [disbLoading,   setDisbLoading]   = useState(false);
  const [refreshing,    setRefreshing]    = useState(false);
  const [disbFilter,    setDisbFilter]    = useState<DisbFilter>('all');
  const [period,        setPeriod]        = useState<Period>('3M');

  // New disbursement modal
  const [showDisbModal, setShowDisbModal] = useState(false);
  const [dAccount,      setDAccount]      = useState('');
  const [dDesc,         setDDesc]         = useState('');
  const [dAmount,       setDAmount]       = useState('');
  const [dDate,         setDDate]         = useState(todayStr());
  const [dPayee,        setDPayee]        = useState('');
  const [saving,        setSaving]        = useState(false);

  const loadAccounts = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setAcctLoading(true);
    try {
      const res = await api.get('/petty-cash/accounts');
      const raw = res.data?.data ?? res.data;
      setAccounts(Array.isArray(raw) ? raw : (raw?.accounts ?? []));
    } catch {
      Alert.alert('Error', 'Failed to load petty cash accounts.');
    }
    finally { setAcctLoading(false); setRefreshing(false); }
  }, []);

  const loadDisbursements = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setDisbLoading(true);
    try {
      const params: Record<string, string> = { limit: '50' };
      if (disbFilter !== 'all') params.status = disbFilter;
      const { startDate, endDate } = getPeriodDates(period);
      if (startDate) params.startDate = startDate;
      if (endDate)   params.endDate   = endDate;

      const res = await api.get('/petty-cash/disbursements', { params });
      const raw = res.data?.data ?? res.data;
      setDisbursements(Array.isArray(raw) ? raw : (raw?.disbursements ?? []));
    } catch {
      Alert.alert('Error', 'Failed to load disbursements.');
    }
    finally { setDisbLoading(false); setRefreshing(false); }
  }, [disbFilter, period]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { loadDisbursements(); }, [loadDisbursements]);

  const handleRefresh = () => {
    if (tab === 'accounts') loadAccounts(true);
    else                    loadDisbursements(true);
  };

  const handleDisburse = async () => {
    if (!dAccount)        { Alert.alert('Required', 'Select an account.');       return; }
    if (!dDesc.trim())    { Alert.alert('Required', 'Enter a description.');      return; }
    if (!parseFloat(dAmount) || parseFloat(dAmount) <= 0) { Alert.alert('Required', 'Enter a valid amount.'); return; }
    setSaving(true);
    try {
      await api.post('/petty-cash/disbursements', {
        account:     dAccount,
        description: dDesc.trim(),
        amount:      parseFloat(dAmount),
        date:        dDate,
        payee:       dPayee.trim() || undefined,
      });
      setShowDisbModal(false);
      setDDesc(''); setDAmount(''); setDPayee('');
      loadAccounts(true);
      loadDisbursements(true);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed.');
    } finally { setSaving(false); }
  };

  const voidDisb = (id: string, desc: string) => {
    Alert.alert('Void Disbursement', `Void "${desc}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Void', style: 'destructive',
        onPress: async () => {
          try { await api.put(`/petty-cash/disbursements/${id}/void`); loadDisbursements(true); loadAccounts(true); }
          catch (err: any) { Alert.alert('Error', err?.response?.data?.message ?? 'Failed.'); }
        },
      },
    ]);
  };

  if (acctLoading && tab === 'accounts') return <MilikLoader fullscreen />;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* View switcher tabs */}
      <View style={styles.tabsRow}>
        {TABS.map(t => (
          <TouchableOpacity key={t.key} style={[styles.tab, tab === t.key && styles.tabActive]} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabTxt, tab === t.key && styles.tabTxtActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Disbursement filters — only visible on disbursements tab */}
      {tab === 'disbursements' && (
        <>
          <FlatList
            horizontal
            data={DISB_FILTER_TABS}
            keyExtractor={t => t.key}
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={styles.filterRow}
            renderItem={({ item: t }) => (
              <TouchableOpacity
                style={[styles.filterChip, disbFilter === t.key && styles.filterChipActive,
                  t.key === 'void' && disbFilter !== 'void' && styles.filterChipVoid]}
                onPress={() => setDisbFilter(t.key)}
              >
                <Text style={[styles.filterChipTxt, disbFilter === t.key && styles.filterChipTxtActive,
                  t.key === 'void' && disbFilter !== 'void' && styles.filterChipVoidTxt]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            )}
          />
          <View style={styles.periodRow}>
            <Ionicons name="calendar-outline" size={13} color="#94A3B8" style={{ marginRight: 2 }} />
            {PERIOD_TABS.map(pt => (
              <TouchableOpacity
                key={pt.key}
                style={[styles.periodChip, period === pt.key && styles.periodChipActive]}
                onPress={() => setPeriod(pt.key)}
              >
                <Text style={[styles.periodText, period === pt.key && styles.periodTextActive]}>{pt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {tab === 'accounts' ? (
        <FlatList
          data={accounts}
          keyExtractor={a => a._id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={AC} />}
          ListEmptyComponent={<View style={styles.emptyWrap}><Ionicons name="wallet-outline" size={48} color="#CBD5E1" /><Text style={styles.emptyTxt}>No petty cash accounts</Text></View>}
          renderItem={({ item: acct }) => {
            const usedPct = acct.floatLimit > 0 ? Math.min(1, (acct.floatLimit - acct.balance) / acct.floatLimit) : 0;
            const isLow   = acct.balance < acct.floatLimit * 0.2;
            return (
              <View style={styles.acctCard}>
                <View style={styles.acctTop}>
                  <View>
                    <Text style={styles.acctName}>{acct.name}</Text>
                    {acct.custodian?.name ? (
                      <View style={styles.custodianRow}>
                        <Ionicons name="person-outline" size={11} color="#94A3B8" />
                        <Text style={styles.custodianTxt}>{acct.custodian.name}</Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.balance, { color: isLow ? '#DC2626' : AC }]}>{fmt(acct.balance)}</Text>
                    <Text style={styles.floatTxt}>float: {fmt(acct.floatLimit)}</Text>
                  </View>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${Math.max(0, (1 - usedPct)) * 100}%` as any, backgroundColor: isLow ? '#DC2626' : AC }]} />
                </View>
                <TouchableOpacity
                  style={styles.disbBtn}
                  onPress={() => { setDAccount(acct._id); setShowDisbModal(true); }}
                >
                  <Ionicons name="remove-circle-outline" size={14} color={AC} />
                  <Text style={styles.disbBtnTxt}>Record Disbursement</Text>
                </TouchableOpacity>
              </View>
            );
          }}
        />
      ) : (
        disbLoading ? <MilikLoader fullscreen /> : (
          <FlatList
            data={disbursements}
            keyExtractor={d => d._id}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={AC} />}
            ListEmptyComponent={<View style={styles.emptyWrap}><Ionicons name="cash-outline" size={48} color="#CBD5E1" /><Text style={styles.emptyTxt}>No disbursements</Text></View>}
            renderItem={({ item: disb }) => {
              const isVoid = disb.status === 'void';
              return (
                <View style={[styles.disbCard, isVoid && { opacity: 0.55, borderStyle: 'dashed' }]}>
                  <View style={styles.disbTop}>
                    <View style={{ flex: 1 }}>
                      {disb.voucherNumber ? <Text style={styles.disbVoucherNo}>{disb.voucherNumber}</Text> : null}
                      <Text style={styles.disbDesc} numberOfLines={2}>{disb.description}</Text>
                      {disb.payee ? <Text style={styles.disbMeta}>Payee: {disb.payee}</Text> : null}
                      {disb.pettyCashAccount?.name ? <Text style={styles.disbMeta}>{disb.pettyCashAccount.name}</Text> : null}
                      {disb.property?.propertyName ? <Text style={styles.disbMeta}>{disb.property.propertyName}</Text> : null}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text style={styles.disbAmt}>{fmt(disb.amount)}</Text>
                      {isVoid ? (
                        <View style={styles.voidBadge}><Text style={styles.voidBadgeTxt}>VOIDED</Text></View>
                      ) : (
                        <TouchableOpacity onPress={() => voidDisb(disb._id, disb.description)}>
                          <Ionicons name="close-circle-outline" size={18} color="#DC2626" />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                  <Text style={styles.disbDate}>{fmtDate(disb.date)}</Text>
                </View>
              );
            }}
          />
        )
      )}

      <TouchableOpacity style={styles.fab} onPress={() => { setDAccount(accounts[0]?._id ?? ''); setShowDisbModal(true); }}>
        <Ionicons name="add" size={26} color="#fff" />
      </TouchableOpacity>

      {/* Disburse modal */}
      <Modal visible={showDisbModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowDisbModal(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Record Disbursement</Text>
            <TouchableOpacity onPress={() => setShowDisbModal(false)}>
              <Ionicons name="close" size={24} color="#475569" />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
            {accounts.length > 1 && (
              <View style={{ gap: 6 }}>
                <Text style={styles.label}>Account</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {accounts.map(a => (
                    <TouchableOpacity key={a._id} style={[styles.acctChip, dAccount === a._id && styles.acctChipActive]} onPress={() => setDAccount(a._id)}>
                      <Text style={[styles.acctChipTxt, dAccount === a._id && { color: '#fff' }]}>{a.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
            <View style={{ gap: 6 }}>
              <Text style={styles.label}>Date</Text>
              <TextInput style={styles.modalInput} value={dDate} onChangeText={setDDate} />
            </View>
            <View style={{ gap: 6 }}>
              <Text style={styles.label}>Description <Text style={{ color: '#DC2626' }}>*</Text></Text>
              <TextInput style={[styles.modalInput, { minHeight: 72, textAlignVertical: 'top', paddingTop: 11 }]} value={dDesc} onChangeText={setDDesc} placeholder="What was purchased..." placeholderTextColor="#94A3B8" multiline />
            </View>
            <View style={{ gap: 6 }}>
              <Text style={styles.label}>Payee (Optional)</Text>
              <TextInput style={styles.modalInput} value={dPayee} onChangeText={setDPayee} placeholder="Who was paid" placeholderTextColor="#94A3B8" />
            </View>
            <View style={{ gap: 6 }}>
              <Text style={styles.label}>Amount (KES) <Text style={{ color: '#DC2626' }}>*</Text></Text>
              <TextInput style={[styles.modalInput, { fontSize: 22, fontWeight: '800', color: AC }]} value={dAmount} onChangeText={setDAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#CBD5E1" selectTextOnFocus />
            </View>
            <TouchableOpacity style={[styles.submitBtn, saving && { opacity: 0.6 }]} onPress={handleDisburse} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : (
                <><Ionicons name="cash-outline" size={18} color="#fff" /><Text style={styles.submitTxt}>Record Disbursement</Text></>
              )}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F0FDF4' },

  tabsRow:      { flexDirection: 'row', flexGrow: 0, padding: 16, paddingBottom: 10, gap: 8 },
  tab:          { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  tabActive:    { backgroundColor: AC, borderColor: AC },
  tabTxt:       { fontSize: 13, fontWeight: '600', color: '#475569' },
  tabTxtActive: { color: '#fff' },

  filterRow:        { paddingHorizontal: 16, paddingBottom: 8, gap: 7 },
  filterChip:       { paddingHorizontal: 13, paddingVertical: 6, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  filterChipActive: { backgroundColor: AC, borderColor: AC },
  filterChipVoid:   { borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
  filterChipTxt:    { fontSize: 12, fontWeight: '600', color: '#475569' },
  filterChipTxtActive: { color: '#fff' },
  filterChipVoidTxt: { color: '#94A3B8' },

  periodRow:        { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 16, paddingBottom: 10 },
  periodChip:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  periodChipActive: { backgroundColor: ACL, borderColor: AC },
  periodText:       { fontSize: 11, fontWeight: '600', color: '#94A3B8' },
  periodTextActive: { color: AC, fontWeight: '700' },

  list:      { paddingHorizontal: 16, paddingBottom: 100 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8' },

  acctCard:    { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', padding: 16, gap: 10 },
  acctTop:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  acctName:    { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  custodianRow:{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  custodianTxt:{ fontSize: 11, color: '#94A3B8' },
  balance:     { fontSize: 22, fontWeight: '900' },
  floatTxt:    { fontSize: 11, color: '#94A3B8' },
  barTrack:    { height: 6, backgroundColor: '#F1F5F9', borderRadius: 3, overflow: 'hidden' },
  barFill:     { height: 6, borderRadius: 3 },
  disbBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: ACL, borderRadius: 10, paddingVertical: 10, borderWidth: 1, borderColor: '#6EE7B7' },
  disbBtnTxt:  { fontSize: 13, fontWeight: '700', color: AC },

  disbCard:      { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, gap: 6 },
  disbTop:       { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  disbVoucherNo: { fontSize: 10, fontWeight: '700', color: '#94A3B8', letterSpacing: 0.5, marginBottom: 2 },
  disbDesc:      { fontSize: 14, fontWeight: '600', color: '#0F172A' },
  disbMeta:      { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  disbAmt:       { fontSize: 15, fontWeight: '900', color: '#0F172A' },
  disbDate:      { fontSize: 11, color: '#94A3B8' },
  voidBadge:     { backgroundColor: '#FEE2E2', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  voidBadgeTxt:  { fontSize: 9, fontWeight: '800', color: '#DC2626' },

  fab: { position: 'absolute', bottom: 28, right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: AC, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 8 },

  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  modalTitle:  { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  label:       { fontSize: 12, fontWeight: '700', color: '#475569' },
  modalInput:  { backgroundColor: '#F8FAFC', borderRadius: 10, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#0F172A' },
  acctChip:    { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  acctChipActive: { backgroundColor: AC, borderColor: AC },
  acctChipTxt: { fontSize: 13, fontWeight: '600', color: '#475569' },
  submitBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: AC, borderRadius: 14, paddingVertical: 15 },
  submitTxt:   { fontSize: 15, fontWeight: '800', color: '#fff' },
});
