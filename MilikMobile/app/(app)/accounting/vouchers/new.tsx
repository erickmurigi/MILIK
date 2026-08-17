import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Modal, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../../services/api';

const AC  = '#064E3B';
const ACL = '#ECFDF5';

type Account  = { _id: string; name: string; code?: string };
type Provider = { _id: string; name: string; email?: string };

const PAYMENT_METHODS = ['cash', 'cheque', 'bank_transfer', 'mpesa'] as const;
const PM_LABELS: Record<string, string> = { cash: 'Cash', cheque: 'Cheque', bank_transfer: 'Bank Transfer', mpesa: 'M-Pesa' };

export default function NewVoucherScreen() {
  const router = useRouter();

  const [payee,         setPayee]         = useState('');
  const [date,          setDate]          = useState(todayStr());
  const [amount,        setAmount]        = useState('');
  const [narration,     setNarration]     = useState('');
  const [payMethod,     setPayMethod]     = useState('cash');
  const [payAccountId,  setPayAccountId]  = useState('');
  const [payAccountName,setPayAccountName]= useState('');
  const [expenseAccId,  setExpenseAccId]  = useState('');
  const [expenseAccName,setExpenseAccName]= useState('');
  const [reference,     setReference]     = useState('');
  const [submitting,    setSubmitting]    = useState(false);

  const [accounts,   setAccounts]   = useState<Account[]>([]);
  const [providers,  setProviders]  = useState<Provider[]>([]);
  const [acctSearch, setAcctSearch] = useState('');
  const [provSearch, setProvSearch] = useState('');
  const [pickerMode, setPickerMode] = useState<'payment' | 'expense' | 'payee' | null>(null);
  const [dataLoading,setDataLoading]= useState(false);

  useEffect(() => {
    setDataLoading(true);
    Promise.allSettled([
      api.get('/chart-of-accounts', { params: { limit: 500 } }),
      api.get('/service-providers',  { params: { limit: 200 } }),
    ]).then(([accRes, provRes]) => {
      if (accRes.status === 'fulfilled') {
        const raw = accRes.value.data?.data ?? accRes.value.data;
        setAccounts(Array.isArray(raw) ? raw : (raw?.accounts ?? []));
      }
      if (provRes.status === 'fulfilled') {
        const raw = provRes.value.data?.data ?? provRes.value.data;
        setProviders(Array.isArray(raw) ? raw : (raw?.providers ?? raw?.serviceProviders ?? []));
      }
    }).finally(() => setDataLoading(false));
  }, []);

  const filteredAccounts = accounts.filter(a => {
    const q = acctSearch.toLowerCase();
    return a.name.toLowerCase().includes(q) || (a.code ?? '').toLowerCase().includes(q);
  });

  const filteredProviders = providers.filter(p =>
    p.name.toLowerCase().includes(provSearch.toLowerCase())
  );

  const handleSubmit = async () => {
    if (!payee.trim())   { Alert.alert('Required', 'Enter payee name.'); return; }
    if (!amount.trim())  { Alert.alert('Required', 'Enter amount.');     return; }
    if (!narration.trim()){ Alert.alert('Required', 'Enter narration.'); return; }
    setSubmitting(true);
    try {
      await api.post('/payment-vouchers', {
        payee:          payee.trim(),
        date,
        amount:         parseFloat(amount),
        narration:      narration.trim(),
        paymentMethod:  payMethod,
        paymentAccount: payAccountId || undefined,
        expenseAccount: expenseAccId || undefined,
        reference:      reference.trim() || undefined,
      });
      router.back();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to create voucher.');
    } finally { setSubmitting(false); }
  };

  return (
    <>
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

            {/* Payee */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>PAYEE</Text>
              <TouchableOpacity style={styles.pickerBtn} onPress={() => { setPickerMode('payee'); setProvSearch(''); }}>
                <Ionicons name="person-outline" size={15} color={payee ? AC : '#94A3B8'} />
                <Text style={[styles.pickerBtnTxt, payee && { color: '#0F172A' }]} numberOfLines={1}>
                  {payee || 'Select or type payee...'}
                </Text>
                <Ionicons name="chevron-down" size={15} color="#94A3B8" />
              </TouchableOpacity>
              <TextInput style={styles.input} placeholder="Or type payee name manually" placeholderTextColor="#94A3B8" value={payee} onChangeText={setPayee} />
            </View>

            {/* Date + Amount */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>DETAILS</Text>
              <View style={styles.row2}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.label}>Date</Text>
                  <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor="#94A3B8" />
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.label}>Reference</Text>
                  <TextInput style={styles.input} value={reference} onChangeText={setReference} placeholder="Optional" placeholderTextColor="#94A3B8" />
                </View>
              </View>
              <View style={{ gap: 6 }}>
                <Text style={styles.label}>Amount (KES) <Text style={{ color: '#DC2626' }}>*</Text></Text>
                <TextInput style={[styles.input, styles.amountInput]} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#94A3B8" selectTextOnFocus />
              </View>
              <View style={{ gap: 6 }}>
                <Text style={styles.label}>Narration <Text style={{ color: '#DC2626' }}>*</Text></Text>
                <TextInput style={[styles.input, styles.textarea]} value={narration} onChangeText={setNarration} placeholder="Purpose of payment..." placeholderTextColor="#94A3B8" multiline numberOfLines={2} textAlignVertical="top" />
              </View>
            </View>

            {/* Payment method */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>PAYMENT METHOD</Text>
              <View style={styles.methodGrid}>
                {PAYMENT_METHODS.map(m => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.methodChip, payMethod === m && styles.methodChipActive]}
                    onPress={() => setPayMethod(m)}
                  >
                    <Text style={[styles.methodChipTxt, payMethod === m && { color: '#fff' }]}>{PM_LABELS[m]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Accounts */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>GL ACCOUNTS</Text>
              <View style={{ gap: 6 }}>
                <Text style={styles.label}>Payment Account</Text>
                <TouchableOpacity style={styles.pickerBtn} onPress={() => { setPickerMode('payment'); setAcctSearch(''); }}>
                  <Ionicons name="card-outline" size={15} color={payAccountId ? AC : '#94A3B8'} />
                  <Text style={[styles.pickerBtnTxt, payAccountId && { color: '#0F172A' }]} numberOfLines={1}>
                    {payAccountName || 'Select cash/bank account...'}
                  </Text>
                  <Ionicons name="chevron-down" size={15} color="#94A3B8" />
                </TouchableOpacity>
              </View>
              <View style={{ gap: 6 }}>
                <Text style={styles.label}>Expense Account</Text>
                <TouchableOpacity style={styles.pickerBtn} onPress={() => { setPickerMode('expense'); setAcctSearch(''); }}>
                  <Ionicons name="albums-outline" size={15} color={expenseAccId ? AC : '#94A3B8'} />
                  <Text style={[styles.pickerBtnTxt, expenseAccId && { color: '#0F172A' }]} numberOfLines={1}>
                    {expenseAccName || 'Select expense account...'}
                  </Text>
                  <Ionicons name="chevron-down" size={15} color="#94A3B8" />
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={[styles.submitBtn, submitting && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" size="small" /> : (
                <>
                  <Ionicons name="receipt-outline" size={18} color="#fff" />
                  <Text style={styles.submitTxt}>Create Voucher</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Account / provider picker modal */}
      <Modal
        visible={!!pickerMode}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickerMode(null)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {pickerMode === 'payee' ? 'Select Payee' : pickerMode === 'payment' ? 'Payment Account' : 'Expense Account'}
            </Text>
            <TouchableOpacity onPress={() => setPickerMode(null)}>
              <Ionicons name="close" size={24} color="#475569" />
            </TouchableOpacity>
          </View>
          <View style={styles.modalSearch}>
            <Ionicons name="search-outline" size={16} color="#94A3B8" />
            <TextInput
              style={{ flex: 1, fontSize: 15, color: '#0F172A' }}
              placeholder="Search..." placeholderTextColor="#94A3B8"
              value={pickerMode === 'payee' ? provSearch : acctSearch}
              onChangeText={pickerMode === 'payee' ? setProvSearch : setAcctSearch}
              autoFocus
            />
          </View>

          {pickerMode === 'payee' ? (
            <FlatList
              data={filteredProviders}
              keyExtractor={p => p._id}
              contentContainerStyle={{ padding: 16, gap: 4 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.rowItem} onPress={() => { setPayee(item.name); setPickerMode(null); }}>
                  <Text style={styles.rowItemTxt}>{item.name}</Text>
                  {item.email ? <Text style={styles.rowItemSub}>{item.email}</Text> : null}
                </TouchableOpacity>
              )}
            />
          ) : (
            <FlatList
              data={filteredAccounts}
              keyExtractor={a => a._id}
              contentContainerStyle={{ padding: 16, gap: 4 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item: acct }) => (
                <TouchableOpacity
                  style={styles.rowItem}
                  onPress={() => {
                    if (pickerMode === 'payment') { setPayAccountId(acct._id); setPayAccountName(acct.name); }
                    else                          { setExpenseAccId(acct._id); setExpenseAccName(acct.name); }
                    setPickerMode(null);
                  }}
                >
                  {acct.code ? <Text style={styles.rowItemCode}>{acct.code}</Text> : null}
                  <Text style={styles.rowItemTxt} numberOfLines={1}>{acct.name}</Text>
                </TouchableOpacity>
              )}
            />
          )}
        </SafeAreaView>
      </Modal>
    </>
  );
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#F0FDF4' },
  scroll: { padding: 16, gap: 20, paddingBottom: 16 },
  section:      { gap: 10 },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8' },
  label:        { fontSize: 12, fontWeight: '700', color: '#475569' },
  row2:         { flexDirection: 'row', gap: 10 },
  input: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#0F172A' },
  amountInput: { fontSize: 22, fontWeight: '800', color: AC },
  textarea:    { minHeight: 72, paddingTop: 11 },
  pickerBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 12, paddingVertical: 13 },
  pickerBtnTxt: { flex: 1, fontSize: 14, color: '#94A3B8', fontWeight: '500' },
  methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  methodChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#E2E8F0' },
  methodChipActive: { backgroundColor: AC, borderColor: AC },
  methodChipTxt: { fontSize: 13, fontWeight: '700', color: '#475569' },
  footer: { borderTopWidth: 1, borderTopColor: '#E2E8F0', backgroundColor: '#fff', padding: 16 },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: AC, borderRadius: 14, paddingVertical: 15 },
  submitTxt: { fontSize: 16, fontWeight: '800', color: '#fff' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  modalTitle:  { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  modalSearch: { flexDirection: 'row', alignItems: 'center', gap: 10, margin: 16, marginTop: 12, backgroundColor: '#F8FAFC', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 12, height: 46 },
  rowItem:    { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#F1F5F9' },
  rowItemCode: { fontSize: 11, fontWeight: '800', color: '#94A3B8', minWidth: 40 },
  rowItemTxt:  { flex: 1, fontSize: 14, fontWeight: '600', color: '#0F172A' },
  rowItemSub:  { fontSize: 12, color: '#94A3B8' },
});
