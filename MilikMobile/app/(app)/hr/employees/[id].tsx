import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const HC = '#4C1D95';

type Employee = {
  _id:              string;
  employeeId?:      string;
  surname:          string;
  otherNames:       string;
  phone?:           string;
  email?:           string;
  nationalId?:      string;
  gender?:          string;
  dob?:             string;
  department?:      { name?: string } | string;
  designation?:     { name?: string } | string;
  employmentType?:  string;
  status:           string;
  joinDate?:        string;
  contractEndDate?: string;
  grossSalary?:     number;
  bankName?:        string;
  bankAccount?:     string;
  nhifNo?:          string;
  nssfNo?:          string;
  kraPin?:          string;
  nextOfKin?:       string;
  nextOfKinPhone?:  string;
  address?:         string;
};

const STATUS_CFG: Record<string, { bg: string; color: string }> = {
  Active:     { bg: '#D1FAE5', color: '#065F46' },
  Probation:  { bg: '#FEF3C7', color: '#D97706' },
  Suspended:  { bg: '#FFEDD5', color: '#EA580C' },
  Terminated: { bg: '#FEE2E2', color: '#DC2626' },
};

const fmt = (d: string) =>
  new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });

const fmtKES = (n: number) =>
  `KES ${Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

const getName = (e: Employee) => `${e.surname} ${e.otherNames}`.trim();
const getDept = (d: Employee['department']) =>
  typeof d === 'object' ? (d?.name ?? '') : (d ?? '');
const getDesig = (d: Employee['designation']) =>
  typeof d === 'object' ? (d?.name ?? '') : (d ?? '');

const initials = (s = '', o = '') => `${s.charAt(0)}${o.charAt(0)}`.toUpperCase() || '?';

export default function EmployeeProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();

  const [emp,     setEmp]     = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/hr/employees/${id}`);
      setEmp(data?.data ?? data?.employee ?? data);
    } catch { Alert.alert('Error', 'Could not load employee.'); router.back(); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <MilikLoader fullscreen />;
  if (!emp)    return null;

  const sc = STATUS_CFG[emp.status] ?? STATUS_CFG.Active;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Hero */}
        <View style={styles.hero}>
          <View style={[styles.avatar, { backgroundColor: HC + '30' }]}>
            <Text style={[styles.avatarTxt, { color: HC }]}>
              {initials(emp.surname, emp.otherNames)}
            </Text>
          </View>
          <Text style={styles.heroName}>{getName(emp)}</Text>
          {getDesig(emp.designation) ? (
            <Text style={styles.heroDesig}>{getDesig(emp.designation)}</Text>
          ) : null}
          <View style={styles.heroRow}>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{emp.status}</Text>
            </View>
            {emp.employmentType && (
              <View style={styles.typePill}>
                <Text style={styles.typePillTxt}>{emp.employmentType}</Text>
              </View>
            )}
          </View>
          {/* Contact shortcuts */}
          <View style={styles.contactRow}>
            {emp.phone && (
              <TouchableOpacity
                style={styles.contactBtn}
                onPress={() => Linking.openURL(`tel:${emp.phone}`)}
              >
                <Ionicons name="call-outline" size={18} color="#fff" />
                <Text style={styles.contactBtnTxt}>Call</Text>
              </TouchableOpacity>
            )}
            {emp.email && (
              <TouchableOpacity
                style={styles.contactBtn}
                onPress={() => Linking.openURL(`mailto:${emp.email}`)}
              >
                <Ionicons name="mail-outline" size={18} color="#fff" />
                <Text style={styles.contactBtnTxt}>Email</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Personal */}
        <InfoCard title="PERSONAL DETAILS">
          <FieldRow label="Employee ID"  value={emp.employeeId}  />
          <FieldRow label="National ID"  value={emp.nationalId}  />
          <FieldRow label="Gender"       value={emp.gender}      />
          <FieldRow label="Date of Birth" value={emp.dob ? fmt(emp.dob) : undefined} />
          <FieldRow label="Phone"        value={emp.phone}       />
          <FieldRow label="Email"        value={emp.email}       />
          <FieldRow label="Address"      value={emp.address}     />
        </InfoCard>

        {/* Employment */}
        <InfoCard title="EMPLOYMENT">
          <FieldRow label="Department"   value={getDept(emp.department)}   />
          <FieldRow label="Designation"  value={getDesig(emp.designation)} />
          <FieldRow label="Type"         value={emp.employmentType}        />
          <FieldRow label="Join Date"    value={emp.joinDate ? fmt(emp.joinDate) : undefined} />
          {emp.contractEndDate && (
            <FieldRow label="Contract End" value={fmt(emp.contractEndDate)} />
          )}
          {emp.grossSalary != null && (
            <FieldRow label="Gross Salary" value={fmtKES(emp.grossSalary)} />
          )}
        </InfoCard>

        {/* Statutory */}
        {(emp.kraPin || emp.nhifNo || emp.nssfNo) && (
          <InfoCard title="STATUTORY">
            <FieldRow label="KRA PIN"   value={emp.kraPin}  />
            <FieldRow label="NHIF No."  value={emp.nhifNo}  />
            <FieldRow label="NSSF No."  value={emp.nssfNo}  />
          </InfoCard>
        )}

        {/* Bank */}
        {(emp.bankName || emp.bankAccount) && (
          <InfoCard title="BANKING">
            <FieldRow label="Bank"    value={emp.bankName}    />
            <FieldRow label="Account" value={emp.bankAccount} />
          </InfoCard>
        )}

        {/* Next of kin */}
        {emp.nextOfKin && (
          <InfoCard title="NEXT OF KIN">
            <FieldRow label="Name"  value={emp.nextOfKin}      />
            <FieldRow label="Phone" value={emp.nextOfKinPhone}  />
          </InfoCard>
        )}
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

  hero: {
    backgroundColor: '#fff', borderRadius: 20,
    borderWidth: 1, borderColor: '#E2E8F0',
    padding: 20, alignItems: 'center', gap: 8,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center',
  },
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
  fieldLabel: { fontSize: 12, color: '#94A3B8', width: 100 },
  fieldValue: { flex: 1, fontSize: 13, fontWeight: '600', color: '#0F172A' },
});
