import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, Modal, FlatList, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../../services/api';
import { DateField } from '../../../../components/ui/DateField';

const HC = '#4C1D95';

type Employee  = { _id: string; surname: string; otherNames: string; employeeId?: string; department?: { name?: string } | string };
type LeaveType = { _id: string; name: string; daysAllowed?: number };

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function calcDays(start: string, end: string): number {
  const s = new Date(start), e = new Date(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 0;
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
}

export default function NewLeaveScreen() {
  const router = useRouter();

  const [employeeId,    setEmployeeId]    = useState('');
  const [employeeName,  setEmployeeName]  = useState('');
  const [leaveTypeId,   setLeaveTypeId]   = useState('');
  const [leaveTypeName, setLeaveTypeName] = useState('');
  const [startDate,     setStartDate]     = useState(todayStr());
  const [endDate,       setEndDate]       = useState(todayStr());
  const [reason,        setReason]        = useState('');
  const [submitting,    setSubmitting]    = useState(false);

  const [employees,   setEmployees]   = useState<Employee[]>([]);
  const [leaveTypes,  setLeaveTypes]  = useState<LeaveType[]>([]);
  const [empSearch,   setEmpSearch]   = useState('');
  const [dataLoading, setDataLoading] = useState(false);
  const [pickerMode,  setPickerMode]  = useState<'employee' | 'leaveType' | null>(null);

  const days = calcDays(startDate, endDate);

  useEffect(() => {
    setDataLoading(true);
    Promise.allSettled([
      api.get('/hr/employees', { params: { limit: 200, status: 'Active' } }),
      api.get('/hr/leave-types', { params: { limit: 50 } }),
    ]).then(([empRes, ltRes]) => {
      if (empRes.status === 'fulfilled') {
        const raw = empRes.value.data?.data ?? empRes.value.data?.employees ?? empRes.value.data;
        setEmployees(Array.isArray(raw) ? raw : []);
      }
      if (ltRes.status === 'fulfilled') {
        const raw = ltRes.value.data?.data ?? ltRes.value.data?.leaveTypes ?? ltRes.value.data;
        setLeaveTypes(Array.isArray(raw) ? raw : []);
      }
    }).finally(() => setDataLoading(false));
  }, []);

  const filteredEmps = employees.filter(e => {
    const q = empSearch.toLowerCase();
    const name = `${e.surname} ${e.otherNames}`.toLowerCase();
    return name.includes(q) || (e.employeeId ?? '').toLowerCase().includes(q);
  });

  const handleSubmit = async () => {
    if (!employeeId)        { Alert.alert('Required', 'Select an employee.'); return; }
    if (!leaveTypeId)       { Alert.alert('Required', 'Select leave type.'); return; }
    if (!startDate.trim())  { Alert.alert('Required', 'Enter start date.'); return; }
    if (!endDate.trim())    { Alert.alert('Required', 'Enter end date.'); return; }
    if (days <= 0)          { Alert.alert('Invalid', 'End date must be on or after start date.'); return; }
    setSubmitting(true);
    try {
      await api.post('/hr/leave-applications', {
        employee:  employeeId,
        leaveType: leaveTypeId,
        startDate,
        endDate,
        days,
        reason: reason.trim() || undefined,
      });
      router.back();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to submit leave application.');
    } finally { setSubmitting(false); }
  };

  return (
    <>
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Employee */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>EMPLOYEE <Text style={{ color: '#DC2626' }}>*</Text></Text>
              <TouchableOpacity
                style={styles.pickerBtn}
                onPress={() => { setPickerMode('employee'); setEmpSearch(''); }}
              >
                <Ionicons name="person-outline" size={15} color={employeeId ? HC : '#94A3B8'} />
                <Text style={[styles.pickerBtnTxt, employeeId && { color: '#0F172A' }]} numberOfLines={1}>
                  {employeeName || 'Select employee...'}
                </Text>
                <Ionicons name="chevron-down" size={15} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {/* Leave Type */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>LEAVE TYPE <Text style={{ color: '#DC2626' }}>*</Text></Text>
              <TouchableOpacity
                style={styles.pickerBtn}
                onPress={() => setPickerMode('leaveType')}
              >
                <Ionicons name="calendar-outline" size={15} color={leaveTypeId ? HC : '#94A3B8'} />
                <Text style={[styles.pickerBtnTxt, leaveTypeId && { color: '#0F172A' }]} numberOfLines={1}>
                  {leaveTypeName || 'Select leave type...'}
                </Text>
                <Ionicons name="chevron-down" size={15} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {/* Dates */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>DATES <Text style={{ color: '#DC2626' }}>*</Text></Text>
              <DateField label="START DATE" value={startDate} onChange={setStartDate} required />
              <DateField label="END DATE" value={endDate} onChange={setEndDate} required />
              {days > 0 && (
                <View style={styles.daysBanner}>
                  <Ionicons name="moon-outline" size={14} color={HC} />
                  <Text style={styles.daysBannerTxt}>
                    {days} day{days !== 1 ? 's' : ''} of leave
                  </Text>
                </View>
              )}
            </View>

            {/* Reason */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>REASON (OPTIONAL)</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                value={reason}
                onChangeText={setReason}
                placeholder="Reason for leave..."
                placeholderTextColor="#94A3B8"
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="send-outline" size={18} color="#fff" />
                  <Text style={styles.submitTxt}>Submit Application</Text>
                  {days > 0 && (
                    <Text style={styles.submitSub}>· {days} day{days !== 1 ? 's' : ''}</Text>
                  )}
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Employee / Leave Type picker modal */}
      <Modal
        visible={!!pickerMode}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickerMode(null)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {pickerMode === 'employee' ? 'Select Employee' : 'Select Leave Type'}
            </Text>
            <TouchableOpacity onPress={() => setPickerMode(null)}>
              <Ionicons name="close" size={24} color="#475569" />
            </TouchableOpacity>
          </View>

          {pickerMode === 'employee' && (
            <View style={styles.modalSearch}>
              <Ionicons name="search-outline" size={16} color="#94A3B8" />
              <TextInput
                style={{ flex: 1, fontSize: 15, color: '#0F172A' }}
                placeholder="Name or employee ID..."
                placeholderTextColor="#94A3B8"
                value={empSearch}
                onChangeText={setEmpSearch}
                autoFocus
              />
            </View>
          )}

          {dataLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={HC} />
            </View>
          ) : (
            <FlatList
              data={(pickerMode === 'employee' ? filteredEmps : leaveTypes) as any[]}
              keyExtractor={i => i._id}
              contentContainerStyle={{ padding: 16, gap: 6 }}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View style={styles.centered}>
                  <Ionicons name="search-outline" size={32} color="#CBD5E1" />
                  <Text style={{ color: '#94A3B8', fontSize: 14 }}>No results</Text>
                </View>
              }
              renderItem={({ item }) => {
                if (pickerMode === 'employee') {
                  const e = item as Employee;
                  const name = `${e.surname} ${e.otherNames}`.trim();
                  const dept = typeof e.department === 'object' ? e.department?.name : e.department;
                  return (
                    <TouchableOpacity
                      style={styles.rowItem}
                      onPress={() => { setEmployeeId(e._id); setEmployeeName(name); setPickerMode(null); }}
                    >
                      <View style={[styles.miniAvatar, { backgroundColor: HC + '15' }]}>
                        <Text style={{ fontSize: 11, fontWeight: '900', color: HC }}>
                          {`${e.surname.charAt(0)}${e.otherNames.charAt(0)}`.toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowItemTxt}>{name}</Text>
                        {dept ? <Text style={styles.rowItemSub}>{dept}</Text> : null}
                      </View>
                      {e.employeeId ? <Text style={styles.rowItemCode}>{e.employeeId}</Text> : null}
                    </TouchableOpacity>
                  );
                }
                const lt = item as LeaveType;
                return (
                  <TouchableOpacity
                    style={styles.rowItem}
                    onPress={() => { setLeaveTypeId(lt._id); setLeaveTypeName(lt.name); setPickerMode(null); }}
                  >
                    <Ionicons name="calendar-outline" size={16} color={HC} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowItemTxt}>{lt.name}</Text>
                      {lt.daysAllowed ? (
                        <Text style={styles.rowItemSub}>{lt.daysAllowed} days allowed/year</Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#F5F3FF' },
  scroll: { padding: 16, gap: 20, paddingBottom: 16 },

  section:      { gap: 10 },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8' },
  label:        { fontSize: 12, fontWeight: '700', color: '#475569' },
  row2:         { flexDirection: 'row', gap: 10 },

  input:    { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#0F172A' },
  textarea: { minHeight: 90, paddingTop: 11 },

  pickerBtn:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 12, paddingVertical: 13 },
  pickerBtnTxt: { flex: 1, fontSize: 14, color: '#94A3B8', fontWeight: '500' },

  daysBanner:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: HC + '10', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: HC + '30' },
  daysBannerTxt: { fontSize: 14, fontWeight: '700', color: HC },

  footer:    { borderTopWidth: 1, borderTopColor: '#E2E8F0', backgroundColor: '#fff', padding: 16 },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: HC, borderRadius: 14, paddingVertical: 15 },
  submitTxt: { fontSize: 16, fontWeight: '800', color: '#fff' },
  submitSub: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.65)' },

  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  modalTitle:  { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  modalSearch: { flexDirection: 'row', alignItems: 'center', gap: 10, margin: 16, marginTop: 12, backgroundColor: '#F8FAFC', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 12, height: 46 },

  centered:   { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 40 },
  rowItem:    { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#F1F5F9' },
  rowItemCode:{ fontSize: 11, fontWeight: '700', color: '#94A3B8' },
  rowItemTxt: { fontSize: 14, fontWeight: '600', color: '#0F172A' },
  rowItemSub: { fontSize: 12, color: '#94A3B8', marginTop: 1 },
  miniAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
