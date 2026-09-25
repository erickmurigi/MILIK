import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Linking, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { ErrorState } from '../../../../components/ui/PmsStates';
import { fmtDate, fmtKES } from '../../../../utils/pmsFormat';
import { HC, grossSalary, hrError, initialsOf, personName, refLabel, type HrEmployee } from '../../../../utils/hr';

const STATUS_CFG: Record<string, { bg: string; color: string }> = {
  Active:     { bg: '#D1FAE5', color: '#065F46' },
  Probation:  { bg: '#FEF3C7', color: '#D97706' },
  Suspended:  { bg: '#FFEDD5', color: '#EA580C' },
  Terminated: { bg: '#FEE2E2', color: '#DC2626' },
};

const dateOrUndef = (d?: string | null) => (d ? fmtDate(d) : undefined);

export default function EmployeeProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [emp,        setEmp]        = useState<HrEmployee | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const reqRef = useRef(0);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    const req = ++reqRef.current;
    if (mode === 'refresh') setRefreshing(true); else setLoading(true);
    try {
      const { data } = await api.get(`/hr/employees/${id}`);
      if (req !== reqRef.current) return;
      setEmp(data && typeof data === 'object' && data._id ? (data as HrEmployee) : null);
      setError(data?._id ? null : 'Employee not found.');
    } catch (err) {
      if (req !== reqRef.current) return;
      setError(hrError(err, 'Could not load this employee.'));
    } finally {
      if (req === reqRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const dial = (url: string) => Linking.openURL(url).catch(() => Alert.alert('Not available', 'This device cannot open that link.'));

  if (loading) return <MilikLoader fullscreen />;
  if (!emp) return <ErrorState message={error ?? 'Employee not found.'} onRetry={() => load()} />;

  const sc         = STATUS_CFG[emp.status] ?? STATUS_CFG.Active;
  const desig      = refLabel(emp.designation);
  const phone      = emp.phoneNumber?.replace(/\s+/g, '');
  const components = emp.salaryComponents ?? [];
  const basic      = Number(emp.basicSalary) || 0;
  const hasPay     = basic > 0 || components.length > 0;
  const reportsTo  = emp.reportsTo ? personName(emp.reportsTo) : '';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={HC} />}
      >
        {error ? (
          <TouchableOpacity style={styles.banner} onPress={() => load()} activeOpacity={0.8}>
            <Ionicons name="alert-circle-outline" size={16} color="#DC2626" />
            <Text style={styles.bannerTxt} numberOfLines={2}>{error}</Text>
            <Text style={styles.bannerRetry}>Retry</Text>
          </TouchableOpacity>
        ) : null}

        {/* Hero */}
        <View style={styles.hero}>
          <View style={[styles.avatar, { backgroundColor: HC + '30' }]}>
            <Text style={[styles.avatarTxt, { color: HC }]}>{initialsOf(emp)}</Text>
          </View>
          <Text style={styles.heroName}>{personName(emp)}</Text>
          {desig ? <Text style={styles.heroDesig}>{desig}</Text> : null}
          <View style={styles.heroRow}>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{emp.status}</Text>
            </View>
            {emp.employmentType ? (
              <View style={styles.typePill}>
                <Text style={styles.typePillTxt}>{emp.employmentType}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.contactRow}>
            {phone ? (
              <TouchableOpacity style={styles.contactBtn} onPress={() => dial(`tel:${phone}`)}>
                <Ionicons name="call-outline" size={18} color="#fff" />
                <Text style={styles.contactBtnTxt}>Call</Text>
              </TouchableOpacity>
            ) : null}
            {emp.email ? (
              <TouchableOpacity style={styles.contactBtn} onPress={() => dial(`mailto:${emp.email}`)}>
                <Ionicons name="mail-outline" size={18} color="#fff" />
                <Text style={styles.contactBtnTxt}>Email</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <InfoCard title="PERSONAL DETAILS">
          <FieldRow label="Employee No." value={emp.employeeNumber} />
          <FieldRow label="National ID"  value={emp.nationalId} />
          <FieldRow label="Gender"       value={emp.gender ?? undefined} />
          <FieldRow label="Date of Birth" value={dateOrUndef(emp.dateOfBirth)} />
          <FieldRow label="Phone"        value={emp.phoneNumber} />
          <FieldRow label="Email"        value={emp.email} />
          <FieldRow label="Address"      value={emp.physicalAddress} />
          <FieldRow label="Postal"       value={emp.postalAddress} />
        </InfoCard>

        <InfoCard title="EMPLOYMENT">
          <FieldRow label="Department"   value={refLabel(emp.department)} />
          <FieldRow label="Designation"  value={desig} />
          <FieldRow label="Type"         value={emp.employmentType} />
          <FieldRow label="Reports to"   value={reportsTo === '—' ? '' : reportsTo} />
          <FieldRow label="Date joined"  value={dateOrUndef(emp.dateJoined)} />
          <FieldRow label="Probation ends" value={dateOrUndef(emp.probationEndDate)} />
          <FieldRow label="Contract start" value={dateOrUndef(emp.contractStartDate)} />
          <FieldRow label="Contract end" value={dateOrUndef(emp.contractEndDate)} />
          {emp.status === 'Terminated' ? (
            <>
              <FieldRow label="Terminated" value={dateOrUndef(emp.terminationDate)} />
              <FieldRow label="Reason"     value={emp.terminationReason} />
            </>
          ) : null}
        </InfoCard>

        {(emp.kraPin || emp.nhifNo || emp.nssfNo || emp.helbNo) ? (
          <InfoCard title="STATUTORY">
            <FieldRow label="KRA PIN"  value={emp.kraPin} />
            <FieldRow label="NHIF / SHA" value={emp.nhifNo} />
            <FieldRow label="NSSF No." value={emp.nssfNo} />
            <FieldRow label="HELB No." value={emp.helbNo} />
          </InfoCard>
        ) : null}

        {hasPay ? (
          <InfoCard title="PAY">
            <FieldRow label="Basic salary" value={fmtKES(basic)} />
            <FieldRow label="Gross salary" value={fmtKES(grossSalary(emp))} />
            {components.map((c, i) => {
              const amt = c.isPercentage ? (basic * Number(c.amount)) / 100 : Number(c.amount);
              const sign = c.type === 'Deduction' ? '−' : '+';
              return (
                <FieldRow
                  key={`${c.name}-${i}`}
                  label={c.name}
                  value={`${sign}${fmtKES(amt || 0)}${c.isPercentage ? `  (${c.amount}%)` : ''}`}
                />
              );
            })}
            <FieldRow label="Payment method" value={emp.paymentMethod} />
            {emp.paymentMethod === 'M-Pesa' ? <FieldRow label="M-Pesa No." value={emp.mpesaNumber} /> : null}
            {emp.paymentMethod === 'Bank Transfer' ? (
              <>
                <FieldRow label="Bank"    value={emp.bankName} />
                <FieldRow label="Account" value={emp.bankAccountNumber} />
                <FieldRow label="Branch"  value={emp.bankBranch} />
              </>
            ) : null}
          </InfoCard>
        ) : null}

        {(emp.nextOfKinName || emp.nextOfKinPhone) ? (
          <InfoCard title="NEXT OF KIN">
            <FieldRow label="Name"         value={emp.nextOfKinName} />
            <FieldRow label="Relationship" value={emp.nextOfKinRelationship} />
            <FieldRow label="Phone"        value={emp.nextOfKinPhone} />
          </InfoCard>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function FieldRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#F5F3FF' },
  scroll: { padding: 16, gap: 14, paddingBottom: 40 },

  banner:      { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, backgroundColor: '#FEF2F2', borderRadius: 10, borderWidth: 1, borderColor: '#FECACA' },
  bannerTxt:   { flex: 1, fontSize: 12, color: '#DC2626' },
  bannerRetry: { fontSize: 12, fontWeight: '800', color: '#DC2626' },

  hero: {
    backgroundColor: '#fff', borderRadius: 20,
    borderWidth: 1, borderColor: '#E2E8F0',
    padding: 20, alignItems: 'center', gap: 8,
  },
  avatar: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 28, fontWeight: '900' },
  heroName:  { fontSize: 20, fontWeight: '900', color: '#0F172A', textAlign: 'center' },
  heroDesig: { fontSize: 13, color: '#64748B', fontWeight: '500', textAlign: 'center' },
  heroRow:   { flexDirection: 'row', gap: 8, alignItems: 'center' },
  badge:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeTxt:  { fontSize: 11, fontWeight: '800' },
  typePill:  { backgroundColor: HC + '15', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  typePillTxt:{ fontSize: 11, fontWeight: '700', color: HC },

  contactRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  contactBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: HC, borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 9,
  },
  contactBtnTxt: { fontSize: 13, fontWeight: '700', color: '#fff' },

  card: {
    backgroundColor: '#fff', borderRadius: 16,
    borderWidth: 1, borderColor: '#E2E8F0',
    padding: 16, gap: 10,
  },
  cardTitle: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8', marginBottom: 2 },

  fieldRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  fieldLabel: { fontSize: 12, color: '#94A3B8', width: 104 },
  fieldValue: { flex: 1, fontSize: 13, fontWeight: '600', color: '#0F172A' },
});
