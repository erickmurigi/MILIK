import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import { Dropdown, DropdownItem } from '../../../../components/ui/Dropdown';
import { DateField } from '../../../../components/ui/DateField';

const PAYMENT_TYPES = [
  { value: 'rent',     label: 'Rent'     },
  { value: 'deposit',  label: 'Deposit'  },
  { value: 'utility',  label: 'Utility'  },
  { value: 'late_fee', label: 'Late Fee' },
  { value: 'other',    label: 'Other'    },
];

const pad2  = (n: number) => String(n).padStart(2, '0');
const today = new Date();
const todayStr = `${today.getFullYear()}-${pad2(today.getMonth()+1)}-${pad2(today.getDate())}`;

export default function NewReceiptScreen() {
  const router = useRouter();

  // ── Property dropdown ────────────────────────────────────────────────────
  const [properties,        setProperties]       = useState<DropdownItem[]>([]);
  const [propsLoading,      setPropsLoading]     = useState(false);
  const [selectedPropId,    setSelectedPropId]   = useState('');
  const [selectedPropLabel, setSelectedPropLabel]= useState('');
  const [propOpen,          setPropOpen]          = useState(false);

  // ── Tenant dropdown ──────────────────────────────────────────────────────
  const [tenants,        setTenants]        = useState<any[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);
  const [tenantId,       setTenantId]       = useState('');
  const [tenantLabel,    setTenantLabel]    = useState('');
  const [unitId,         setUnitId]         = useState('');
  const [tenantOpen,     setTenantOpen]     = useState(false);

  // ── Cashbook dropdown ────────────────────────────────────────────────────
  const [cashbooks,       setCashbooks]       = useState<DropdownItem[]>([]);
  const [cashbooksLoading,setCashbooksLoading]= useState(false);
  const [cashbookId,      setCashbookId]      = useState('');
  const [cashbookLabel,   setCashbookLabel]   = useState('');
  const [cashbookOpen,    setCashbookOpen]    = useState(false);

  // ── Form fields ──────────────────────────────────────────────────────────
  const [amount,           setAmount]           = useState('');
  const [refNumber,        setRefNumber]        = useState('');
  const [paymentType,      setPaymentType]      = useState('rent');
  const [paymentDate,      setPaymentDate]      = useState(todayStr);
  const [directToLandlord, setDirectToLandlord] = useState(false);
  const [submitting,       setSubmitting]       = useState(false);

  // Load properties
  useEffect(() => {
    setPropsLoading(true);
    api.get('/properties', { params: { limit: 100 } })
      .then(({ data }) =>
        setProperties(
          (data.data ?? []).map((p: any) => ({ _id: p._id, label: p.propertyName, sublabel: p.propertyCode }))
        )
      )
      .catch(() => {})
      .finally(() => setPropsLoading(false));
  }, []);

  // Load cashbooks once
  useEffect(() => {
    setCashbooksLoading(true);
    api.get('/chart-of-accounts', { params: { type: 'Bank' } })
      .then(({ data }) => {
        const banks: DropdownItem[] = (Array.isArray(data) ? data : []).map((a: any) => ({
          _id:      a._id,
          label:    a.name,
          sublabel: a.code,
        }));
        setCashbooks(banks);
        if (banks.length > 0) { setCashbookId(banks[0]._id); setCashbookLabel(banks[0].label); }
      })
      .catch(() => {})
      .finally(() => setCashbooksLoading(false));
  }, []);

  // Load tenants (filtered by property)
  const loadTenants = useCallback((propId: string) => {
    setTenantsLoading(true);
    const params: Record<string, string> = { limit: '100', status: 'active' };
    if (propId) params.property = propId;
    api.get('/tenants', { params })
      .then(({ data }) =>
        setTenants(
          (data.data ?? []).map((t: any) => ({
            _id: t._id,
            label: t.name,
            sublabel: t.unit?.unitNumber
              ? `Unit ${t.unit.unitNumber}${t.unit.property?.propertyName ? ' · ' + t.unit.property.propertyName : ''}`
              : undefined,
            _unit: t.unit?._id,
          }))
        )
      )
      .catch(() => setTenants([]))
      .finally(() => setTenantsLoading(false));
  }, []);

  useEffect(() => { loadTenants(selectedPropId); }, [selectedPropId, loadTenants]);

  const selectProperty = (item: DropdownItem) => {
    setSelectedPropId(item._id);
    setSelectedPropLabel(item.label);
    setTenantId(''); setTenantLabel(''); setUnitId('');
    setPropOpen(false);
  };

  const selectTenant = (item: any) => {
    setTenantId(item._id);
    setTenantLabel(item.label);
    setUnitId(item._unit ?? '');
    setTenantOpen(false);
  };

  const submit = async () => {
    if (!tenantId)                     { Alert.alert('Missing', 'Please select a tenant.'); return; }
    if (!unitId)                       { Alert.alert('Missing', 'Selected tenant has no unit.'); return; }
    if (!amount || Number(amount) <= 0){ Alert.alert('Missing', 'Enter a valid amount.'); return; }
    if (!refNumber.trim())             { Alert.alert('Missing', 'Reference number is required.'); return; }
    if (!directToLandlord && !cashbookId) { Alert.alert('Missing', 'Select a cashbook or mark as paid to landlord.'); return; }

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
      if (!directToLandlord && cashbookId) body.cashbook = cashbookLabel;

      await api.post('/rent-payments', body);
      Alert.alert('Success', 'Receipt recorded successfully.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to record receipt.');
    } finally { setSubmitting(false); }
  };

  const closeAll = () => { setPropOpen(false); setTenantOpen(false); setCashbookOpen(false); };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Property */}
        <Dropdown
          label="PROPERTY"
          placeholder="All properties"
          selectedId={selectedPropId}
          selectedLabel={selectedPropLabel}
          items={properties}
          onSelect={selectProperty}
          onClear={() => { setSelectedPropId(''); setSelectedPropLabel(''); setTenantId(''); setTenantLabel(''); setUnitId(''); }}
          loading={propsLoading}
          open={propOpen}
          onToggle={() => { setPropOpen(o => !o); setTenantOpen(false); setCashbookOpen(false); }}
        />

        {/* Tenant */}
        <Dropdown
          label="TENANT"
          placeholder="Select tenant…"
          selectedId={tenantId}
          selectedLabel={tenantLabel}
          items={tenants}
          onSelect={selectTenant}
          onClear={() => { setTenantId(''); setTenantLabel(''); setUnitId(''); }}
          loading={tenantsLoading}
          open={tenantOpen}
          onToggle={() => { setTenantOpen(o => !o); setPropOpen(false); setCashbookOpen(false); }}
          required
          emptyText="No active tenants found"
        />

        {/* Amount */}
        <View style={styles.field}>
          <Text style={styles.label}>AMOUNT (KES) <Text style={{ color: Colors.danger }}>*</Text></Text>
          <View style={styles.inputBox}>
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

        {/* Reference */}
        <View style={styles.field}>
          <Text style={styles.label}>REFERENCE NUMBER <Text style={{ color: Colors.danger }}>*</Text></Text>
          <View style={styles.inputBox}>
            <TextInput
              style={[styles.inputText, { flex: 1 }]}
              placeholder="M-Pesa code, bank ref…"
              placeholderTextColor={Colors.textMuted}
              value={refNumber}
              onChangeText={setRefNumber}
              autoCapitalize="characters"
            />
          </View>
        </View>

        {/* Payment type */}
        <View style={styles.field}>
          <Text style={styles.label}>PAYMENT TYPE <Text style={{ color: Colors.danger }}>*</Text></Text>
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
        <DateField label="PAYMENT DATE" value={paymentDate} onChange={setPaymentDate} required />

        {/* Cashbook */}
        {!directToLandlord && (
          <Dropdown
            label="CASHBOOK"
            placeholder="Select cashbook…"
            selectedId={cashbookId}
            selectedLabel={cashbookLabel}
            items={cashbooks}
            onSelect={(item) => { setCashbookId(item._id); setCashbookLabel(item.label); setCashbookOpen(false); }}
            loading={cashbooksLoading}
            open={cashbookOpen}
            onToggle={() => { setCashbookOpen(o => !o); setPropOpen(false); setTenantOpen(false); }}
            required
            emptyText="No cashbooks found"
          />
        )}

        {/* Direct to landlord */}
        <TouchableOpacity style={styles.toggle} onPress={() => setDirectToLandlord(v => !v)}>
          <View style={[styles.toggleBox, directToLandlord && styles.toggleBoxActive]}>
            {directToLandlord && <Ionicons name="checkmark" size={14} color={Colors.white} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Paid directly to landlord</Text>
            <Text style={styles.helperText}>No cashbook required</Text>
          </View>
        </TouchableOpacity>

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 20, gap: 18, paddingBottom: 60 },

  field:  { gap: 6 },
  label:  { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted },

  inputBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.border,
    paddingHorizontal: 14, height: 50,
  },
  inputText: { fontSize: 14, color: Colors.text },
  prefix:    { fontSize: 13, fontWeight: '700', color: Colors.textMuted },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 20, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  pillActive:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillText:       { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  pillTextActive: { color: Colors.white },

  toggle: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.border,
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
    height: 54, alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  submitText: { color: Colors.white, fontSize: 16, fontWeight: '800' },
});
