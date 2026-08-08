import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, Modal, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';

type TenantOption = {
  _id:  string; name: string;
  unit?: { _id?: string; unitNumber?: string; property?: { _id?: string; propertyName?: string; name?: string } };
};

const CATEGORIES = [
  { value: 'RENT_CHARGE',    label: 'Rent'        },
  { value: 'UTILITY_CHARGE', label: 'Utility'     },
  { value: 'DEPOSIT_CHARGE', label: 'Deposit'     },
  { value: 'PENALTY_CHARGE', label: 'Late Penalty' },
  { value: 'DEBIT_NOTE',     label: 'Debit Note'  },
];

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function NewInvoiceScreen() {
  const router = useRouter();

  // Tenant picker
  const [tenantId,    setTenantId]    = useState('');
  const [tenantName,  setTenantName]  = useState('');
  const [unitId,      setUnitId]      = useState('');
  const [propertyId,  setPropertyId]  = useState('');
  const [showPicker,  setShowPicker]  = useState(false);
  const [tSearch,     setTSearch]     = useState('');
  const [tResults,    setTResults]    = useState<TenantOption[]>([]);
  const [tSearching,  setTSearching]  = useState(false);

  // Form fields
  const [category,     setCategory]     = useState('RENT_CHARGE');
  const [amount,       setAmount]       = useState('');
  const [description,  setDescription]  = useState('');
  const [invoiceDate,  setInvoiceDate]  = useState(todayStr());
  const [dueDate,      setDueDate]      = useState('');
  const [submitting,   setSubmitting]   = useState(false);

  // Debounced tenant search
  useEffect(() => {
    if (!tSearch.trim() || tSearch.length < 2) { setTResults([]); return; }
    const t = setTimeout(async () => {
      setTSearching(true);
      try {
        const { data } = await api.get('/tenants', { params: { search: tSearch, limit: 20, status: 'active' } });
        setTResults(data.data ?? data.tenants ?? []);
      } catch { setTResults([]); }
      finally { setTSearching(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [tSearch]);

  const selectTenant = (t: TenantOption) => {
    setTenantId(t._id);
    setTenantName(t.name);
    setUnitId(t.unit?._id ?? '');
    setPropertyId(t.unit?.property?._id ?? '');
    setTSearch('');
    setTResults([]);
    setShowPicker(false);
  };

  const validate = () => {
    if (!tenantId)              { Alert.alert('Missing', 'Please select a tenant.'); return false; }
    if (!unitId)                { Alert.alert('Missing', 'Tenant has no unit assigned.'); return false; }
    if (!amount || Number(amount) <= 0) { Alert.alert('Missing', 'Enter a valid amount.'); return false; }
    return true;
  };

  const submit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      await api.post('/tenant-invoices', {
        tenant:      tenantId,
        unit:        unitId,
        property:    propertyId || undefined,
        category,
        amount:      Number(amount),
        description: description.trim() || undefined,
        invoiceDate: new Date(invoiceDate).toISOString(),
        bookingDate: new Date(invoiceDate).toISOString(),
        dueDate:     dueDate ? new Date(dueDate).toISOString() : undefined,
      });
      Alert.alert('Invoice Created', 'The invoice has been booked successfully.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to create invoice.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Tenant */}
        <View style={styles.field}>
          <Text style={styles.label}>TENANT *</Text>
          {tenantId ? (
            <TouchableOpacity style={styles.selectedChip} onPress={() => { setTenantId(''); setTenantName(''); setUnitId(''); setPropertyId(''); }}>
              <Ionicons name="person" size={14} color={Colors.primary} />
              <Text style={styles.selectedChipText}>{tenantName}</Text>
              <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.inputRow} onPress={() => setShowPicker(true)}>
              <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
              <Text style={[styles.inputText, { color: Colors.textMuted }]}>Search tenant...</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Category */}
        <View style={styles.field}>
          <Text style={styles.label}>CHARGE TYPE *</Text>
          <View style={styles.pillRow}>
            {CATEGORIES.map(c => (
              <TouchableOpacity
                key={c.value}
                style={[styles.pill, category === c.value && styles.pillActive]}
                onPress={() => setCategory(c.value)}
              >
                <Text style={[styles.pillText, category === c.value && styles.pillTextActive]}>
                  {c.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Amount */}
        <View style={styles.field}>
          <Text style={styles.label}>AMOUNT (KES) *</Text>
          <View style={styles.inputRow}>
            <Text style={styles.prefix}>KES</Text>
            <TextInput
              style={[styles.inputText, { flex: 1 }]}
              keyboardType="numeric"
              placeholder="0.00"
              placeholderTextColor={Colors.textMuted}
              value={amount}
              onChangeText={setAmount}
            />
          </View>
        </View>

        {/* Description */}
        <View style={styles.field}>
          <Text style={styles.label}>DESCRIPTION</Text>
          <View style={[styles.inputRow, { height: 'auto', paddingVertical: 12, alignItems: 'flex-start' }]}>
            <TextInput
              style={[styles.inputText, { flex: 1, minHeight: 60 }]}
              placeholder="Optional notes..."
              placeholderTextColor={Colors.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              textAlignVertical="top"
            />
          </View>
        </View>

        {/* Invoice date */}
        <View style={styles.field}>
          <Text style={styles.label}>INVOICE DATE *</Text>
          <View style={styles.inputRow}>
            <Ionicons name="calendar-outline" size={16} color={Colors.textMuted} />
            <TextInput
              style={[styles.inputText, { flex: 1 }]}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.textMuted}
              value={invoiceDate}
              onChangeText={setInvoiceDate}
              keyboardType="numeric"
            />
          </View>
        </View>

        {/* Due date */}
        <View style={styles.field}>
          <Text style={styles.label}>DUE DATE</Text>
          <View style={styles.inputRow}>
            <Ionicons name="calendar-outline" size={16} color={Colors.textMuted} />
            <TextInput
              style={[styles.inputText, { flex: 1 }]}
              placeholder="YYYY-MM-DD (optional)"
              placeholderTextColor={Colors.textMuted}
              value={dueDate}
              onChangeText={setDueDate}
              keyboardType="numeric"
            />
          </View>
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
          onPress={submit}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator size="small" color={Colors.white} />
            : <Text style={styles.submitText}>Book Invoice</Text>}
        </TouchableOpacity>
      </ScrollView>

      {/* Tenant picker modal */}
      <Modal visible={showPicker} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Tenant</Text>
            <TouchableOpacity onPress={() => { setShowPicker(false); setTSearch(''); setTResults([]); }}>
              <Ionicons name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
          </View>
          <View style={{ padding: 16 }}>
            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Type tenant name..."
                placeholderTextColor={Colors.textMuted}
                value={tSearch}
                onChangeText={setTSearch}
                autoFocus
              />
              {tSearching && <ActivityIndicator size="small" color={Colors.primary} />}
            </View>
          </View>
          <FlatList
            data={tResults}
            keyExtractor={item => item._id}
            contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 8 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.optionRow} onPress={() => selectTenant(item)}>
                <View style={styles.optionAvatar}>
                  <Text style={styles.optionAvatarText}>{item.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionName}>{item.name}</Text>
                  {item.unit?.unitNumber && (
                    <Text style={styles.optionMeta}>
                      Unit {item.unit.unitNumber}
                      {item.unit.property?.propertyName ? ` · ${item.unit.property.propertyName}` : ''}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              tSearch.length >= 2 && !tSearching ? (
                <View style={{ padding: 24, alignItems: 'center' }}>
                  <Text style={{ color: Colors.textMuted }}>No tenants found</Text>
                </View>
              ) : null
            }
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 20, gap: 20, paddingBottom: 60 },

  field:  { gap: 6 },
  label:  { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted },

  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, height: 48,
  },
  inputText: { fontSize: 14, color: Colors.text },
  prefix:    { fontSize: 13, fontWeight: '700', color: Colors.textMuted },

  selectedChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.primaryFaded, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.primary,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  selectedChipText: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.primary },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  pillActive:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillText:       { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  pillTextActive: { color: Colors.white },

  submitBtn: {
    backgroundColor: Colors.primary, borderRadius: 14,
    height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  submitText: { color: Colors.white, fontSize: 16, fontWeight: '800' },

  // Modal
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: Colors.text },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, height: 42,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, padding: 14,
  },
  optionAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.primaryFaded,
    alignItems: 'center', justifyContent: 'center',
  },
  optionAvatarText: { fontSize: 16, fontWeight: '800', color: Colors.primary },
  optionName:       { fontSize: 14, fontWeight: '600', color: Colors.text },
  optionMeta:       { fontSize: 12, color: Colors.textMuted },
});
