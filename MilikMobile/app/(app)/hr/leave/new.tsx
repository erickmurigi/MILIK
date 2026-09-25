import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Alert,
  Modal, FlatList, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../../services/api';
import { DateField } from '../../../../components/ui/DateField';
import { useDebounced, usePmsList } from '../../../../hooks/usePmsList';
import { todayISO } from '../../../../utils/pmsFormat';
import {
  HC, employeesOf, hrError, initialsOf, leaveRequestBody, leaveTypesOf, personName, refLabel, workingDays,
  type HrEmployee, type LeaveType,
} from '../../../../utils/hr';

type Balance = { entitlement: number; used: number; pending: number; remaining: number };

const dayLabel = (n: number) => `${n} day${n !== 1 ? 's' : ''}`;

export default function NewLeaveScreen() {
  const router = useRouter();

  const [employee,   setEmployee]   = useState<HrEmployee | null>(null);
  const [leaveType,  setLeaveType]  = useState<LeaveType | null>(null);
  const [startDate,  setStartDate]  = useState(todayISO());
  const [endDate,    setEndDate]    = useState(todayISO());
  const [reason,     setReason]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const [leaveTypes,   setLeaveTypes]   = useState<LeaveType[]>([]);
  const [typesLoading, setTypesLoading] = useState(true);
  const [typesError,   setTypesError]   = useState<string | null>(null);
  const [pickerMode,   setPickerMode]   = useState<'employee' | 'leaveType' | null>(null);
  const [balance,      setBalance]      = useState<Balance | null>(null);

  const days = workingDays(startDate, endDate);

  const loadTypes = async () => {
    setTypesLoading(true);
    setTypesError(null);
    try {
      const { data } = await api.get('/hr/leave-types');
      setLeaveTypes(leaveTypesOf(data));
    } catch (err) {
      setTypesError(hrError(err, 'Could not load leave types.'));
    } finally { setTypesLoading(false); }
  };
  useEffect(() => { loadTypes(); }, []);

  // Entitlement / used / remaining for the chosen person + type + year (informational; the server does not block overdrawn leave).
  const year = startDate.slice(0, 4);
  useEffect(() => {
    setBalance(null);
    if (!employee || !leaveType || !/^\d{4}$/.test(year)) return;
    let live = true;
    api.get('/hr/leave-balances', { params: { year, leaveTypeId: leaveType._id } })
      .then(({ data }) => {
        if (!live) return;
        const row = (Array.isArray(data) ? data : []).find((r: any) => String(r.employeeId) === String(employee._id));
        if (row) setBalance({ entitlement: row.entitlement, used: row.used, pending: row.pending, remaining: row.remaining });
      })
      .catch(() => { /* balance is a hint only */ });
    return () => { live = false; };
  }, [employee, leaveType, year]);

  const overdrawn = balance != null && days > balance.remaining;

  const onStart = (v: string) => {
    setStartDate(v);
    if (endDate < v) setEndDate(v);   // keep the range valid
  };

  const submit = async () => {
    if (submittingRef.current) return;
    if (!employee)        { Alert.alert('Required', 'Select an employee.'); return; }
    if (!leaveType)       { Alert.alert('Required', 'Select a leave type.'); return; }
    if (!startDate || !endDate) { Alert.alert('Required', 'Choose the start and end dates.'); return; }
    if (days <= 0)        { Alert.alert('Invalid dates', 'The end date must be on or after the start date.'); return; }

    const send = async () => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setSubmitting(true);
      try {
        const { data } = await api.post('/hr/leave-applications', leaveRequestBody({
          employeeId: employee._id, leaveTypeId: leaveType._id, startDate, endDate, reason,
        }));
        const auto = data?.status === 'Approved';
        Alert.alert(
          auto ? 'Leave recorded' : 'Application submitted',
          auto ? `${leaveType.name} does not need approval, so it is already approved.` : 'It is now pending approval.',
          [{ text: 'OK', onPress: () => router.back() }],
        );
      } catch (err) {
        Alert.alert('Could not submit', hrError(err, 'Failed to submit the leave application.'));
      } finally { submittingRef.current = false; setSubmitting(false); }
    };

    if (overdrawn && balance) {
      Alert.alert(
        'Over the balance',
        `${personName(employee)} has ${dayLabel(balance.remaining)} of ${leaveType.name} left this year, and this request is for ${dayLabel(days)}. Submit anyway?`,
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Submit', onPress: send }],
      );
      return;
    }
    send();
  };

  return (
    <>
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>EMPLOYEE <Text style={{ color: '#DC2626' }}>*</Text></Text>
              <TouchableOpacity style={styles.pickerBtn} onPress={() => setPickerMode('employee')}>
                <Ionicons name="person-outline" size={15} color={employee ? HC : '#94A3B8'} />
                <Text style={[styles.pickerBtnTxt, employee && { color: '#0F172A' }]} numberOfLines={1}>
                  {employee ? `${personName(employee)}${employee.employeeNumber ? `  ·  ${employee.employeeNumber}` : ''}` : 'Select employee...'}
                </Text>
                <Ionicons name="chevron-down" size={15} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>LEAVE TYPE <Text style={{ color: '#DC2626' }}>*</Text></Text>
              <TouchableOpacity style={styles.pickerBtn} onPress={() => setPickerMode('leaveType')}>
                <Ionicons name="calendar-outline" size={15} color={leaveType ? HC : '#94A3B8'} />
                <Text style={[styles.pickerBtnTxt, leaveType && { color: '#0F172A' }]} numberOfLines={1}>
                  {leaveType ? leaveType.name : 'Select leave type...'}
                </Text>
                <Ionicons name="chevron-down" size={15} color="#94A3B8" />
              </TouchableOpacity>
              {balance ? (
                <View style={[styles.balanceBox, overdrawn && styles.balanceBoxWarn]}>
                  <Ionicons name="information-circle-outline" size={15} color={overdrawn ? '#B45309' : HC} />
                  <Text style={[styles.balanceTxt, overdrawn && { color: '#B45309' }]}>
                    {dayLabel(balance.remaining)} left of {dayLabel(balance.entitlement)} this year
                    {balance.pending > 0 ? ` (${dayLabel(balance.pending)} pending)` : ''}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>DATES <Text style={{ color: '#DC2626' }}>*</Text></Text>
              <DateField key={`s-${startDate}`} label="START DATE" value={startDate} onChange={onStart} required />
              <DateField key={`e-${endDate}`} label="END DATE" value={endDate} onChange={setEndDate} required />
              {days > 0 ? (
                <View style={styles.daysBanner}>
                  <Ionicons name="moon-outline" size={14} color={HC} />
                  <Text style={styles.daysBannerTxt}>{dayLabel(days)} of leave (Mon–Fri)</Text>
                </View>
              ) : (
                <Text style={styles.invalid}>The end date must be on or after the start date.</Text>
              )}
            </View>

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
                maxLength={500}
              />
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.submitBtn, (submitting || days <= 0) && { opacity: 0.6 }]}
              onPress={submit}
              disabled={submitting || days <= 0}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="send-outline" size={18} color="#fff" />
                  <Text style={styles.submitTxt}>Submit Application</Text>
                  {days > 0 ? <Text style={styles.submitSub}>· {dayLabel(days)}</Text> : null}
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Modal visible={!!pickerMode} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPickerMode(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{pickerMode === 'employee' ? 'Select Employee' : 'Select Leave Type'}</Text>
            <TouchableOpacity onPress={() => setPickerMode(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={24} color="#475569" />
            </TouchableOpacity>
          </View>

          {pickerMode === 'employee' ? (
            <EmployeePicker onPick={e => { setEmployee(e); setPickerMode(null); }} />
          ) : pickerMode === 'leaveType' ? (
            <FlatList
              data={leaveTypes}
              keyExtractor={t => t._id}
              contentContainerStyle={{ padding: 16, gap: 6 }}
              ListEmptyComponent={
                typesLoading ? <View style={styles.centered}><ActivityIndicator color={HC} /></View> : (
                  <View style={styles.centered}>
                    <Ionicons name={typesError ? 'cloud-offline-outline' : 'calendar-outline'} size={32} color="#CBD5E1" />
                    <Text style={styles.emptyPick}>{typesError ?? 'No active leave types. Add them on the web under HR > Leave Types.'}</Text>
                    {typesError ? (
                      <TouchableOpacity onPress={loadTypes}><Text style={styles.retry}>Try again</Text></TouchableOpacity>
                    ) : null}
                  </View>
                )
              }
              renderItem={({ item: lt }) => (
                <TouchableOpacity style={styles.rowItem} onPress={() => { setLeaveType(lt); setPickerMode(null); }}>
                  <Ionicons name="calendar-outline" size={16} color={HC} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowItemTxt}>{lt.name}</Text>
                    <Text style={styles.rowItemSub}>
                      {lt.daysPerYear ? `${lt.daysPerYear} days a year` : 'No yearly limit'}{lt.isPaid === false ? ' · Unpaid' : ''}
                      {lt.requiresApproval === false ? ' · No approval needed' : ''}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          ) : null}
        </SafeAreaView>
      </Modal>
    </>
  );
}

/** Server-side searched, paged list of the people who can take leave (terminated staff are hidden). */
function EmployeePicker({ onPick }: { onPick: (e: HrEmployee) => void }) {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search.trim(), 350);
  const params = useMemo(() => ({ search: debounced || undefined }), [debounced]);
  const list = usePmsList<HrEmployee>({ path: '/hr/employees', params, limit: 30, parse: employeesOf });
  const rows = useMemo(() => list.items.filter(e => e.status !== 'Terminated'), [list.items]);

  return (
    <>
      <View style={styles.modalSearch}>
        <Ionicons name="search-outline" size={16} color="#94A3B8" />
        <TextInput
          style={{ flex: 1, fontSize: 15, color: '#0F172A' }}
          placeholder="Name, number, phone, department..."
          placeholderTextColor="#94A3B8"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoFocus
        />
      </View>
      <FlatList
        data={rows}
        keyExtractor={e => e._id}
        contentContainerStyle={{ padding: 16, gap: 6 }}
        keyboardShouldPersistTaps="handled"
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          list.loading ? <View style={styles.centered}><ActivityIndicator color={HC} /></View> : (
            <View style={styles.centered}>
              <Ionicons name={list.error ? 'cloud-offline-outline' : 'search-outline'} size={32} color="#CBD5E1" />
              <Text style={styles.emptyPick}>{list.error ?? 'No employees found'}</Text>
              {list.error ? <TouchableOpacity onPress={list.retry}><Text style={styles.retry}>Try again</Text></TouchableOpacity> : null}
            </View>
          )
        }
        ListFooterComponent={list.loadingMore ? <ActivityIndicator color={HC} style={{ padding: 16 }} /> : null}
        renderItem={({ item: e }) => (
          <TouchableOpacity style={styles.rowItem} onPress={() => onPick(e)}>
            <View style={[styles.miniAvatar, { backgroundColor: HC + '15' }]}>
              <Text style={{ fontSize: 11, fontWeight: '900', color: HC }}>{initialsOf(e)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowItemTxt}>{personName(e)}</Text>
              {refLabel(e.department) ? <Text style={styles.rowItemSub}>{refLabel(e.department)}</Text> : null}
            </View>
            {e.employeeNumber ? <Text style={styles.rowItemCode}>{e.employeeNumber}</Text> : null}
          </TouchableOpacity>
        )}
      />
    </>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#F5F3FF' },
  scroll: { padding: 16, gap: 20, paddingBottom: 16 },

  section:      { gap: 10 },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8' },

  input:    { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#0F172A' },
  textarea: { minHeight: 90, paddingTop: 11 },

  pickerBtn:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 12, paddingVertical: 13 },
  pickerBtnTxt: { flex: 1, fontSize: 14, color: '#94A3B8', fontWeight: '500' },

  balanceBox:     { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: HC + '0D', borderRadius: 10, padding: 10 },
  balanceBoxWarn: { backgroundColor: '#FFFBEB' },
  balanceTxt:     { flex: 1, fontSize: 12, fontWeight: '600', color: HC },

  daysBanner:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: HC + '10', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: HC + '30' },
  daysBannerTxt: { fontSize: 14, fontWeight: '700', color: HC },
  invalid:       { fontSize: 12, fontWeight: '600', color: '#DC2626' },

  footer:    { borderTopWidth: 1, borderTopColor: '#E2E8F0', backgroundColor: '#fff', padding: 16 },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: HC, borderRadius: 14, paddingVertical: 15 },
  submitTxt: { fontSize: 16, fontWeight: '800', color: '#fff' },
  submitSub: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.65)' },

  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  modalTitle:  { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  modalSearch: { flexDirection: 'row', alignItems: 'center', gap: 10, margin: 16, marginTop: 12, backgroundColor: '#F8FAFC', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 12, height: 46 },

  centered:   { alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 40, paddingHorizontal: 24 },
  emptyPick:  { color: '#94A3B8', fontSize: 14, textAlign: 'center' },
  retry:      { color: HC, fontSize: 14, fontWeight: '800' },
  rowItem:    { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#F1F5F9' },
  rowItemCode:{ fontSize: 11, fontWeight: '700', color: '#94A3B8' },
  rowItemTxt: { fontSize: 14, fontWeight: '600', color: '#0F172A' },
  rowItemSub: { fontSize: 12, color: '#94A3B8', marginTop: 1 },
  miniAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
