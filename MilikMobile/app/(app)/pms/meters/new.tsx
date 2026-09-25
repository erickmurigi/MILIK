import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import { Dropdown, DropdownItem } from '../../../../components/ui/Dropdown';
import { DateField } from '../../../../components/ui/DateField';
import { apiError, cleanDecimal, fmtKES, fmtNumber, todayISO } from '../../../../utils/pmsFormat';

const DEFAULT_UTILITIES = ['Water', 'Electricity', 'Gas'];

const UTILITY_ICONS: Record<string, string> = {
  water: 'water-outline', electricity: 'flash-outline', gas: 'flame-outline',
};

const MONTHS_FULL = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
const today = new Date();
const pad2  = (n: number) => String(n).padStart(2, '0');

type UnitUtility = { utility?: string; unitCharge?: number };
type UnitOption = DropdownItem & {
  tenantId?:   string;
  tenantName?: string;
  utilities:   UnitUtility[];
};
type PropertyOption = DropdownItem & {
  rates: { utilityType?: string; unitCost?: number; isActive?: boolean }[];
};
type CompanyUtility = { name?: string; unitCost?: number; isActive?: boolean };
type PastReading = { billingPeriod?: string; readingDate?: string; currentReading?: number; status?: string; property?: { _id?: string } | string };

const eq = (a?: string, b?: string) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

export default function NewMeterReadingScreen() {
  const router = useRouter();

  // ── Property → unit ──────────────────────────────────────────────────────
  const [properties,    setProperties]    = useState<PropertyOption[]>([]);
  const [propsLoading,  setPropsLoading]  = useState(false);
  const [property,      setProperty]      = useState<PropertyOption | null>(null);
  const [propOpen,      setPropOpen]      = useState(false);

  const [units,         setUnits]         = useState<UnitOption[]>([]);
  const [unitsLoading,  setUnitsLoading]  = useState(false);
  const [unit,          setUnit]          = useState<UnitOption | null>(null);
  const [unitOpen,      setUnitOpen]      = useState(false);

  const [companyUtilities, setCompanyUtilities] = useState<CompanyUtility[]>([]);

  // ── Form fields ──────────────────────────────────────────────────────────
  const [utilityType,  setUtilityType] = useState('Water');
  const [bpYear,       setBpYear]      = useState(today.getFullYear());
  const [bpMonth,      setBpMonth]     = useState(today.getMonth() + 1);
  const [readingDate,  setReadingDate] = useState(todayISO());
  const [prevReading,  setPrevReading] = useState('');
  const [currReading,  setCurrReading] = useState('');
  const [rate,         setRate]        = useState('');
  const [rateTouched,  setRateTouched] = useState(false);
  const [meterReset,   setMeterReset]  = useState(false);
  const [generateInvoice, setGenerateInvoice] = useState(false);
  const [submitting,   setSubmitting]  = useState(false);
  const submittingRef = useRef(false);

  const [pastReadings, setPastReadings] = useState<PastReading[]>([]);
  const billingPeriod = `${bpYear}-${pad2(bpMonth)}`;

  // Load properties + company utility rates once
  useEffect(() => {
    setPropsLoading(true);
    api.get('/properties', { params: { limit: 500 } })
      .then(({ data }) =>
        setProperties(
          (data.data ?? []).map((p: any) => ({
            _id: p._id, label: p.propertyName, sublabel: p.propertyCode, rates: p.utilityRates ?? [],
          }))
        )
      )
      .catch((err) => Alert.alert('Could not load properties', apiError(err, 'Failed to load properties.')))
      .finally(() => setPropsLoading(false));

    api.get('/utilities').then(({ data }) => setCompanyUtilities(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  // Units (with their current tenant and configured utilities) for the chosen property
  useEffect(() => {
    setUnits([]); setUnit(null);
    if (!property) return;
    let cancelled = false;
    setUnitsLoading(true);
    api.get('/units', { params: { property: property._id, limit: 1000 } })
      .then(({ data }) => {
        if (cancelled) return;
        setUnits((data.data ?? []).map((u: any) => ({
          _id:        u._id,
          label:      `Unit ${u.unitNumber}`,
          sublabel:   u.currentTenant?.name ?? 'Vacant',
          tenantId:   u.currentTenant?._id,
          tenantName: u.currentTenant?.name,
          utilities:  u.utilities ?? [],
        })));
      })
      .catch((err) => { if (!cancelled) Alert.alert('Could not load units', apiError(err, 'Failed to load units.')); })
      .finally(() => { if (!cancelled) setUnitsLoading(false); });
    return () => { cancelled = true; };
  }, [property]);

  // Utility options: what the unit / property is actually set up with, else the common three.
  const utilityOptions = useMemo(() => {
    const names: string[] = [];
    const add = (n?: string) => { const t = (n ?? '').trim(); if (t && !names.some(x => eq(x, t))) names.push(t); };
    unit?.utilities.forEach(u => add(u.utility));
    property?.rates.forEach(r => { if (r.isActive !== false) add(r.utilityType); });
    return names.length ? names : DEFAULT_UTILITIES;
  }, [unit, property]);

  // Keep the chosen utility valid when the options change
  useEffect(() => {
    if (!utilityOptions.some(n => eq(n, utilityType))) setUtilityType(utilityOptions[0]);
  }, [utilityOptions, utilityType]);

  // Default rate: same precedence as the server (unit -> property -> company utility)
  const defaultRate = useMemo(() => {
    const fromUnit = unit?.utilities.find(u => eq(u.utility, utilityType));
    if (fromUnit && Number.isFinite(Number(fromUnit.unitCharge))) return Number(fromUnit.unitCharge);
    const fromProp = property?.rates.find(r => eq(r.utilityType, utilityType) && r.isActive !== false);
    if (fromProp && Number.isFinite(Number(fromProp.unitCost))) return Number(fromProp.unitCost);
    const fromCompany = companyUtilities.find(c => eq(c.name, utilityType) && c.isActive !== false);
    if (fromCompany && Number.isFinite(Number(fromCompany.unitCost))) return Number(fromCompany.unitCost);
    return 0;
  }, [unit, property, utilityType, companyUtilities]);

  useEffect(() => {
    if (!rateTouched) setRate(defaultRate > 0 ? String(defaultRate) : '');
  }, [defaultRate, rateTouched]);

  // Past readings for this unit + utility -> previous reading and duplicate detection
  useEffect(() => {
    setPastReadings([]);
    if (!unit) return;
    let cancelled = false;
    api.get('/meter-readings', { params: { unit: unit._id, utilityType, limit: 200 } })
      .then(({ data }) => { if (!cancelled) setPastReadings(data?.data ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [unit, utilityType]);

  const liveReadings = useMemo(
    () => pastReadings.filter(r => r.status === 'draft' || r.status === 'billed'),
    [pastReadings],
  );
  const duplicate = useMemo(() => liveReadings.some(r => r.billingPeriod === billingPeriod), [liveReadings, billingPeriod]);
  const inferredPrevious = useMemo(() => {
    const earlier = liveReadings
      .filter(r => (r.billingPeriod ?? '') < billingPeriod)
      .sort((a, b) =>
        String(b.billingPeriod).localeCompare(String(a.billingPeriod)) ||
        new Date(b.readingDate ?? 0).getTime() - new Date(a.readingDate ?? 0).getTime());
    return Number(earlier[0]?.currentReading || 0);
  }, [liveReadings, billingPeriod]);

  const prevPeriod = () => bpMonth === 1 ? (setBpMonth(12), setBpYear(y => y - 1)) : setBpMonth(m => m - 1);
  const nextPeriod = () => bpMonth === 12 ? (setBpMonth(1), setBpYear(y => y + 1)) : setBpMonth(m => m + 1);

  const effectivePrev  = prevReading === '' ? inferredPrevious : Number(prevReading);
  const currNum        = Number(currReading);
  const rateNum        = Number(rate);
  const consumption    = currReading === '' ? 0 : meterReset ? currNum : Math.max(0, currNum - effectivePrev);
  const estimatedAmount = consumption * (Number.isFinite(rateNum) ? rateNum : 0);
  const lowerThanPrev  = currReading !== '' && !meterReset && currNum < effectivePrev;
  const noTenant       = !!unit && !unit.tenantId;

  useEffect(() => { if (noTenant) setGenerateInvoice(false); }, [noTenant]);

  const save = async () => {
    if (submittingRef.current) return;
    if (!property || !unit) { Alert.alert('Missing', 'Select a property and unit.'); return; }
    if (currReading === '' || !Number.isFinite(currNum)) { Alert.alert('Missing', 'Enter the current meter reading.'); return; }
    if (lowerThanPrev) {
      Alert.alert('Invalid reading', `The current reading is lower than the previous reading (${fmtNumber(effectivePrev)}). If the meter was replaced or reset, switch on "Meter reset".`);
      return;
    }
    if (duplicate) {
      Alert.alert('Already recorded', `A ${utilityType} reading already exists for ${unit.label} in ${billingPeriod}.`);
      return;
    }
    if (!Number.isFinite(rateNum) || rateNum <= 0) { Alert.alert('Missing', 'Enter the rate per unit.'); return; }

    const doSave = async () => {
      submittingRef.current = true;
      setSubmitting(true);
      let savedId: string | undefined;
      try {
        const { data } = await api.post('/meter-readings', {
          property:        property._id,
          unit:            unit._id,
          tenant:          unit.tenantId || undefined,
          utilityType,
          billingPeriod,
          readingDate,
          // blank previous = let the server derive it from the last reading
          previousReading: prevReading === '' ? undefined : Number(prevReading),
          currentReading:  currNum,
          rate:            rateNum,
          isMeterReset:    meterReset,
        });
        savedId = data?._id;
      } catch (err) {
        Alert.alert('Could not save reading', apiError(err, 'Failed to save reading.'));
        submittingRef.current = false;
        setSubmitting(false);
        return;
      }

      if (generateInvoice && savedId) {
        try {
          const { data } = await api.post(`/meter-readings/${savedId}/bill`, { invoiceDate: readingDate, dueDate: readingDate });
          const no = data?.invoice?.invoiceNumber;
          Alert.alert('Saved and billed', no ? `Reading saved. Utility invoice ${no} created.` : 'Reading saved and invoiced.', [{ text: 'OK', onPress: () => router.back() }]);
        } catch (err) {
          Alert.alert(
            'Reading saved, not billed',
            `${apiError(err, 'The invoice could not be generated.')}\n\nYou can bill it later from the meter readings list.`,
            [{ text: 'OK', onPress: () => router.back() }],
          );
        }
      } else {
        Alert.alert('Saved', 'Meter reading recorded as a draft.', [{ text: 'OK', onPress: () => router.back() }]);
      }
      submittingRef.current = false;
      setSubmitting(false);
    };

    if (generateInvoice) {
      Alert.alert(
        'Save and bill',
        `Save the reading and generate a ${fmtKES(estimatedAmount)} utility invoice for ${unit.tenantName ?? 'the tenant'}?`,
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Save & Bill', onPress: doSave }],
      );
    } else {
      doSave();
    }
  };

  return (
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
            placeholder="Select property…"
            selectedId={property?._id}
            selectedLabel={property?.label}
            items={properties}
            onSelect={(item) => { setProperty(item as PropertyOption); setPropOpen(false); setRateTouched(false); }}
            onClear={() => { setProperty(null); }}
            loading={propsLoading}
            open={propOpen}
            onToggle={() => { setPropOpen(o => !o); setUnitOpen(false); }}
            required
          />

          {/* Unit */}
          <Dropdown
            label="UNIT"
            placeholder={property ? 'Select unit…' : 'Select a property first'}
            selectedId={unit?._id}
            selectedLabel={unit?.label}
            items={units}
            onSelect={(item) => { setUnit(item as UnitOption); setUnitOpen(false); setRateTouched(false); setPrevReading(''); }}
            onClear={() => setUnit(null)}
            loading={unitsLoading}
            open={unitOpen}
            onToggle={() => { if (property) { setUnitOpen(o => !o); setPropOpen(false); } }}
            required
            emptyText="No units in this property"
          />

          {unit ? (
            <View style={[styles.notice, noTenant && styles.noticeWarn]}>
              <Ionicons name={noTenant ? 'warning-outline' : 'person-outline'} size={15} color={noTenant ? Colors.warning : Colors.primary} />
              <Text style={[styles.noticeText, noTenant && { color: Colors.warning }]}>
                {noTenant
                  ? 'This unit has no active tenant. You can record the reading, but it cannot be billed until a tenant is assigned.'
                  : `Billed to ${unit.tenantName}`}
              </Text>
            </View>
          ) : null}

          {/* Utility type */}
          <View style={styles.field}>
            <Text style={styles.label}>UTILITY TYPE <Text style={{ color: Colors.danger }}>*</Text></Text>
            <View style={styles.pillRow}>
              {utilityOptions.map(name => {
                const on = eq(name, utilityType);
                return (
                  <TouchableOpacity
                    key={name}
                    style={[styles.pill, on && styles.pillActive]}
                    onPress={() => { setUtilityType(name); setRateTouched(false); setPrevReading(''); }}
                  >
                    <Ionicons name={(UTILITY_ICONS[name.toLowerCase()] ?? 'speedometer-outline') as any} size={16} color={on ? Colors.white : Colors.textSecondary} />
                    <Text style={[styles.pillText, on && styles.pillTextActive]}>{name}</Text>
                  </TouchableOpacity>
                );
              })}
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
                <Text style={styles.pickerValue}>{MONTHS_FULL[bpMonth - 1]} {bpYear}</Text>
                <Text style={styles.pickerSub}>{billingPeriod}</Text>
              </View>
              <TouchableOpacity style={styles.pickerArrow} onPress={nextPeriod}>
                <Ionicons name="chevron-forward" size={20} color={Colors.primary} />
              </TouchableOpacity>
            </View>
            {duplicate ? (
              <Text style={styles.errorText}>A {utilityType} reading already exists for this unit and period.</Text>
            ) : null}
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
                  keyboardType="decimal-pad"
                  placeholder={unit ? fmtNumber(inferredPrevious) : '0'}
                  placeholderTextColor={Colors.textMuted}
                  value={prevReading}
                  onChangeText={t => setPrevReading(cleanDecimal(t))}
                />
              </View>
              {unit && prevReading === '' ? <Text style={styles.hint}>Auto: last recorded reading</Text> : null}
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.label}>CURRENT <Text style={{ color: Colors.danger }}>*</Text></Text>
              <View style={[styles.inputBox, { borderColor: lowerThanPrev ? Colors.danger : Colors.primary }]}>
                <TextInput
                  style={styles.inputText}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={Colors.textMuted}
                  value={currReading}
                  onChangeText={t => setCurrReading(cleanDecimal(t))}
                />
              </View>
            </View>
          </View>
          {lowerThanPrev ? (
            <Text style={styles.errorText}>Current reading is lower than the previous reading ({fmtNumber(effectivePrev)}).</Text>
          ) : null}

          {/* Meter reset */}
          <View style={styles.toggleRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.toggleLabel}>Meter reset / replaced</Text>
              <Text style={styles.toggleSub}>Usage will equal the current reading</Text>
            </View>
            <Switch
              value={meterReset}
              onValueChange={setMeterReset}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor={Colors.white}
            />
          </View>

          {/* Rate */}
          <View style={styles.field}>
            <Text style={styles.label}>RATE PER UNIT (KES) <Text style={{ color: Colors.danger }}>*</Text></Text>
            <View style={styles.inputBox}>
              <Text style={styles.prefix}>KES</Text>
              <TextInput
                style={[styles.inputText, { flex: 1 }]}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={Colors.textMuted}
                value={rate}
                onChangeText={t => { setRateTouched(true); setRate(cleanDecimal(t)); }}
              />
            </View>
            {unit && defaultRate <= 0 && !rateTouched ? (
              <Text style={styles.hint}>No rate is set up for {utilityType} on this unit/property. Enter one.</Text>
            ) : null}
          </View>

          {/* Summary card */}
          {currReading !== '' ? (
            <View style={styles.summary}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Consumption</Text>
                <Text style={styles.summaryValue}>{fmtNumber(consumption)} units</Text>
              </View>
              {rateNum > 0 ? (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Estimated Bill</Text>
                  <Text style={[styles.summaryValue, { color: Colors.primary }]}>{fmtKES(estimatedAmount)}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Generate Invoice toggle */}
          <View style={[styles.toggleRow, noTenant && { opacity: 0.5 }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.toggleLabel}>Generate Invoice</Text>
              <Text style={styles.toggleSub}>Create the tenant's utility invoice right after saving</Text>
            </View>
            <Switch
              value={generateInvoice}
              onValueChange={setGenerateInvoice}
              disabled={noTenant}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor={Colors.white}
            />
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
            onPress={save}
            disabled={submitting}
          >
            {submitting
              ? <ActivityIndicator size="small" color={Colors.white} />
              : <Text style={styles.submitText}>{generateInvoice ? 'Save & Generate Invoice' : 'Save Reading'}</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 20, gap: 18, paddingBottom: 60 },

  field:  { gap: 6 },
  label:  { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted },
  hint:   { fontSize: 11, color: Colors.textMuted },
  errorText: { fontSize: 12, color: Colors.danger, fontWeight: '600' },

  notice: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.primaryFaded, borderRadius: 10, padding: 10,
  },
  noticeWarn: { backgroundColor: Colors.warningLight },
  noticeText: { flex: 1, fontSize: 12, color: Colors.primary, lineHeight: 17 },

  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: {
    flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, paddingHorizontal: 12, borderRadius: 12,
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

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  toggleLabel: { fontSize: 14, fontWeight: '700', color: Colors.text },
  toggleSub:   { fontSize: 11, color: Colors.textMuted },

  submitBtn: {
    backgroundColor: Colors.primary, borderRadius: 14,
    height: 54, alignItems: 'center', justifyContent: 'center',
  },
  submitText: { color: Colors.white, fontSize: 16, fontWeight: '800' },
});
