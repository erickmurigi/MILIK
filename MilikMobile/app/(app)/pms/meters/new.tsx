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

const UTILITY_TYPES = [
  { key: 'Water',       icon: 'water-outline'  },
  { key: 'Electricity', icon: 'flash-outline'  },
  { key: 'Gas',         icon: 'flame-outline'  },
] as const;

const MONTHS_FULL = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
const today = new Date();
const pad2  = (n: number) => String(n).padStart(2, '0');

export default function NewMeterReadingScreen() {
  const router = useRouter();

  // ── Property dropdown ────────────────────────────────────────────────────
  const [properties,      setProperties]     = useState<DropdownItem[]>([]);
  const [propsLoading,    setPropsLoading]   = useState(false);
  const [selectedPropId,  setSelectedPropId] = useState('');
  const [selectedPropLabel, setSelectedPropLabel] = useState('');
  const [propOpen, setPropOpen] = useState(false);

  // ── Tenant dropdown ──────────────────────────────────────────────────────
  const [tenants,        setTenants]        = useState<any[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);
  const [tenantId,       setTenantId]       = useState('');
  const [tenantLabel,    setTenantLabel]    = useState('');
  const [tenantUnitId,   setTenantUnitId]   = useState('');
  const [tenantPropId,   setTenantPropId]   = useState('');
  const [tenantOpen,     setTenantOpen]     = useState(false);

  // ── Other form fields ────────────────────────────────────────────────────
  const [utilityType,  setUtilityType] = useState<'Water'|'Electricity'|'Gas'>('Water');
  const [bpYear,       setBpYear]      = useState(today.getFullYear());
  const [bpMonth,      setBpMonth]     = useState(today.getMonth() + 1);
  const [readingDate,  setReadingDate] = useState(
    `${today.getFullYear()}-${pad2(today.getMonth()+1)}-${pad2(today.getDate())}`
  );
  const [prevReading, setPrevReading] = useState('');
  const [currReading, setCurrReading] = useState('');
  const [ratePerUnit, setRatePerUnit] = useState('');
  const [submitting,  setSubmitting]  = useState(false);

  // Load properties on mount
  useEffect(() => {
    setPropsLoading(true);
    api.get('/properties', { params: { limit: 100 } })
      .then(({ data }) =>
        setProperties(
          (data.data ?? []).map((p: any) => ({
            _id: p._id, label: p.propertyName, sublabel: p.propertyCode,
          }))
        )
      )
      .catch(() => {})
      .finally(() => setPropsLoading(false));
  }, []);

  // Load tenants whenever property filter changes
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
            _unit:    t.unit?._id,
            _propId:  t.unit?.property?._id,
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
    setTenantId(''); setTenantLabel(''); setTenantUnitId(''); setTenantPropId('');
    setPropOpen(false);
  };

  const selectTenant = (item: any) => {
    setTenantId(item._id);
    setTenantLabel(item.label);
    setTenantUnitId(item._unit ?? '');
    setTenantPropId(item._propId ?? '');
    setTenantOpen(false);
  };

  const billingPeriod = `${bpYear}-${pad2(bpMonth)}`;
  const prevPeriod = () => bpMonth === 1 ? (setBpMonth(12), setBpYear(y => y-1)) : setBpMonth(m => m-1);
  const nextPeriod = () => bpMonth === 12? (setBpMonth(1),  setBpYear(y => y+1)) : setBpMonth(m => m+1);

  const consumption     = Math.max(0, Number(currReading||0) - Number(prevReading||0));
  const estimatedAmount = consumption * Number(ratePerUnit||0);

  const submit = async () => {
    if (!tenantId)    { Alert.alert('Missing', 'Please select a tenant.'); return; }
    if (!tenantUnitId){ Alert.alert('Missing', 'Tenant has no unit assigned.'); return; }
    if (!currReading && currReading !== '0') { Alert.alert('Missing', 'Enter the current meter reading.'); return; }
    if (Number(currReading) < Number(prevReading||0)) { Alert.alert('Invalid', 'Current reading cannot be less than previous.'); return; }
    if (!ratePerUnit || Number(ratePerUnit) <= 0) { Alert.alert('Missing', 'Enter the rate per unit.'); return; }

    setSubmitting(true);
    try {
      await api.post('/meter-readings', {
        tenant:          tenantId,
        unit:            tenantUnitId,
        property:        tenantPropId || selectedPropId || undefined,
        utilityType,
        billingPeriod,
        readingDate:     new Date(readingDate).toISOString(),
        previousReading: Number(prevReading||0),
        currentReading:  Number(currReading),
        ratePerUnit:     Number(ratePerUnit),
      });
      Alert.alert('Saved', 'Meter reading recorded.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to save reading.');
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
          onClear={() => { setSelectedPropId(''); setSelectedPropLabel(''); setTenantId(''); setTenantLabel(''); setTenantUnitId(''); setTenantPropId(''); }}
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
          onClear={() => { setTenantId(''); setTenantLabel(''); setTenantUnitId(''); setTenantPropId(''); }}
          loading={tenantsLoading}
          open={tenantOpen}
          onToggle={() => { setTenantOpen(o => !o); setPropOpen(false); }}
          required
          emptyText="No active tenants found"
        />

        {/* Utility type */}
        <View style={styles.field}>
          <Text style={styles.label}>UTILITY TYPE <Text style={{ color: Colors.danger }}>*</Text></Text>
          <View style={styles.pillRow}>
            {UTILITY_TYPES.map(u => (
              <TouchableOpacity
                key={u.key}
                style={[styles.pill, utilityType === u.key && styles.pillActive]}
                onPress={() => setUtilityType(u.key)}
              >
                <Ionicons name={u.icon as any} size={16} color={utilityType === u.key ? Colors.white : Colors.textSecondary} />
                <Text style={[styles.pillText, utilityType === u.key && styles.pillTextActive]}>{u.key}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Billing period */}
        <View style={styles.field}>
          <Text style={styles.label}>BILLING PERIOD <Text style={{ color: Colors.danger }}>*</Text></Text>
          <View style={styles.pickerRow}>
            <TouchableOpacity style={styles.pickerArrow} onPress={prevPeriod}>
              <Ionicons name="chevron-back" size={20} color={Colors.primary} />
            </TouchableOpacity>
            <View style={styles.pickerCenter}>
              <Text style={styles.pickerValue}>{MONTHS_FULL[bpMonth-1]} {bpYear}</Text>
              <Text style={styles.pickerSub}>{billingPeriod}</Text>
            </View>
            <TouchableOpacity style={styles.pickerArrow} onPress={nextPeriod}>
              <Ionicons name="chevron-forward" size={20} color={Colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Reading date */}
        <DateField label="READING DATE" value={readingDate} onChange={setReadingDate} required />

        {/* Readings */}
        <View style={styles.readingsRow}>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.label}>PREVIOUS</Text>
            <View style={styles.inputBox}>
              <TextInput
                style={styles.inputText}
                keyboardType="numeric" placeholder="0"
                placeholderTextColor={Colors.textMuted}
                value={prevReading} onChangeText={setPrevReading}
              />
            </View>
          </View>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.label}>CURRENT <Text style={{ color: Colors.danger }}>*</Text></Text>
            <View style={[styles.inputBox, { borderColor: Colors.primary }]}>
              <TextInput
                style={styles.inputText}
                keyboardType="numeric" placeholder="0"
                placeholderTextColor={Colors.textMuted}
                value={currReading} onChangeText={setCurrReading}
              />
            </View>
          </View>
        </View>

        {/* Rate */}
        <View style={styles.field}>
          <Text style={styles.label}>RATE PER UNIT (KES) <Text style={{ color: Colors.danger }}>*</Text></Text>
          <View style={styles.inputBox}>
            <Text style={styles.prefix}>KES</Text>
            <TextInput
              style={[styles.inputText, { flex: 1 }]}
              keyboardType="numeric" placeholder="0.00"
              placeholderTextColor={Colors.textMuted}
              value={ratePerUnit} onChangeText={setRatePerUnit}
            />
          </View>
        </View>

        {/* Summary card */}
        {(currReading || prevReading) ? (
          <View style={styles.summary}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Consumption</Text>
              <Text style={styles.summaryValue}>{consumption} units</Text>
            </View>
            {ratePerUnit ? (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Estimated Bill</Text>
                <Text style={[styles.summaryValue, { color: Colors.primary }]}>
                  KES {estimatedAmount.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
          onPress={submit}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator size="small" color={Colors.white} />
            : <Text style={styles.submitText}>Save Reading</Text>}
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

  pillRow: { flexDirection: 'row', gap: 8 },
  pill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  pillActive:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillText:       { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  pillTextActive: { color: Colors.white },

  pickerRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.border, overflow: 'hidden',
  },
  pickerArrow:  { width: 48, height: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primaryFaded },
  pickerCenter: { flex: 1, alignItems: 'center', gap: 2 },
  pickerValue:  { fontSize: 15, fontWeight: '800', color: Colors.text },
  pickerSub:    { fontSize: 11, color: Colors.textMuted },

  readingsRow: { flexDirection: 'row', gap: 12 },

  inputBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.border,
    paddingHorizontal: 14, height: 50,
  },
  inputText: { flex: 1, fontSize: 15, color: Colors.text },
  prefix:    { fontSize: 13, fontWeight: '700', color: Colors.textMuted },

  summary: {
    backgroundColor: Colors.primaryFaded, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.primary + '30',
    padding: 16, gap: 10,
  },
  summaryRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontSize: 13, color: Colors.textSecondary, fontWeight: '600' },
  summaryValue: { fontSize: 15, fontWeight: '800', color: Colors.text },

  submitBtn: {
    backgroundColor: Colors.primary, borderRadius: 14,
    height: 54, alignItems: 'center', justifyContent: 'center',
  },
  submitText: { color: Colors.white, fontSize: 16, fontWeight: '800' },
});
