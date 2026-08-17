import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import { Dropdown, DropdownItem } from '../../../../components/ui/Dropdown';
import { DateField } from '../../../../components/ui/DateField';

const CATEGORIES = [
  { value: 'RENT_CHARGE',    label: 'Rent'        },
  { value: 'UTILITY_CHARGE', label: 'Utility'     },
  { value: 'DEPOSIT_CHARGE', label: 'Deposit'     },
  { value: 'PENALTY_CHARGE', label: 'Late Penalty' },
  { value: 'DEBIT_NOTE',     label: 'Debit Note'  },
];

const pad2  = (n: number) => String(n).padStart(2, '0');
const today = new Date();
const todayStr = `${today.getFullYear()}-${pad2(today.getMonth()+1)}-${pad2(today.getDate())}`;

export default function NewInvoiceScreen() {
  const router = useRouter();

  // ── Property dropdown ────────────────────────────────────────────────────
  const [properties,       setProperties]      = useState<DropdownItem[]>([]);
  const [propsLoading,     setPropsLoading]    = useState(false);
  const [selectedPropId,   setSelectedPropId]  = useState('');
  const [selectedPropLabel,setSelectedPropLabel] = useState('');
  const [propOpen,         setPropOpen]         = useState(false);

  // ── Tenant dropdown ──────────────────────────────────────────────────────
  const [tenants,        setTenants]        = useState<any[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);
  const [tenantId,       setTenantId]       = useState('');
  const [tenantLabel,    setTenantLabel]    = useState('');
  const [unitId,         setUnitId]         = useState('');
  const [propertyId,     setPropertyId]     = useState('');
  const [tenantOpen,     setTenantOpen]     = useState(false);

  // ── Form ─────────────────────────────────────────────────────────────────
  const [category,    setCategory]    = useState('RENT_CHARGE');
  const [amount,      setAmount]      = useState('');
  const [description, setDescription] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayStr);
  const [dueDate,     setDueDate]     = useState('');
  const [submitting,  setSubmitting]  = useState(false);

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

  // Load tenants (filtered by property when selected)
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
            _unit:   t.unit?._id,
            _propId: t.unit?.property?._id,
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
    setTenantId(''); setTenantLabel(''); setUnitId(''); setPropertyId('');
    setPropOpen(false);
  };

  const selectTenant = (item: any) => {
    setTenantId(item._id);
    setTenantLabel(item.label);
    setUnitId(item._unit ?? '');
    setPropertyId(item._propId ?? '');
    setTenantOpen(false);
  };

  const submit = async () => {
    if (!tenantId)                     { Alert.alert('Missing', 'Please select a tenant.'); return; }
    if (!unitId)                       { Alert.alert('Missing', 'Tenant has no unit assigned.'); return; }
    if (!amount || Number(amount) <= 0){ Alert.alert('Missing', 'Enter a valid amount.'); return; }
    if (!invoiceDate)                  { Alert.alert('Missing', 'Select an invoice date.'); return; }

    setSubmitting(true);
    try {
      await api.post('/tenant-invoices', {
        tenant:      tenantId,
        unit:        unitId,
        property:    propertyId || selectedPropId || undefined,
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
    } finally { setSubmitting(false); }
  };

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
          onClear={() => { setSelectedPropId(''); setSelectedPropLabel(''); setTenantId(''); setTenantLabel(''); setUnitId(''); setPropertyId(''); }}
          loading={propsLoading}
          open={propOpen}
          onToggle={() => { setPropOpen(o => !o); setTenantOpen(false); }}
        />

        {/* Tenant */}
        <Dropdown
          label="TENANT"
          placeholder="Select tenant…"
          selectedId={tenantId}
          selectedLabel={tenantLabel}
          items={tenants}
          onSelect={selectTenant}
          onClear={() => { setTenantId(''); setTenantLabel(''); setUnitId(''); setPropertyId(''); }}
          loading={tenantsLoading}
          open={tenantOpen}
          onToggle={() => { setTenantOpen(o => !o); setPropOpen(false); }}
          required
          emptyText="No active tenants found"
        />

        {/* Charge type */}
        <View style={styles.field}>
          <Text style={styles.label}>CHARGE TYPE <Text style={{ color: Colors.danger }}>*</Text></Text>
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

        {/* Description */}
        <View style={styles.field}>
          <Text style={styles.label}>DESCRIPTION</Text>
          <View style={[styles.inputBox, { height: 'auto' as any, paddingVertical: 12, alignItems: 'flex-start' }]}>
            <TextInput
              style={[styles.inputText, { flex: 1, minHeight: 56 }]}
              placeholder="Optional notes…"
              placeholderTextColor={Colors.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              textAlignVertical="top"
            />
          </View>
        </View>

        {/* Invoice date */}
        <DateField label="INVOICE DATE" value={invoiceDate} onChange={setInvoiceDate} required />

        {/* Due date */}
        <DateField label="DUE DATE" value={dueDate} onChange={setDueDate} optional />

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 20, gap: 18, paddingBottom: 60 },

  field:  { gap: 6 },
  label:  { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 20, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  pillActive:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillText:       { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  pillTextActive: { color: Colors.white },

  inputBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.border,
    paddingHorizontal: 14, height: 50,
  },
  inputText: { fontSize: 14, color: Colors.text },
  prefix:    { fontSize: 13, fontWeight: '700', color: Colors.textMuted },

  submitBtn: {
    backgroundColor: Colors.primary, borderRadius: 14,
    height: 54, alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  submitText: { color: Colors.white, fontSize: 16, fontWeight: '800' },
});
