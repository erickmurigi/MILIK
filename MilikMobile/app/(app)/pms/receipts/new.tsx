import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, Modal, FlatList, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';

type TenantOption = { _id: string; name: string; unit?: { _id?: string; unitNumber?: string } };
type CashbookOption = { _id: string; name: string; code?: string };

const PAYMENT_TYPES = [
  { value: 'rent',     label: 'Rent'       },
  { value: 'deposit',  label: 'Deposit'    },
  { value: 'utility',  label: 'Utility'    },
  { value: 'late_fee', label: 'Late Fee'   },
  { value: 'other',    label: 'Other'      },
];

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function NewReceiptScreen() {
  const router = useRouter();

  // Form state
  const [tenantId,     setTenantId]     = useState('');
  const [tenantName,   setTenantName]   = useState('');
  const [unitId,       setUnitId]       = useState('');
  const [amount,       setAmount]       = useState('');
  const [refNumber,    setRefNumber]    = useState('');
  const [paymentType,  setPaymentType]  = useState('rent');
  const [paymentDate,  setPaymentDate]  = useState(todayStr());
  const [cashbookId,   setCashbookId]   = useState('');
  const [cashbookName, setCashbookName] = useState('');
  const [directToLandlord, setDirectToLandlord] = useState(false);

  // Autocomplete state
  const [tenantSearch,    setTenantSearch]    = useState('');
  const [tenantResults,   setTenantResults]   = useState<TenantOption[]>([]);
  const [tenantSearching, setTenantSearching] = useState(false);
  const [showTenantPicker, setShowTenantPicker] = useState(false);

  // Cashbook picker state
  const [cashbooks,       setCashbooks]       = useState<CashbookOption[]>([]);
  const [showCashbookPicker, setShowCashbookPicker] = useState(false);
  const [cashbooksLoading,   setCashbooksLoading]   = useState(false);

  // Submit state
  const [submitting, setSubmitting] = useState(false);

  // Debounced tenant search
  useEffect(() => {
    if (!tenantSearch.trim() || tenantSearch.length < 2) { setTenantResults([]); return; }
    const t = setTimeout(async () => {
      setTenantSearching(true);
      try {
        const { data } = await api.get('/tenants', { params: { search: tenantSearch, limit: 20, status: 'active' } });
        setTenantResults(data.data ?? data.tenants ?? []);
      } catch { setTenantResults([]); }
      finally { setTenantSearching(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [tenantSearch]);

  // Load cashbooks once on mount
  useEffect(() => {
    (async () => {
      setCashbooksLoading(true);
      try {
        const { data } = await api.get('/chart-of-accounts', { params: { type: 'Bank' } });
        const banks: CashbookOption[] = Array.isArray(data) ? data.map((a: any) => ({ _id: a._id, name: a.name, code: a.code })) : [];
        if (banks.length > 0) {
          setCashbooks(banks);
          setCashbookId(banks[0]._id);
          setCashbookName(`${banks[0].code ? banks[0].code + ' · ' : ''}${banks[0].name}`);
        }
      } catch {
        // no cashbooks loaded — user can proceed with directToLandlord
      }
      finally { setCashbooksLoading(false); }
    })();
  }, []);

  const selectTenant = (t: TenantOption) => {
    setTenantId(t._id);
    setTenantName(t.name);
    setUnitId(t.unit?._id ?? '');
    setTenantSearch('');
    setTenantResults([]);
    setShowTenantPicker(false);
  };

  const validate = () => {
    if (!tenantId)              { Alert.alert('Missing', 'Please select a tenant.'); return false; }
    if (!unitId)                { Alert.alert('Missing', 'Selected tenant has no unit. Contact admin.'); return false; }
    if (!amount || Number(amount) <= 0) { Alert.alert('Missing', 'Enter a valid amount.'); return false; }
    if (!refNumber.trim())      { Alert.alert('Missing', 'Reference number is required.'); return false; }
    if (!directToLandlord && !cashbookId) { Alert.alert('Missing', 'Please select a cashbook or mark as paid to landlord.'); return false; }
    return true;
  };

  const submit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const body: Record<string, any> = {
        tenant:          tenantId,
        unit:            unitId,
        amount:          Number(amount),
        referenceNumber: refNumber.trim(),
        paymentType,
        paymentDate:     new Date(paymentDate).toISOString(),
        paidDirectToLandlord: directToLandlord,
      };
      if (!directToLandlord && cashbookId) body.cashbook = cashbookName.replace(/^[^·]*·\s*/, '');

      await api.post('/rent-payments', body);
      Alert.alert('Success', 'Receipt recorded successfully.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Failed to record receipt. Please try again.';
      Alert.alert('Error', msg);
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
        {/* Tenant picker */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>TENANT *</Text>
          {tenantId ? (
            <TouchableOpacity style={styles.selectedChip} onPress={() => { setTenantId(''); setTenantName(''); setUnitId(''); }}>
              <Ionicons name="person" size={14} color={Colors.primary} />
              <Text style={styles.selectedChipText}>{tenantName}</Text>
              <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.inputRow} onPress={() => setShowTenantPicker(true)}>
              <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
              <Text style={[styles.inputText, { color: Colors.textMuted }]}>Search tenant...</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Amount */}
        <View style={styles.fieldGroup}>
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

        {/* Reference number */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>REFERENCE NUMBER *</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.inputText, { flex: 1 }]}
              placeholder="M-Pesa code, bank ref..."
              placeholderTextColor={Colors.textMuted}
              value={refNumber}
              onChangeText={setRefNumber}
              autoCapitalize="characters"
            />
          </View>
        </View>

        {/* Payment type */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>PAYMENT TYPE *</Text>
          <View style={styles.pillRow}>
            {PAYMENT_TYPES.map(pt => (
              <TouchableOpacity
                key={pt.value}
                style={[styles.pill, paymentType === pt.value && styles.pillActive]}
                onPress={() => setPaymentType(pt.value)}
              >
                <Text style={[styles.pillText, paymentType === pt.value && styles.pillTextActive]}>
                  {pt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Payment date */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>PAYMENT DATE *</Text>
          <View style={styles.inputRow}>
            <Ionicons name="calendar-outline" size={16} color={Colors.textMuted} />
            <TextInput
              style={[styles.inputText, { flex: 1 }]}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.textMuted}
              value={paymentDate}
              onChangeText={setPaymentDate}
              keyboardType="numeric"
            />
          </View>
        </View>

        {/* Cashbook */}
        {!directToLandlord && (
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>CASHBOOK *</Text>
            {cashbooksLoading ? (
              <ActivityIndicator size="small" color={Colors.primary} style={{ alignSelf: 'flex-start', marginTop: 8 }} />
            ) : cashbooks.length > 0 ? (
              <TouchableOpacity style={styles.inputRow} onPress={() => setShowCashbookPicker(true)}>
                <Ionicons name="wallet-outline" size={16} color={Colors.textMuted} />
                <Text style={[styles.inputText, { flex: 1, color: cashbookId ? Colors.text : Colors.textMuted }]}>
                  {cashbookName || 'Select cashbook...'}
                </Text>
                <Ionicons name="chevron-down" size={14} color={Colors.textMuted} />
              </TouchableOpacity>
            ) : (
              <Text style={styles.helperText}>No cashbooks found. Enable "Paid to Landlord" below.</Text>
            )}
          </View>
        )}

        {/* Direct to landlord toggle */}
        <TouchableOpacity style={styles.toggle} onPress={() => setDirectToLandlord(v => !v)}>
          <View style={[styles.toggleBox, directToLandlord && styles.toggleBoxActive]}>
            {directToLandlord && <Ionicons name="checkmark" size={14} color={Colors.white} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Paid directly to landlord</Text>
            <Text style={styles.helperText}>No cashbook required if payment went directly to the landlord</Text>
          </View>
        </TouchableOpacity>

        {/* Submit button */}
        <TouchableOpacity
          style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
          onPress={submit}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator size="small" color={Colors.white} />
            : <Text style={styles.submitText}>Record Payment</Text>}
        </TouchableOpacity>
      </ScrollView>

      {/* Tenant picker modal */}
      <Modal visible={showTenantPicker} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Tenant</Text>
            <TouchableOpacity onPress={() => setShowTenantPicker(false)}>
              <Ionicons name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.modalSearch}>
            <View style={styles.inputRow}>
              <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
              <TextInput
                style={[styles.inputText, { flex: 1 }]}
                placeholder="Type tenant name..."
                placeholderTextColor={Colors.textMuted}
                value={tenantSearch}
                onChangeText={setTenantSearch}
                autoFocus
              />
              {tenantSearching && <ActivityIndicator size="small" color={Colors.primary} />}
            </View>
          </View>
          <FlatList
            data={tenantResults}
            keyExtractor={item => item._id}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.optionRow} onPress={() => selectTenant(item)}>
                <View style={styles.optionAvatar}>
                  <Text style={styles.optionAvatarText}>{item.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionLabel}>{item.name}</Text>
                  {item.unit?.unitNumber && (
                    <Text style={styles.optionMeta}>Unit {item.unit.unitNumber}</Text>
                  )}
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              tenantSearch.length >= 2 && !tenantSearching ? (
                <View style={{ padding: 24, alignItems: 'center' }}>
                  <Text style={{ color: Colors.textMuted }}>No tenants found</Text>
                </View>
              ) : null
            }
          />
        </SafeAreaView>
      </Modal>

      {/* Cashbook picker modal */}
      <Modal visible={showCashbookPicker} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Cashbook</Text>
            <TouchableOpacity onPress={() => setShowCashbookPicker(false)}>
              <Ionicons name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={cashbooks}
            keyExtractor={item => item._id}
            contentContainerStyle={{ padding: 16, gap: 8 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.optionRow, cashbookId === item._id && { borderColor: Colors.primary }]}
                onPress={() => {
                  setCashbookId(item._id);
                  setCashbookName(`${item.code ? item.code + ' · ' : ''}${item.name}`);
                  setShowCashbookPicker(false);
                }}
              >
                <Ionicons name="wallet-outline" size={20} color={cashbookId === item._id ? Colors.primary : Colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionLabel}>{item.name}</Text>
                  {item.code && <Text style={styles.optionMeta}>{item.code}</Text>}
                </View>
                {cashbookId === item._id && <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />}
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 20, gap: 20, paddingBottom: 60 },

  fieldGroup: { gap: 6 },
  label:      { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted },

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

  toggle: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    padding: 14,
  },
  toggleBox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  toggleBoxActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  toggleLabel:     { fontSize: 14, fontWeight: '600', color: Colors.text },
  helperText:      { fontSize: 12, color: Colors.textMuted, marginTop: 2 },

  submitBtn: {
    backgroundColor: Colors.primary, borderRadius: 14,
    height: 52, alignItems: 'center', justifyContent: 'center',
    marginTop: 8,
  },
  submitText: { color: Colors.white, fontSize: 16, fontWeight: '800' },

  // Modals
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  modalTitle:  { fontSize: 17, fontWeight: '800', color: Colors.text },
  modalSearch: { padding: 16 },

  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    padding: 14, marginBottom: 8,
  },
  optionAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.primaryFaded,
    alignItems: 'center', justifyContent: 'center',
  },
  optionAvatarText: { fontSize: 16, fontWeight: '800', color: Colors.primary },
  optionLabel:      { fontSize: 14, fontWeight: '600', color: Colors.text },
  optionMeta:       { fontSize: 12, color: Colors.textMuted },
});
