import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { ErrorState } from '../../../../components/ui/PmsStates';
import { cleanDecimal, fmtKES, todayISO } from '../../../../utils/pmsFormat';
import { CW, CWL, cwError, listOf, normalizePlate, round2, toMsisdn } from '../../../../utils/carwash';

const VEHICLE_TYPES = [
  { label: 'Sedan / Saloon',       icon: 'car-outline'       },
  { label: 'Hatchback',            icon: 'car-sport-outline' },
  { label: 'SUV',                  icon: 'car-outline'       },
  { label: 'Mini SUV / Crossover', icon: 'car-outline'       },
  { label: 'Van / Minivan',        icon: 'bus-outline'       },
  { label: 'Pickup / 4x4',         icon: 'car-outline'       },
  { label: 'Motorbike / Bike',     icon: 'bicycle-outline'   },
  { label: 'Tuk-tuk',              icon: 'car-outline'       },
  { label: 'Bus / Matatu',         icon: 'bus-outline'       },
];

const MAX_STAFF = 5;   // the server keeps at most five staff per job

type PricingTier = { vehicleType: string; price: number };
type Service = {
  _id: string; name: string; defaultPrice: number;
  vehicleType?: string; category?: string;
  pricingTiers?: PricingTier[];
  jobType?: 'both' | 'vehicle' | 'carpet';
  pricingType?: 'flat' | 'per_sqft';
  isTaxable?: boolean; taxRate?: number;
};
type Staff = { _id: string; name: string; role?: string };
type Lookup = { name: string; phone: string; credit: number; rewards: number } | null;

const hasTiers = (s: Service) => !!s.pricingTiers?.length;

const servicePrice = (svc: Service, vType: string): number => {
  const tier = vType ? svc.pricingTiers?.find(t => t.vehicleType === vType) : undefined;
  return tier ? tier.price : (svc.defaultPrice || 0);
};

export default function NewCarWashJobScreen() {
  const router = useRouter();

  const [plate,         setPlate]         = useState('');
  const [lookingUp,     setLookingUp]     = useState(false);
  const [known,         setKnown]         = useState<Lookup>(null);
  const [customerName,  setCustomerName]  = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lookupSeq   = useRef(0);
  const nameTouched  = useRef(false);
  const phoneTouched = useRef(false);

  const [vehicleType,       setVehicleType]       = useState('');
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);

  const [services,       setServices]       = useState<Service[]>([]);
  const [svcSearch,      setSvcSearch]      = useState('');
  const [selectedSvcIds, setSelectedSvcIds] = useState<Set<string>>(new Set());
  const [staffList,       setStaffList]       = useState<Staff[]>([]);
  const [selectedStaff,   setSelectedStaff]   = useState<string[]>([]);
  const [showStaffPicker, setShowStaffPicker] = useState(false);
  const [loading,   setLoading]   = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [discountOn,  setDiscountOn]  = useState(false);
  const [discount,    setDiscount]    = useState('');
  const [discountCfg, setDiscountCfg] = useState({ minPrice: 0, maxPct: 0 });

  const [notes,      setNotes]      = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);

  const loadRefs = useCallback(async () => {
    setLoading(true); setLoadError(null);
    const [svcRes, stfRes, cfgRes] = await Promise.allSettled([
      api.get('/carwash/services', { params: { active: true, limit: 500 } }),
      api.get('/carwash/staff',    { params: { active: true, limit: 100 } }),
      api.get('/carwash/settings'),                       // optional: discount rules (needs settings access)
    ]);
    if (svcRes.status === 'rejected') {
      setLoadError(cwError(svcRes.reason, 'Could not load the service list.'));
    } else {
      // Carpets are priced per square foot and belong to a different form; this screen books vehicles.
      setServices(listOf<Service>(svcRes.value.data, 'services').filter(s => s.jobType !== 'carpet' && s.pricingType !== 'per_sqft'));
    }
    if (stfRes.status === 'fulfilled') setStaffList(listOf<Staff>(stfRes.value.data, 'staff'));
    if (cfgRes.status === 'fulfilled') {
      const c = cfgRes.value.data?.data ?? {};
      setDiscountCfg({ minPrice: Number(c.discountMinJobPrice ?? 0), maxPct: Number(c.discountMaxPercent ?? 0) });
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadRefs(); }, [loadRefs]);
  useEffect(() => () => { if (lookupTimer.current) clearTimeout(lookupTimer.current); }, []);

  const handlePlateChange = (val: string) => {
    const up = val.toUpperCase();
    setPlate(up);
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    const p = normalizePlate(up);
    const seq = ++lookupSeq.current;
    if (p.length < 3) { setKnown(null); setLookingUp(false); return; }
    lookupTimer.current = setTimeout(async () => {
      setLookingUp(true);
      try {
        const { data } = await api.get(`/carwash/loyalty/plate/${encodeURIComponent(p)}`);
        if (seq !== lookupSeq.current) return;              // the plate changed while we were waiting
        const d = data?.data ?? data ?? {};
        const c = d.customer;
        if (c) {
          setKnown({ name: c.name || '', phone: c.phone || '', credit: Number(d.creditBalance || 0), rewards: Number(d.loyaltyCard?.pendingRewards || 0) });
          // never overwrite what the cashier has already typed
          if (!nameTouched.current)  setCustomerName(c.name || '');
          if (!phoneTouched.current) setCustomerPhone(c.phone || '');
        } else setKnown(null);
      } catch {
        if (seq === lookupSeq.current) setKnown(null);      // lookup is a convenience; never block the form on it
      } finally {
        if (seq === lookupSeq.current) setLookingUp(false);
      }
    }, 500);
  };

  const toggleService = (id: string) =>
    setSelectedSvcIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleStaff = (id: string) =>
    setSelectedStaff(prev => {
      if (prev.includes(id)) return prev.filter(s => s !== id);
      if (prev.length >= MAX_STAFF) { Alert.alert('Staff limit', `A job can have at most ${MAX_STAFF} staff.`); return prev; }
      return [...prev, id];
    });

  const chosen = useMemo(() => services.filter(s => selectedSvcIds.has(s._id)), [services, selectedSvcIds]);
  const needsVehicleType = chosen.filter(s => hasTiers(s) && !vehicleType);

  const gross = round2(chosen.reduce((sum, s) => sum + servicePrice(s, vehicleType), 0));
  const vat   = round2(chosen.reduce((sum, s) => {
    const rate = s.isTaxable ? Number(s.taxRate) : 0;
    return rate > 0 ? sum + servicePrice(s, vehicleType) * rate / (100 + rate) : sum;
  }, 0));
  const discountNum   = discountOn ? Math.max(0, Number(discount) || 0) : 0;
  const discountEligible = discountCfg.minPrice <= 0 || gross > discountCfg.minPrice;
  const discountMax   = discountCfg.maxPct > 0 ? round2(gross * discountCfg.maxPct / 100) : gross;
  const net           = Math.max(0, round2(gross - discountNum));

  const shownServices = useMemo(() => {
    const q = svcSearch.trim().toLowerCase();
    return q ? services.filter(s => `${s.name} ${s.category || ''}`.toLowerCase().includes(q)) : services;
  }, [services, svcSearch]);

  const release = () => { submitLock.current = false; setSubmitting(false); };

  const create = async () => {
    try {
      const { data } = await api.post('/carwash/jobs', {
        jobType:      'vehicle',
        plateNumber:  normalizePlate(plate),
        serviceLines: chosen.map(s => ({
          service:     s._id,
          serviceName: s.name,
          vehicleType: vehicleType || s.vehicleType || '',
          price:       servicePrice(s, vehicleType),
        })),
        assignedStaff:  selectedStaff,
        customerName:   customerName.trim(),
        phone:          customerPhone.trim(),
        discountAmount: discountNum,
        notes:          notes.trim(),
      });
      const job = data?.data ?? data?.job;
      // Open the new job so it can be moved along / paid straight away.
      if (job?._id) router.replace(`/carwash/jobs/${job._id}` as any); else router.back();
    } catch (err) {
      Alert.alert('Could not create job', cwError(err, 'Failed to create the job.'));
    } finally {
      release();
    }
  };

  const handleSubmit = async () => {
    if (submitLock.current) return;
    const p = normalizePlate(plate);
    if (!p)                    { Alert.alert('Required', 'Enter the plate number.'); return; }
    if (chosen.length === 0)   { Alert.alert('Required', 'Select at least one service.'); return; }
    if (needsVehicleType.length) {
      Alert.alert('Choose the vehicle type', `${needsVehicleType.map(s => s.name).join(', ')} ${needsVehicleType.length > 1 ? 'are' : 'is'} priced by vehicle type.`);
      return;
    }
    if (gross <= 0)            { Alert.alert('Invalid price', 'The total price must be greater than zero.'); return; }
    if (customerPhone.trim() && !toMsisdn(customerPhone)) {
      Alert.alert('Check the phone number', 'Enter a valid Kenyan number (07XXXXXXXX) or leave it blank.');
      return;
    }
    if (discountOn && discountNum > 0) {
      if (!discountEligible) { Alert.alert('Discount not allowed', `Discounts are only allowed on jobs above ${fmtKES(discountCfg.minPrice)}.`); return; }
      if (discountNum > discountMax + 0.009) {
        Alert.alert('Discount too high', discountCfg.maxPct > 0 ? `The maximum discount is ${discountCfg.maxPct}% (${fmtKES(discountMax)}).` : 'The discount cannot exceed the job price.');
        return;
      }
    }

    submitLock.current = true;
    setSubmitting(true);
    // Same plate already booked today? Ask before creating a second job (web does the same).
    try {
      const { data } = await api.get('/carwash/jobs', { params: { search: p, date: todayISO(), limit: 1 } });
      const existing = listOf<{ jobNumber?: string; status?: string }>(data, 'jobs')[0];
      if (existing) {
        Alert.alert(
          'Plate already booked today',
          `${p} already has job ${existing.jobNumber || ''} today (${existing.status || 'open'}). Create another job only if this is a separate visit.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: release },
            { text: 'Create anyway', onPress: () => { create(); } },
          ],
        );
        return;
      }
    } catch { /* the check is advisory: carry on and create the job */ }
    create();
  };

  if (loading) return <MilikLoader fullscreen />;
  if (loadError) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ErrorState message={loadError} onRetry={loadRefs} />
      </SafeAreaView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'New Job' }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            {/* ── Plate ── */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>VEHICLE <Text style={{ color: '#DC2626' }}>*</Text></Text>
              <View style={styles.plateInputRow}>
                <View style={styles.platePrefix}>
                  <Text style={styles.platePrefixTxt}>KE</Text>
                </View>
                <TextInput
                  style={styles.plateInput}
                  placeholder="KAA 123X"
                  placeholderTextColor="#CBD5E1"
                  value={plate}
                  onChangeText={handlePlateChange}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={12}
                  returnKeyType="done"
                />
                {lookingUp && <ActivityIndicator size="small" color={CW} style={{ position: 'absolute', right: 14 }} />}
              </View>

              {known ? (
                <View style={styles.customerFound}>
                  <Ionicons name="person-circle" size={18} color="#065F46" />
                  <View style={{ flex: 1 }}>
                    {known.name  ? <Text style={styles.customerFoundName}>{known.name}</Text>   : null}
                    {known.phone ? <Text style={styles.customerFoundPhone}>{known.phone}</Text> : null}
                    {known.credit > 0 ? <Text style={styles.customerFoundPhone}>Credit on account: {fmtKES(known.credit)}</Text> : null}
                    {known.rewards > 0 ? <Text style={styles.customerFoundPhone}>{known.rewards} loyalty reward{known.rewards > 1 ? 's' : ''} available</Text> : null}
                  </View>
                  <View style={styles.customerFoundBadge}>
                    <Text style={styles.customerFoundBadgeTxt}>Known</Text>
                  </View>
                </View>
              ) : null}

              {/* Vehicle type */}
              <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowVehiclePicker(v => !v)}>
                <Ionicons name="car-outline" size={16} color={vehicleType ? CW : '#94A3B8'} />
                <Text style={[styles.pickerBtnTxt, !!vehicleType && { color: '#0F172A' }]}>
                  {vehicleType || 'Vehicle type (needed for tiered prices)'}
                </Text>
                <Ionicons name={showVehiclePicker ? 'chevron-up' : 'chevron-down'} size={16} color="#94A3B8" />
              </TouchableOpacity>
              {showVehiclePicker && (
                <View style={styles.dropPanel}>
                  {VEHICLE_TYPES.map(vt => {
                    const sel = vehicleType === vt.label;
                    return (
                      <TouchableOpacity
                        key={vt.label}
                        style={[styles.dropItem, sel && styles.dropItemActive]}
                        onPress={() => { setVehicleType(sel ? '' : vt.label); setShowVehiclePicker(false); }}
                      >
                        <Ionicons name={vt.icon as any} size={15} color={sel ? CW : '#64748B'} />
                        <Text style={[styles.dropItemTxt, sel && { color: CW, fontWeight: '700' }]}>{vt.label}</Text>
                        {sel && <Ionicons name="checkmark" size={14} color={CW} style={{ marginLeft: 'auto' }} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>

            {/* ── Customer (editable) ── */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>CUSTOMER</Text>
              <View style={styles.row2}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Name (optional)"
                  placeholderTextColor="#94A3B8"
                  value={customerName}
                  onChangeText={t => { nameTouched.current = true; setCustomerName(t); }}
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="07XX..."
                  placeholderTextColor="#94A3B8"
                  value={customerPhone}
                  onChangeText={t => { phoneTouched.current = true; setCustomerPhone(t); }}
                  keyboardType="phone-pad"
                />
              </View>
            </View>

            {/* ── Services ── */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>SERVICES <Text style={{ color: '#DC2626' }}>*</Text></Text>
              {services.length > 8 ? (
                <TextInput
                  style={styles.input}
                  placeholder="Search services"
                  placeholderTextColor="#94A3B8"
                  value={svcSearch}
                  onChangeText={setSvcSearch}
                  autoCorrect={false}
                />
              ) : null}
              {services.length === 0 ? (
                <Text style={styles.hint}>No active services are set up yet. Add them in Car Wash → Services on the web.</Text>
              ) : shownServices.length === 0 ? (
                <Text style={styles.hint}>No service matches “{svcSearch}”.</Text>
              ) : (
                <View style={styles.servicesGrid}>
                  {shownServices.map(svc => {
                    const sel = selectedSvcIds.has(svc._id);
                    const tiered = hasTiers(svc);
                    const tierHit = !!vehicleType && !!svc.pricingTiers?.some(t => t.vehicleType === vehicleType);
                    return (
                      <TouchableOpacity
                        key={svc._id}
                        style={[styles.svcCard, sel && styles.svcCardActive]}
                        onPress={() => toggleService(svc._id)}
                        activeOpacity={0.75}
                      >
                        {sel && (
                          <View style={styles.svcCheck}>
                            <Ionicons name="checkmark" size={10} color="#fff" />
                          </View>
                        )}
                        <Text style={[styles.svcName, sel && { color: CW }]} numberOfLines={2}>{svc.name}</Text>
                        <Text style={[styles.svcPrice, sel && { color: CW }]}>
                          {tiered && !vehicleType ? 'Priced by vehicle' : fmtKES(servicePrice(svc, vehicleType))}
                        </Text>
                        {tierHit ? <Text style={styles.tierBadge}>{vehicleType}</Text> : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>

            {/* ── Staff ── */}
            {staffList.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>STAFF (SHARE THE COMMISSION)</Text>
                <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowStaffPicker(v => !v)}>
                  <Ionicons name="people-outline" size={16} color={selectedStaff.length ? CW : '#94A3B8'} />
                  <Text style={[styles.pickerBtnTxt, selectedStaff.length > 0 && { color: '#0F172A' }]} numberOfLines={1}>
                    {selectedStaff.length > 0
                      ? staffList.filter(s => selectedStaff.includes(s._id)).map(s => s.name).join(', ')
                      : 'Assign staff (optional)'}
                  </Text>
                  <Ionicons name={showStaffPicker ? 'chevron-up' : 'chevron-down'} size={16} color="#94A3B8" />
                </TouchableOpacity>
                {showStaffPicker && (
                  <View style={styles.dropPanel}>
                    {staffList.map(s => {
                      const sel = selectedStaff.includes(s._id);
                      return (
                        <TouchableOpacity
                          key={s._id}
                          style={[styles.dropItem, sel && styles.dropItemActive]}
                          onPress={() => toggleStaff(s._id)}
                        >
                          <View style={[styles.staffAvatar, sel && { backgroundColor: CW }]}>
                            <Text style={[styles.staffAvatarTxt, sel && { color: '#fff' }]}>
                              {s.name?.[0]?.toUpperCase() ?? '?'}
                            </Text>
                          </View>
                          <Text style={[styles.dropItemTxt, sel && { color: CW, fontWeight: '700' }]}>{s.name}</Text>
                          {sel && <Ionicons name="checkmark" size={14} color={CW} style={{ marginLeft: 'auto' }} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            )}

            {/* ── Discount ── */}
            {gross > 0 && (
              <View style={styles.section}>
                <View style={styles.discountRow}>
                  <Text style={styles.sectionLabel}>DISCOUNT</Text>
                  <Switch
                    value={discountOn && discountEligible}
                    disabled={!discountEligible}
                    onValueChange={on => {
                      setDiscountOn(on);
                      if (on && discountCfg.maxPct > 0 && !discount) setDiscount(String(discountMax));
                    }}
                    trackColor={{ true: CW }}
                  />
                </View>
                {!discountEligible ? (
                  <Text style={styles.hint}>Discounts are only allowed on jobs above {fmtKES(discountCfg.minPrice)}.</Text>
                ) : discountOn ? (
                  <>
                    <TextInput
                      style={styles.input}
                      placeholder="Amount (KES)"
                      placeholderTextColor="#94A3B8"
                      value={discount}
                      onChangeText={t => setDiscount(cleanDecimal(t))}
                      keyboardType="decimal-pad"
                    />
                    {discountCfg.maxPct > 0 ? <Text style={styles.hint}>At most {discountCfg.maxPct}% of the price ({fmtKES(discountMax)}).</Text> : null}
                  </>
                ) : null}
              </View>
            )}

            {/* ── Notes ── */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>NOTES <Text style={{ fontSize: 10, color: '#94A3B8', fontWeight: '400' }}>(OPTIONAL)</Text></Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                placeholder="Special instructions..."
                placeholderTextColor="#94A3B8"
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>
          </ScrollView>

          {/* ── Fixed footer ── */}
          <View style={styles.footer}>
            {chosen.length > 0 && (
              <>
                <View style={styles.footerTotalRow}>
                  <Text style={styles.footerTotalLabel}>{chosen.length} service{chosen.length > 1 ? 's' : ''}{discountNum > 0 ? ` · discount ${fmtKES(discountNum)}` : ''}</Text>
                  <Text style={styles.footerTotalAmt}>{needsVehicleType.length ? 'Pick vehicle type' : fmtKES(net)}</Text>
                </View>
                {vat > 0 && !needsVehicleType.length ? <Text style={styles.vat}>includes VAT of {fmtKES(vat)}</Text> : null}
              </>
            )}
            <TouchableOpacity
              style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="car" size={18} color="#fff" />
                  <Text style={styles.submitTxt}>Create Job</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#F8FAFC' },
  scroll: { padding: 16, gap: 20, paddingBottom: 16 },

  section:      { gap: 8 },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8' },
  hint:         { fontSize: 12, color: '#64748B', lineHeight: 17 },
  discountRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  plateInputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#E2E8F0', overflow: 'hidden',
  },
  platePrefix:    { backgroundColor: CW, paddingHorizontal: 14, paddingVertical: 15, alignItems: 'center' },
  platePrefixTxt: { fontSize: 13, fontWeight: '800', color: 'rgba(255,255,255,0.7)' },
  plateInput:     { flex: 1, fontSize: 20, fontWeight: '900', color: CW, paddingHorizontal: 14, paddingVertical: 14, letterSpacing: 1 },

  customerFound: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#ECFDF5', borderRadius: 12,
    borderWidth: 1, borderColor: '#6EE7B7', padding: 12,
  },
  customerFoundName:  { fontSize: 14, fontWeight: '700', color: '#065F46' },
  customerFoundPhone: { fontSize: 12, color: '#059669' },
  customerFoundBadge: { marginLeft: 'auto', backgroundColor: '#065F46', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  customerFoundBadgeTxt: { fontSize: 10, fontWeight: '800', color: '#fff' },

  pickerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 12,
    borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 14, paddingVertical: 13,
  },
  pickerBtnTxt: { flex: 1, fontSize: 14, color: '#94A3B8', fontWeight: '500' },

  dropPanel: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden' },
  dropItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  dropItemActive: { backgroundColor: CWL },
  dropItemTxt:    { fontSize: 14, color: '#0F172A' },

  input: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, color: '#0F172A' },
  textarea:    { minHeight: 90, paddingTop: 13 },
  row2:        { flexDirection: 'row', gap: 10 },

  servicesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  svcCard: {
    width: '47.5%', backgroundColor: '#fff',
    borderRadius: 12, borderWidth: 1.5, borderColor: '#E2E8F0',
    padding: 12, gap: 4, position: 'relative',
    minHeight: 64,
  },
  svcCardActive: { borderColor: CW, backgroundColor: CWL },
  svcCheck: {
    position: 'absolute', top: 8, right: 8,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: CW, alignItems: 'center', justifyContent: 'center',
  },
  svcName:   { fontSize: 12, fontWeight: '700', color: '#0F172A', paddingRight: 20 },
  svcPrice:  { fontSize: 12, fontWeight: '800', color: '#64748B' },
  tierBadge: { fontSize: 9, color: CW, fontWeight: '700', marginTop: 2 },

  staffAvatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center',
  },
  staffAvatarTxt: { fontSize: 12, fontWeight: '800', color: '#475569' },

  footer: {
    borderTopWidth: 1, borderTopColor: '#E2E8F0',
    backgroundColor: '#fff', padding: 16, gap: 10,
  },
  footerTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footerTotalLabel: { fontSize: 13, fontWeight: '600', color: '#64748B', flex: 1 },
  footerTotalAmt:   { fontSize: 16, fontWeight: '900', color: CW },
  vat:              { fontSize: 11, color: '#94A3B8', marginTop: -6 },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: CW, borderRadius: 14, paddingVertical: 15,
  },
  submitTxt: { fontSize: 16, fontWeight: '800', color: '#fff' },
});
