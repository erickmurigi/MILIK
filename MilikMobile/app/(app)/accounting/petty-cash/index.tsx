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
  _id:         string;
  description: string;
  amount:      number;
  date:        string;
  isVoided?:   boolean;
  account?:    { name?: string };
  payee?:      string;
};

const TABS = [{ key: 'accounts', label: 'Accounts' }, { key: 'disbursements', label: 'Disbursements' }] as const;
type Tab = typeof TABS[number]['key'];

export default function PettyCashScreen() {
  const [tab,           setTab]           = useState<Tab>('accounts');
  const [accounts,      setAccounts]      = useState<PettyCashAccount[]>([]);
  const [disbursements, setDisbursements] = useState<Disbursement[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);

  // New disbursement modal
  const [showDisbModal, setShowDisbModal] = useState(false);
  const [dAccount,      setDAccount]      = useState('');
  const [dDesc,         setDDesc]         = useState('');
  const [dAmount,       setDAmount]       = useState('');
  const [dDate,         setDDate]         = useState(todayStr());
  const [dPayee,        setDPayee]        = useState('');
  const [saving,        setSaving]        = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const [accRes, disbRes] = await Promise.allSettled([
        api.get('/petty-cash/accounts'),
        api.get('/petty-cash/disbursements', { params: { limit: 50 } }),
      ]);
      if (accRes.status === 'fulfilled') {
        const raw = accRes.value.data?.data ?? accRes.value.data;
        setAccounts(Array.isArray(raw) ? raw : (raw?.accounts ?? []));
      }
      if (disbRes.status === 'fulfilled') {
        const raw = disbRes.value.data?.data ?? disbRes.value.data;
        setDisbursements(Array.isArray(raw) ? raw : (raw?.disbursements ?? []));
      }
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

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
      load(true);
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
          try { await api.put(`/petty-cash/disbursements/${id}/void`); load(true); }
          catch (err: any) { Alert.alert('Error', err?.response?.data?.message ?? 'Failed.'); }
        },
      },
    ]);
  };

  if (loading) return <MilikLoader fullscreen />;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Tabs */}
      <View style={styles.tabsRow}>
        {TABS.map(t => (
          <TouchableOpacity key={t.key} style={[styles.tab, tab === t.key && styles.tabActive]} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabTxt, tab === t.key && styles.tabTxtActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'accounts' ? (
        <FlatList
          data={accounts}
          keyExtractor={a => a._id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={AC} />}
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
                {/* Balance bar */}
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
        <FlatList
          data={disbursements}
          keyExtractor={d => d._id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={AC} />}
          ListEmptyComponent={<View style={styles.emptyWrap}><Ionicons name="cash-outline" size={48} color="#CBD5E1" /><Text style={styles.emptyTxt}>No disbursements</Text></View>}
          renderItem={({ item: disb }) => (
            <View style={[styles.disbCard, disb.isVoided && { opacity: 0.5 }]}>
              <View style={styles.disbTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.disbDesc} numberOfLines={2}>{disb.description}</Text>
                  {disb.payee ? <Text style={styles.disbMeta}>Payee: {disb.payee}</Text> : null}
                  {disb.account?.name ? <Text style={styles.disbMeta}>{disb.account.name}</Text> : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={styles.disbAmt}>{fmt(disb.amount)}</Text>
                  {disb.isVoided ? (
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
          )}
        />
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

  disbCard:    { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, gap: 6 },
  disbTop:     { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  disbDesc:    { fontSize: 14, fontWeight: '600', color: '#0F172A' },
  disbMeta:    { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  disbAmt:     { fontSize: 15, fontWeight: '900', color: '#0F172A' },
  disbDate:    { fontSize: 11, color: '#94A3B8' },
  voidBadge:   { backgroundColor: '#FEE2E2', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  voidBadgeTxt:{ fontSize: 9, fontWeight: '800', color: '#DC2626' },

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
