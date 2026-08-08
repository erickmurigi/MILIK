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
  _id: string; name: string;
  unit?: { _id?: string; unitNumber?: string; property?: { _id?: string; propertyName?: string } };
};

const UTILITY_TYPES = ['Water', 'Electricity', 'Gas'];

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const currentPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function NewMeterReadingScreen() {
  const router = useRouter();

  // Tenant picker
  const [tenantId,   setTenantId]   = useState('');
  const [tenantName, setTenantName] = useState('');
  const [unitId,     setUnitId]     = useState('');
  const [propId,     setPropId]     = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [tSearch,    setTSearch]    = useState('');
  const [tResults,   setTResults]   = useState<TenantOption[]>([]);
  const [tSearching, setTSearching] = useState(false);

  // Form fields
  const [utilityType,   setUtilityType]   = useState('Water');
  const [billingPeriod, setBillingPeriod] = useState(currentPeriod());
  const [readingDate,   setReadingDate]   = useState(todayStr());
  const [prevReading,   setPrevReading]   = useState('');
  const [currReading,   setCurrReading]   = useState('');
  const [ratePerUnit,   setRatePerUnit]   = useState('');

  const [submitting, setSubmitting] = useState(false);

  // Computed consumption
  const consumption = Math.max(0, Number(currReading || 0) - Number(prevReading || 0));
  const estimatedAmount = consumption * Number(ratePerUnit || 0);

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
    setPropId(t.unit?.property?._id ?? '');
    setTSearch('');
    setTResults([]);
    setShowPicker(false);
  };

  const validate = () => {
    if (!tenantId)                        { Alert.alert('Missing', 'Please select a tenant.'); return false; }
    if (!unitId)                          { Alert.alert('Missing', 'Tenant has no unit assigned.'); return false; }
    if (!currReading && currReading !== '0') { Alert.alert('Missing', 'Enter the current meter reading.'); return false; }
    if (Number(currReading) < Number(prevReading || 0)) {
      Alert.alert('Invalid', 'Current reading cannot be less than the previous reading.');
      return false;
    }
    if (!ratePerUnit || Number(ratePerUnit) <= 0) { Alert.alert('Missing', 'Enter the rate per unit.'); return false; }
    return true;
  };

  const submit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      await api.post('/meter-readings', {
        tenant:          tenantId,
        unit:            unitId,
        property:        propId || undefined,
        utilityType,
        billingPeriod,
        readingDate:     new Date(readingDate).toISOString(),
        previousReading: Number(prevReading || 0),
        currentReading:  Number(currReading),
        ratePerUnit:     Number(ratePerUnit),
      });
      Alert.alert('Reading Saved', 'Meter reading has been recorded.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to save reading.');
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
            <TouchableOpacity style={styles.selectedChip} onPress={() => { setTenantId(''); setTenantName(''); setUnitId(''); }}>
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

        {/* Utility type */}
        <View style={styles.field}>
          <Text style={styles.label}>UTILITY TYPE *</Text>
          <View style={styles.pillRow}>
            {UTILITY_TYPES.map(u => (
              <TouchableOpacity
                key={u}
                style={[styles.pill, utilityType === u && styles.pillActive]}
                onPress={() => setUtilityType(u)}
              >
                <Ionicons
                  name={u === 'Water' ? 'water-outline' : u === 'Electricity' ? 'flash-outline' : 'flame-outline' as any}
                  size={14}
                  color={utilityType === u ? Colors.white : Colors.textSecondary}
                />
                <Text style={[styles.pillText, utilityType === u && styles.pillTextActive]}>{u}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Billing period */}
        <View style={styles.field}>
          <Text style={styles.label}>BILLING PERIOD *</Text>
          <View style={styles.inputRow}>
            <Ionicons name="calendar-outline" size={16} color={Colors.textMuted} />
            <TextInput
              style={[styles.inputText, { flex: 1 }]}
              placeholder="YYYY-MM"
              placeholderTextColor={Colors.textMuted}
              value={billingPeriod}
              onChangeText={setBillingPeriod}
              keyboardType="numeric"
            />
          </View>
        </View>

        {/* Reading date */}
        <View style={styles.field}>
          <Text style={styles.label}>READING DATE *</Text>
          <View style={styles.inputRow}>
            <Ionicons name="calendar-outline" size={16} color={Colors.textMuted} />
            <TextInput
              style={[styles.inputText, { flex: 1 }]}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.textMuted}
              value={readingDate}
              onChangeText={setReadingDate}
              keyboardType="numeric"
            />
          </View>
        </View>

        {/* Readings row */}
        <View style={styles.readingsRow}>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.label}>PREVIOUS READING</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.inputText, { flex: 1 }]}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={Colors.textMuted}
                value={prevReading}
                onChangeText={setPrevReading}
              />
            </View>
          </View>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.label}>CURRENT READING *</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.inputText, { flex: 1 }]}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={Colors.textMuted}
                value={currReading}
                onChangeText={setCurrReading}
              />
            </View>
          </View>
        </View>

        {/* Rate */}
        <View style={styles.field}>
          <Text style={styles.label}>RATE PER UNIT (KES) *</Text>
          <View style={styles.inputRow}>
            <Text style={styles.prefix}>KES</Text>
            <TextInput
              style={[styles.inputText, { flex: 1 }]}
              keyboardType="numeric"
              placeholder="0.00"
              placeholderTextColor={Colors.textMuted}
              value={ratePerUnit}
              onChangeText={setRatePerUnit}
            />
          </View>
        </View>

        {/* Computed summary */}
        {(currReading || prevReading) && (
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Consumption</Text>
              <Text style={styles.summaryValue}>{consumption} units</Text>
            </View>
            {ratePerUnit ? (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Estimated Bill</Text>
                <Text style={[styles.summaryValue, { color: Colors.primary, fontWeight: '900' }]}>
                  KES {estimatedAmount.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                </Text>
              </View>
            ) : null}
          </View>
        )}

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
                  {item.unit?.unitNumber && <Text style={styles.optionMeta}>Unit {item.unit.unitNumber}</Text>}
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

  pillRow: { flexDirection: 'row', gap: 8 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  pillActive:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillText:       { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  pillTextActive: { color: Colors.white },

  readingsRow: { flexDirection: 'row', gap: 12 },

  summaryCard: {
    backgroundColor: Colors.primaryFaded, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.primary + '30',
    padding: 16, gap: 10,
  },
  summaryRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontSize: 13, color: Colors.textSecondary, fontWeight: '600' },
  summaryValue: { fontSize: 15, fontWeight: '700', color: Colors.text },

  submitBtn: {
    backgroundColor: Colors.primary, borderRadius: 14,
    height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  submitText: { color: Colors.white, fontSize: 16, fontWeight: '800' },

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
