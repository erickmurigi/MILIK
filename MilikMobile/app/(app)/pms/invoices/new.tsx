import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import { Dropdown, DropdownItem } from '../../../../components/ui/Dropdown';
import { DateField } from '../../../../components/ui/DateField';
import { apiError, cleanDecimal, fmtMoney, todayISO } from '../../../../utils/pmsFormat';

// Only categories the server accepts for a booked invoice (TENANT_INVOICE_CATEGORIES).
// Debit notes are a separate document type (/tenant-invoices/notes) and are not booked here.
const CATEGORIES = [
  { value: 'RENT_CHARGE',    label: 'Rent'    },
  { value: 'UTILITY_CHARGE', label: 'Utility' },
  { value: 'DEPOSIT_CHARGE', label: 'Deposit' },
];

type UnitOption = { _id: string; unitNumber?: string; propertyId?: string; propertyName?: string };

type TenantItem = DropdownItem & { _units: UnitOption[] };

const unitsOfTenant = (t: any): UnitOption[] =>
  [t?.unit, ...(Array.isArray(t?.additionalUnits) ? t.additionalUnits : [])]
    .filter((u: any) => u && u._id)
    .map((u: any) => ({
      _id:          String(u._id),
      unitNumber:   u.unitNumber,
      propertyId:   u.property?._id ? String(u.property._id) : undefined,
      propertyName: u.property?.propertyName,
    }));

const toTenantItem = (t: any): TenantItem => {
  const units = unitsOfTenant(t);
  const first = units[0];
  return {
    _id:      String(t._id),
    label:    t.name || 'Unnamed tenant',
    sublabel: first?.unitNumber
      ? `Unit ${first.unitNumber}${first.propertyName ? ' · ' + first.propertyName : ''}`
      : undefined,
    _units:   units,
  };
};

export default function NewInvoiceScreen() {
  const router = useRouter();
  const { tenant: tenantParam } = useLocalSearchParams<{ tenant?: string }>();

  // ── Property dropdown ────────────────────────────────────────────────────
  const [properties,       setProperties]       = useState<DropdownItem[]>([]);
  const [propsLoading,     setPropsLoading]     = useState(false);
  const [selectedPropId,   setSelectedPropId]   = useState('');
  const [selectedPropLabel,setSelectedPropLabel] = useState('');
  const [propOpen,         setPropOpen]         = useState(false);

  // ── Tenant dropdown ──────────────────────────────────────────────────────
  const [tenants,        setTenants]        = useState<TenantItem[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);
  const [tenantId,       setTenantId]       = useState('');
  const [tenantLabel,    setTenantLabel]    = useState('');
  const [tenantUnits,    setTenantUnits]    = useState<UnitOption[]>([]);
  const [unitId,         setUnitId]         = useState('');
  const [tenantOpen,     setTenantOpen]     = useState(false);

  // ── Form ─────────────────────────────────────────────────────────────────
  const [category,    setCategory]    = useState('RENT_CHARGE');
  const [amount,      setAmount]      = useState('');
  const [description, setDescription] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [dueDate,     setDueDate]     = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const submittingRef = useRef(false);

  const applyTenant = useCallback((t: TenantItem) => {
    setTenantId(t._id);
    setTenantLabel(t.label);
    setTenantUnits(t._units);
    setUnitId(t._units[0]?._id ?? '');
    setTenantOpen(false);
  }, []);

  // Load properties
  useEffect(() => {
    setPropsLoading(true);
    api.get('/properties', { params: { limit: 200, status: 'active' } })
      .then(({ data }) =>
        setProperties(
          (Array.isArray(data?.data) ? data.data : []).map((p: any) => ({
            _id: String(p._id), label: p.propertyName, sublabel: p.propertyCode,
          }))
        )
      )
      .catch(() => {})
      .finally(() => setPropsLoading(false));
  }, []);

  // Pre-select the tenant when opened from a tenant profile
  useEffect(() => {
    if (!tenantParam) return;
    api.get(`/tenants/${tenantParam}`)
      .then(({ data }) => {
        const t = data?.data ?? data;
        if (t?._id) applyTenant(toTenantItem(t));
      })
      .catch(() => {});
  }, [tenantParam, applyTenant]);

  // Load active tenants (server caps a page at 500), narrowed by property when one is selected
  const loadTenants = useCallback((propId: string) => {
    setTenantsLoading(true);
    const params: Record<string, string | number> = { limit: 500, status: 'active' };
    if (propId) params.property = propId;
    api.get('/tenants', { params })
      .then(({ data }) => setTenants((Array.isArray(data?.data) ? data.data : []).map(toTenantItem)))
      .catch(() => setTenants([]))
      .finally(() => setTenantsLoading(false));
  }, []);

  useEffect(() => { loadTenants(selectedPropId); }, [selectedPropId, loadTenants]);

  const clearTenant = () => {
    setTenantId(''); setTenantLabel(''); setTenantUnits([]); setUnitId('');
  };

  const selectProperty = (item: DropdownItem) => {
    setSelectedPropId(item._id);
    setSelectedPropLabel(item.label);
    clearTenant();
    setPropOpen(false);
  };

  const submit = async () => {
    if (submittingRef.current) return;
    const value = Number(amount);
    const today = todayISO();

    if (!tenantId)                       { Alert.alert('Select a tenant', 'Choose the tenant this invoice is for.'); return; }
    const unit = tenantUnits.find(u => u._id === unitId);
    if (!unit)                           { Alert.alert('No unit', 'This tenant has no unit assigned, so an invoice cannot be booked.'); return; }
    if (!unit.propertyId)                { Alert.alert('No property', "The tenant's unit is not linked to a property."); return; }
    if (!Number.isFinite(value) || value <= 0) { Alert.alert('Enter an amount', 'The amount must be greater than zero.'); return; }
    if (!invoiceDate)                    { Alert.alert('Select a date', 'Choose the invoice date.'); return; }
    if (invoiceDate > today)             { Alert.alert('Invalid date', 'Future invoicing is disabled. Use today or an earlier billing date.'); return; }
    if (dueDate && dueDate < invoiceDate){ Alert.alert('Invalid due date', 'The due date cannot be before the invoice date.'); return; }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const { data } = await api.post('/tenant-invoices', {
        tenant:      tenantId,
        unit:        unit._id,
        property:    unit.propertyId,
        category,
        amount:      value,
        description: description.trim() || undefined,
        invoiceDate,
        bookingDate: invoiceDate,
        dueDate:     dueDate || invoiceDate,   // the server requires a due date
      });
      const credit = Number(data?.availableCredits ?? 0);
      const number = data?.invoiceNumber ? ` ${data.invoiceNumber}` : '';
      Alert.alert(
        'Invoice Created',
        `Invoice${number} has been booked successfully.` +
          (credit > 0.009 ? `\n\nThis tenant has KES ${fmtMoney(credit)} of unallocated credit on account.` : ''),
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (err) {
      Alert.alert('Could not create invoice', apiError(err, 'Failed to create invoice.'));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'New Invoice' }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
          onClear={() => { setSelectedPropId(''); setSelectedPropLabel(''); clearTenant(); }}
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
          onSelect={(item) => applyTenant(item as TenantItem)}
          onClear={clearTenant}
          loading={tenantsLoading}
          open={tenantOpen}
          onToggle={() => { setTenantOpen(o => !o); setPropOpen(false); }}
          required
          emptyText="No active tenants found"
        />

        {/* Unit — only when the tenant holds more than one */}
        {tenantUnits.length > 1 ? (
          <View style={styles.field}>
            <Text style={styles.label}>UNIT <Text style={{ color: Colors.danger }}>*</Text></Text>
            <View style={styles.pillRow}>
              {tenantUnits.map(u => (
                <TouchableOpacity
                  key={u._id}
                  style={[styles.pill, unitId === u._id && styles.pillActive]}
                  onPress={() => setUnitId(u._id)}
                >
                  <Text style={[styles.pillText, unitId === u._id && styles.pillTextActive]}>
                    {u.unitNumber ? `Unit ${u.unitNumber}` : 'Unit'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}

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
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={Colors.textMuted}
              value={amount}
              onChangeText={t => setAmount(cleanDecimal(t))}
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
        <Text style={styles.helper}>If no due date is chosen, the invoice date is used.</Text>

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
      </KeyboardAvoidingView>
    </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 20, gap: 18, paddingBottom: 60 },

  field:  { gap: 6 },
  label:  { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted },
  helper: { fontSize: 12, color: Colors.textMuted, marginTop: -10 },

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
