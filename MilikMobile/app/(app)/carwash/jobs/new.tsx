import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const CW  = '#1E3A8A';
const CWL = '#EEF2FF';
const ACC = '#C8511A';

const VEHICLE_TYPES = [
  { label: 'Sedan / Saloon',      icon: 'car-outline'           },
  { label: 'Hatchback',           icon: 'car-sport-outline'     },
  { label: 'SUV',                 icon: 'car-outline'           },
  { label: 'Mini SUV / Crossover',icon: 'car-outline'           },
  { label: 'Van / Minivan',       icon: 'bus-outline'           },
  { label: 'Pickup / 4x4',        icon: 'car-outline'           },
  { label: 'Motorbike / Bike',    icon: 'bicycle-outline'       },
  { label: 'Tuk-tuk',             icon: 'car-outline'           },
  { label: 'Bus / Matatu',        icon: 'bus-outline'           },
];

type Service = { _id: string; name: string; price: number; category?: string };
type Staff   = { _id: string; name: string };

export default function NewCarWashJobScreen() {
  const router = useRouter();

  const [plate,         setPlate]         = useState('');
  const [lookingUp,     setLookingUp]     = useState(false);
  const [customerName,  setCustomerName]  = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const lookupTimer = useRef<ReturnType<typeof setTimeout>>();

  const [vehicleType,       setVehicleType]       = useState('');
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);

  const [services,       setServices]       = useState<Service[]>([]);
  const [selectedSvcIds, setSelectedSvcIds] = useState<Set<string>>(new Set());
  const [svcLoading,     setSvcLoading]     = useState(false);

  const [staffList,       setStaffList]       = useState<Staff[]>([]);
  const [selectedStaff,   setSelectedStaff]   = useState<string[]>([]);
  const [showStaffPicker, setShowStaffPicker] = useState(false);

  const [notes,      setNotes]      = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setSvcLoading(true);
    Promise.all([
      api.get('/carwash/services', { params: { limit: 100 } }),
      api.get('/carwash/staff',    { params: { limit: 100, status: 'active' } }),
    ])
      .then(([svcRes, stfRes]) => {
        const svcRaw = svcRes.data?.data ?? svcRes.data;
        setServices(Array.isArray(svcRaw) ? svcRaw : (svcRaw?.services ?? []));
        const stfRaw = stfRes.data?.data ?? stfRes.data;
        setStaffList(Array.isArray(stfRaw) ? stfRaw : (stfRaw?.staff ?? []));
      })
      .catch(() => {})
      .finally(() => setSvcLoading(false));
  }, []);

  const lookupPlate = useCallback((val: string) => {
    const p = val.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (p.length < 3) { setCustomerName(''); setCustomerPhone(''); return; }
    clearTimeout(lookupTimer.current);
    lookupTimer.current = setTimeout(async () => {
      setLookingUp(true);
      try {
        const { data } = await api.get('/carwash/customers/lookup', { params: { plate: p } });
        const c = data?.data?.customer ?? data?.customer;
        if (c) { setCustomerName(c.name || ''); setCustomerPhone(c.phone || ''); }
      } catch {}
      finally { setLookingUp(false); }
    }, 600);
  }, []);

  const handlePlateChange = (val: string) => {
    const up = val.toUpperCase();
    setPlate(up);
    lookupPlate(up);
  };

  const toggleService = (id: string) =>
    setSelectedSvcIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleStaff = (id: string) =>
    setSelectedStaff(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);

  const totalAmount = services
    .filter(s => selectedSvcIds.has(s._id))
    .reduce((sum, s) => sum + Number(s.price || 0), 0);

  const handleSubmit = async () => {
    if (!plate.trim())           { Alert.alert('Required', 'Enter the plate number.');      return; }
    if (selectedSvcIds.size === 0) { Alert.alert('Required', 'Select at least one service.'); return; }
    setSubmitting(true);
    try {
      await api.post('/carwash/jobs', {
        plate:       plate.trim().toUpperCase().replace(/\s/g, ''),
        vehicleType: vehicleType || undefined,
        services:    [...selectedSvcIds],
        staff:       selectedStaff.length > 0 ? selectedStaff : undefined,
        customer:    customerName ? { name: customerName, phone: customerPhone } : undefined,
        notes:       notes.trim() || undefined,
      });
      router.back();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to create job.');
    } finally { setSubmitting(false); }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'New Job' }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* ── Plate ── */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>VEHICLE</Text>
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
                  returnKeyType="done"
                />
                {lookingUp && <ActivityIndicator size="small" color={CW} style={{ position: 'absolute', right: 14 }} />}
              </View>

              {(customerName || customerPhone) ? (
                <View style={styles.customerFound}>
                  <Ionicons name="person-circle" size={18} color={CW} />
                  <View>
                    {customerName ? <Text style={styles.customerFoundName}>{customerName}</Text> : null}
                    {customerPhone ? <Text style={styles.customerFoundPhone}>{customerPhone}</Text> : null}
                  </View>
                  <View style={styles.customerFoundBadge}>
                    <Text style={styles.customerFoundBadgeTxt}>Known</Text>
                  </View>
                </View>
              ) : null}

              {/* Vehicle type */}
              <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowVehiclePicker(v => !v)}>
                <Ionicons name="car-outline" size={16} color={vehicleType ? CW : '#94A3B8'} />
                <Text style={[styles.pickerBtnTxt, vehicleType && { color: '#0F172A' }]}>
                  {vehicleType || 'Vehicle type (optional)'}
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
                        onPress={() => { setVehicleType(vt.label); setShowVehiclePicker(false); }}
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
                  onChangeText={setCustomerName}
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="07XX..."
                  placeholderTextColor="#94A3B8"
                  value={customerPhone}
                  onChangeText={setCustomerPhone}
                  keyboardType="phone-pad"
                />
              </View>
            </View>

            {/* ── Services ── */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>SERVICES <Text style={{ color: '#DC2626' }}>*</Text></Text>
              {svcLoading ? (
                <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                  <MilikLoader size="small" />
                </View>
              ) : (
                <View style={styles.servicesGrid}>
                  {services.map(svc => {
                    const sel = selectedSvcIds.has(svc._id);
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
                          KES {Number(svc.price).toLocaleString()}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>

            {/* ── Staff ── */}
            {staffList.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>STAFF</Text>
                <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowStaffPicker(v => !v)}>
                  <Ionicons name="people-outline" size={16} color={selectedStaff.length ? CW : '#94A3B8'} />
                  <Text style={[styles.pickerBtnTxt, selectedStaff.length > 0 && { color: '#0F172A' }]}>
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
            {selectedSvcIds.size > 0 && (
              <View style={styles.footerTotalRow}>
                <Text style={styles.footerTotalLabel}>{selectedSvcIds.size} service{selectedSvcIds.size > 1 ? 's' : ''}</Text>
                <Text style={styles.footerTotalAmt}>KES {totalAmount.toLocaleString('en-KE')}</Text>
              </View>
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
  svcName:  { fontSize: 12, fontWeight: '700', color: '#0F172A', paddingRight: 20 },
  svcPrice: { fontSize: 12, fontWeight: '800', color: '#64748B' },

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
  footerTotalLabel: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  footerTotalAmt:   { fontSize: 16, fontWeight: '900', color: CW },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: CW, borderRadius: 14, paddingVertical: 15,
  },
  submitTxt: { fontSize: 16, fontWeight: '800', color: '#fff' },
});
