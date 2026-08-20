import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../../services/api';
import { DateField } from '../../../../components/ui/DateField';

const AC  = '#064E3B';
const ACL = '#ECFDF5';

type LineItem = { id: string; description: string; quantity: string; unitPrice: string };
const mkItem = (): LineItem => ({ id: String(Date.now() + Math.random()), description: '', quantity: '1', unitPrice: '' });

const URGENCY_OPTS = [
  { key: 'low',    label: 'Low',    color: '#64748B' },
  { key: 'medium', label: 'Medium', color: '#D97706' },
  { key: 'high',   label: 'High',   color: '#DC2626' },
  { key: 'urgent', label: 'Urgent', color: '#7C3AED' },
];

export default function NewRequisitionScreen() {
  const router = useRouter();

  const [purpose,    setPurpose]    = useState('');
  const [date,       setDate]       = useState(todayStr());
  const [urgency,    setUrgency]    = useState('medium');
  const [department, setDepartment] = useState('');
  const [notes,      setNotes]      = useState('');
  const [items,      setItems]      = useState<LineItem[]>([mkItem()]);
  const [submitting, setSubmitting] = useState(false);

  const updateItem = (id: string, patch: Partial<LineItem>) =>
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));

  const removeItem = (id: string) => {
    if (items.length <= 1) return;
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const totalAmount = items.reduce((sum, i) => {
    return sum + (parseFloat(i.quantity) || 0) * (parseFloat(i.unitPrice) || 0);
  }, 0);

  const handleSubmit = async () => {
    if (!purpose.trim())         { Alert.alert('Required', 'Enter a purpose.');    return; }
    if (totalAmount <= 0)        { Alert.alert('Required', 'Enter item amounts.'); return; }

    const validItems = items.filter(i => i.description && parseFloat(i.unitPrice) > 0);
    setSubmitting(true);
    try {
      await api.post('/expense-requisitions', {
        purpose:     purpose.trim(),
        date,
        urgency,
        department:  department.trim() || undefined,
        notes:       notes.trim() || undefined,
        totalAmount,
        items: validItems.map(i => ({
          description: i.description,
          quantity:    parseFloat(i.quantity) || 1,
          unitPrice:   parseFloat(i.unitPrice) || 0,
          amount:      (parseFloat(i.quantity) || 1) * (parseFloat(i.unitPrice) || 0),
        })),
      });
      router.back();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to submit requisition.');
    } finally { setSubmitting(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Details */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>REQUISITION DETAILS</Text>
            <View style={{ gap: 6 }}>
              <Text style={styles.label}>Purpose <Text style={{ color: '#DC2626' }}>*</Text></Text>
              <TextInput style={[styles.input, styles.textarea]} value={purpose} onChangeText={setPurpose} placeholder="Brief description of what's needed..." placeholderTextColor="#94A3B8" multiline numberOfLines={2} textAlignVertical="top" />
            </View>
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <DateField label="DATE NEEDED" value={date} onChange={setDate} />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.label}>DEPARTMENT</Text>
                <TextInput style={styles.input} value={department} onChangeText={setDepartment} placeholder="Optional" placeholderTextColor="#94A3B8" />
              </View>
            </View>
          </View>

          {/* Urgency */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>URGENCY</Text>
            <View style={styles.urgencyRow}>
              {URGENCY_OPTS.map(u => (
                <TouchableOpacity
                  key={u.key}
                  style={[styles.urgencyChip, urgency === u.key && { backgroundColor: u.color + '15', borderColor: u.color }]}
                  onPress={() => setUrgency(u.key)}
                >
                  <View style={[styles.urgencyDot, { backgroundColor: u.color }]} />
                  <Text style={[styles.urgencyTxt, urgency === u.key && { color: u.color, fontWeight: '700' }]}>
                    {u.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Line items */}
          <View style={styles.section}>
            <View style={styles.linesHeader}>
              <Text style={styles.sectionLabel}>ITEMS</Text>
              <TouchableOpacity style={styles.addBtn} onPress={() => setItems(prev => [...prev, mkItem()])}>
                <Ionicons name="add" size={14} color={AC} />
                <Text style={styles.addBtnTxt}>Add Item</Text>
              </TouchableOpacity>
            </View>

            {items.map((item, i) => {
              const lineTotal = (parseFloat(item.quantity) || 0) * (parseFloat(item.unitPrice) || 0);
              return (
                <View key={item.id} style={styles.lineCard}>
                  <View style={styles.lineTop}>
                    <Text style={styles.lineNum}>#{i + 1}</Text>
                    {items.length > 1 && (
                      <TouchableOpacity onPress={() => removeItem(item.id)}>
                        <Ionicons name="close-circle" size={17} color="#DC2626" />
                      </TouchableOpacity>
                    )}
                  </View>
                  <TextInput
                    style={styles.input}
                    value={item.description} onChangeText={v => updateItem(item.id, { description: v })}
                    placeholder="Item description" placeholderTextColor="#94A3B8"
                  />
                  <View style={styles.row2}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={styles.label}>Qty</Text>
                      <TextInput style={styles.input} value={item.quantity} onChangeText={v => updateItem(item.id, { quantity: v })} keyboardType="decimal-pad" />
                    </View>
                    <View style={{ flex: 2, gap: 4 }}>
                      <Text style={styles.label}>Unit Price (KES)</Text>
                      <TextInput style={styles.input} value={item.unitPrice} onChangeText={v => updateItem(item.id, { unitPrice: v })} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#94A3B8" />
                    </View>
                    <View style={{ flex: 1, gap: 4, alignItems: 'flex-end' }}>
                      <Text style={styles.label}>Total</Text>
                      <Text style={styles.lineTotalTxt}>KES {lineTotal.toLocaleString()}</Text>
                    </View>
                  </View>
                </View>
              );
            })}

            <View style={styles.grandTotal}>
              <Text style={styles.grandTotalLabel}>TOTAL AMOUNT</Text>
              <Text style={styles.grandTotalValue}>KES {totalAmount.toLocaleString('en-KE')}</Text>
            </View>
          </View>

          {/* Notes */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>ADDITIONAL NOTES</Text>
            <TextInput style={[styles.input, styles.textarea]} value={notes} onChangeText={setNotes} placeholder="Any additional information..." placeholderTextColor="#94A3B8" multiline numberOfLines={3} textAlignVertical="top" />
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={[styles.submitBtn, submitting && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#fff" size="small" /> : (
              <>
                <Ionicons name="send-outline" size={18} color="#fff" />
                <Text style={styles.submitTxt}>Submit Requisition</Text>
                {totalAmount > 0 && <Text style={styles.submitAmt}>· KES {totalAmount.toLocaleString('en-KE')}</Text>}
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
  urgencyRow:  { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  urgencyChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#E2E8F0' },
  urgencyDot:  { width: 8, height: 8, borderRadius: 4 },
  urgencyTxt:  { fontSize: 13, fontWeight: '600', color: '#475569' },
  linesHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addBtn:      { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#ECFDF5', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  addBtnTxt:   { fontSize: 12, fontWeight: '700', color: AC },
  lineCard:    { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 12, gap: 10 },
  lineTop:     { flexDirection: 'row', justifyContent: 'space-between' },
  lineNum:     { fontSize: 11, fontWeight: '700', color: '#94A3B8' },
  lineTotalTxt:{ fontSize: 14, fontWeight: '800', color: AC, paddingTop: 11 },
  grandTotal:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#ECFDF5', borderRadius: 12, padding: 14 },
  grandTotalLabel:{ fontSize: 12, fontWeight: '700', color: AC },
  grandTotalValue:{ fontSize: 20, fontWeight: '900', color: AC },
  footer:     { borderTopWidth: 1, borderTopColor: '#E2E8F0', backgroundColor: '#fff', padding: 16 },
  submitBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: AC, borderRadius: 14, paddingVertical: 15 },
  submitTxt:  { fontSize: 16, fontWeight: '800', color: '#fff' },
  submitAmt:  { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },
});
