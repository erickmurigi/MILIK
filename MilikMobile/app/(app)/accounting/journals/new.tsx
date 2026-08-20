import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Modal, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../../services/api';
import { DateField } from '../../../../components/ui/DateField';

const AC  = '#064E3B';
const ACL = '#ECFDF5';

type Account = { _id: string; name: string; code?: string; type?: string };
type Line    = { id: string; accountId: string; accountName: string; description: string; debit: string; credit: string };

const mkLine = (): Line => ({
  id: String(Date.now() + Math.random()),
  accountId: '', accountName: '', description: '', debit: '', credit: '',
});

export default function NewJournalScreen() {
  const router = useRouter();

  const [date,       setDate]       = useState(todayStr());
  const [reference,  setReference]  = useState('');
  const [narration,  setNarration]  = useState('');
  const [lines,      setLines]      = useState<Line[]>([mkLine(), mkLine()]);
  const [submitting, setSubmitting] = useState(false);

  // Account picker
  const [accounts,    setAccounts]    = useState<Account[]>([]);
  const [acctSearch,  setAcctSearch]  = useState('');
  const [pickerFor,   setPickerFor]   = useState<string | null>(null); // line id
  const [acctLoading, setAcctLoading] = useState(false);

  useEffect(() => {
    setAcctLoading(true);
    api.get('/chart-of-accounts', { params: { limit: 500 } })
      .then(res => {
        const raw = res.data?.data ?? res.data;
        setAccounts(Array.isArray(raw) ? raw : (raw?.accounts ?? []));
      })
      .catch(() => {})
      .finally(() => setAcctLoading(false));
  }, []);

  const filteredAccounts = accounts.filter(a => {
    const q = acctSearch.toLowerCase();
    return a.name.toLowerCase().includes(q) || (a.code ?? '').toLowerCase().includes(q);
  });

  const updateLine = (id: string, patch: Partial<Line>) =>
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));

  const removeLine = (id: string) => {
    if (lines.length <= 2) return;
    setLines(prev => prev.filter(l => l.id !== id));
  };

  const totalDebit  = lines.reduce((s, l) => s + (parseFloat(l.debit)  || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const balanced    = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  const handleSubmit = async (post = false) => {
    if (!narration.trim()) { Alert.alert('Required', 'Enter a narration.'); return; }
    if (!balanced)         { Alert.alert('Not Balanced', `Debits (${totalDebit.toFixed(2)}) ≠ Credits (${totalCredit.toFixed(2)})`); return; }
    const hasEmptyAccount = lines.some(l => !l.accountId && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0));
    if (hasEmptyAccount) { Alert.alert('Required', 'Select an account for each line with an amount.'); return; }

    const validLines = lines.filter(l => l.accountId && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0));
    setSubmitting(true);
    try {
      const res = await api.post('/journals', {
        date:      date,
        reference: reference.trim() || undefined,
        narration: narration.trim(),
        lines: validLines.map(l => ({
          account:     l.accountId,
          description: l.description.trim() || undefined,
          debit:       parseFloat(l.debit)  || 0,
          credit:      parseFloat(l.credit) || 0,
        })),
      });
      if (post) {
        const id = res.data?.data?._id ?? res.data?._id;
        if (id) await api.post(`/journals/${id}/post`);
      }
      router.back();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to save journal.');
    } finally { setSubmitting(false); }
  };

  return (
    <>
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

            {/* Header fields */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>JOURNAL DETAILS</Text>
              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <DateField label="DATE" value={date} onChange={setDate} />
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.label}>REFERENCE</Text>
                  <TextInput style={styles.input} value={reference} onChangeText={setReference} placeholder="JV-001" placeholderTextColor="#94A3B8" />
                </View>
              </View>
              <View style={{ gap: 6 }}>
                <Text style={styles.label}>Narration <Text style={{ color: '#DC2626' }}>*</Text></Text>
                <TextInput
                  style={[styles.input, styles.textarea]}
                  value={narration} onChangeText={setNarration}
                  placeholder="Brief description of transaction..."
                  placeholderTextColor="#94A3B8"
                  multiline numberOfLines={2} textAlignVertical="top"
                />
              </View>
            </View>

            {/* Lines */}
            <View style={styles.section}>
              <View style={styles.linesHeader}>
                <Text style={styles.sectionLabel}>JOURNAL LINES</Text>
                <TouchableOpacity style={styles.addLineBtn} onPress={() => setLines(prev => [...prev, mkLine()])}>
                  <Ionicons name="add" size={14} color={AC} />
                  <Text style={styles.addLineTxt}>Add Line</Text>
                </TouchableOpacity>
              </View>

              {lines.map((line, i) => (
                <View key={line.id} style={styles.lineCard}>
                  <View style={styles.lineTop}>
                    <Text style={styles.lineNum}>#{i + 1}</Text>
                    {lines.length > 2 && (
                      <TouchableOpacity onPress={() => removeLine(line.id)}>
                        <Ionicons name="close-circle" size={18} color="#DC2626" />
                      </TouchableOpacity>
                    )}
                  </View>
                  <TouchableOpacity style={styles.accountPicker} onPress={() => { setPickerFor(line.id); setAcctSearch(''); }}>
                    <Ionicons name="albums-outline" size={14} color={line.accountId ? AC : '#94A3B8'} />
                    <Text style={[styles.accountPickerTxt, line.accountId && { color: '#0F172A' }]} numberOfLines={1}>
                      {line.accountName || 'Select account...'}
                    </Text>
                    <Ionicons name="chevron-down" size={14} color="#94A3B8" />
                  </TouchableOpacity>
                  <TextInput
                    style={[styles.input, { fontSize: 13 }]}
                    value={line.description} onChangeText={v => updateLine(line.id, { description: v })}
                    placeholder="Line description (optional)" placeholderTextColor="#94A3B8"
                  />
                  <View style={styles.drcrRow}>
                    <View style={styles.drcrField}>
                      <Text style={styles.drcrLabel}>DEBIT</Text>
                      <TextInput
                        style={styles.drcrInput}
                        value={line.debit}
                        onChangeText={v => updateLine(line.id, { debit: v, credit: v ? '' : line.credit })}
                        keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#CBD5E1"
                      />
                    </View>
                    <View style={styles.drcrSep} />
                    <View style={styles.drcrField}>
                      <Text style={styles.drcrLabel}>CREDIT</Text>
                      <TextInput
                        style={styles.drcrInput}
                        value={line.credit}
                        onChangeText={v => updateLine(line.id, { credit: v, debit: v ? '' : line.debit })}
                        keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#CBD5E1"
                      />
                    </View>
                  </View>
                </View>
              ))}

              {/* Totals */}
              <View style={[styles.totalsRow, balanced ? styles.totalsBalanced : styles.totalsUnbalanced]}>
                <Ionicons name={balanced ? 'checkmark-circle' : 'alert-circle'} size={16} color={balanced ? AC : '#DC2626'} />
                <Text style={[styles.totalsTxt, { color: balanced ? AC : '#DC2626' }]}>
                  Dr {totalDebit.toFixed(2)}  ·  Cr {totalCredit.toFixed(2)}
                  {!balanced ? '  ⚠ Not balanced' : '  ✓ Balanced'}
                </Text>
              </View>
            </View>
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.draftBtn, submitting && { opacity: 0.6 }]}
              onPress={() => handleSubmit(false)} disabled={submitting}
            >
              <Text style={styles.draftBtnTxt}>Save Draft</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.postBtn, (!balanced || submitting) && { opacity: 0.5 }]}
              onPress={() => handleSubmit(true)} disabled={!balanced || submitting}
            >
              {submitting ? <ActivityIndicator color="#fff" size="small" /> : (
                <>
                  <Ionicons name="send-outline" size={16} color="#fff" />
                  <Text style={styles.postBtnTxt}>Save & Submit</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Account picker modal */}
      <Modal visible={!!pickerFor} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPickerFor(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Account</Text>
            <TouchableOpacity onPress={() => setPickerFor(null)}>
              <Ionicons name="close" size={24} color="#475569" />
            </TouchableOpacity>
          </View>
          <View style={styles.modalSearch}>
            <Ionicons name="search-outline" size={16} color="#94A3B8" />
            <TextInput
              style={{ flex: 1, fontSize: 15, color: '#0F172A' }}
              placeholder="Search accounts..." placeholderTextColor="#94A3B8"
              value={acctSearch} onChangeText={setAcctSearch}
              autoFocus
            />
          </View>
          {acctLoading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={AC} />
            </View>
          ) : (
            <FlatList
              data={filteredAccounts}
              keyExtractor={a => a._id}
              contentContainerStyle={{ padding: 16, gap: 4 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item: acct }) => (
                <TouchableOpacity
                  style={styles.acctRow}
                  onPress={() => {
                    if (pickerFor) updateLine(pickerFor, { accountId: acct._id, accountName: acct.name });
                    setPickerFor(null);
                  }}
                >
                  {acct.code ? <Text style={styles.acctCode}>{acct.code}</Text> : null}
                  <Text style={styles.acctName} numberOfLines={1}>{acct.name}</Text>
                  {acct.type ? <Text style={styles.acctType}>{acct.type}</Text> : null}
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={{ alignItems: 'center', paddingTop: 40 }}>
                  <Text style={{ color: '#94A3B8' }}>No accounts found</Text>
                </View>
              }
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
  textarea: { minHeight: 72, paddingTop: 11 },

  linesHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addLineBtn:  { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: ACL, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  addLineTxt:  { fontSize: 12, fontWeight: '700', color: AC },

  lineCard: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 12, gap: 10 },
  lineTop:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lineNum:  { fontSize: 11, fontWeight: '700', color: '#94A3B8' },

  accountPicker: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F8FAFC', borderRadius: 10, borderWidth: 1.5, borderColor: '#E2E8F0',
    paddingHorizontal: 12, paddingVertical: 11,
  },
  accountPickerTxt: { flex: 1, fontSize: 14, color: '#94A3B8', fontWeight: '500' },

  drcrRow:   { flexDirection: 'row', gap: 0, backgroundColor: '#F8FAFC', borderRadius: 10, borderWidth: 1.5, borderColor: '#E2E8F0', overflow: 'hidden' },
  drcrField: { flex: 1, padding: 10 },
  drcrSep:   { width: 1, backgroundColor: '#E2E8F0' },
  drcrLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8, color: '#94A3B8', marginBottom: 4 },
  drcrInput: { fontSize: 16, fontWeight: '700', color: '#0F172A' },

  totalsRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 10 },
  totalsBalanced:  { backgroundColor: ACL },
  totalsUnbalanced:{ backgroundColor: '#FEF2F2' },
  totalsTxt:       { fontSize: 12, fontWeight: '700' },

  footer: { borderTopWidth: 1, borderTopColor: '#E2E8F0', backgroundColor: '#fff', padding: 16, flexDirection: 'row', gap: 10 },
  draftBtn: { flex: 1, borderRadius: 12, paddingVertical: 14, borderWidth: 1.5, borderColor: '#E2E8F0', alignItems: 'center' },
  draftBtnTxt: { fontSize: 15, fontWeight: '700', color: '#475569' },
  postBtn:  { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: AC, borderRadius: 12, paddingVertical: 14 },
  postBtnTxt: { fontSize: 15, fontWeight: '800', color: '#fff' },

  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  modalTitle:  { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  modalSearch: { flexDirection: 'row', alignItems: 'center', gap: 10, margin: 16, marginTop: 12, backgroundColor: '#F8FAFC', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 12, height: 46 },

  acctRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#F1F5F9' },
  acctCode: { fontSize: 11, fontWeight: '800', color: '#94A3B8', minWidth: 40 },
  acctName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#0F172A' },
  acctType: { fontSize: 10, fontWeight: '600', color: '#94A3B8', backgroundColor: '#F1F5F9', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
});
