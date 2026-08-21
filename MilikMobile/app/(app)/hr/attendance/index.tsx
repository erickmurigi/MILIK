import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const HC = '#4C1D95';

type AttendanceRecord = {
  _id:          string;
  employee?:    { surname?: string; otherNames?: string } | string;
  date:         string;
  status:       string;
  checkIn?:     string;
  checkOut?:    string;
  hoursWorked?: number;
  notes?:       string;
};

const STATUS_CFG: Record<string, { bg: string; color: string; label: string }> = {
  Present:  { bg: '#D1FAE5', color: '#065F46', label: 'Present'  },
  Absent:   { bg: '#FEE2E2', color: '#DC2626', label: 'Absent'   },
  Late:     { bg: '#FEF3C7', color: '#D97706', label: 'Late'     },
  HalfDay:  { bg: '#EDE9FE', color: '#7C3AED', label: 'Half Day' },
  Leave:    { bg: '#E0F2FE', color: '#0369A1', label: 'Leave'    },
};

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });

const getEmpName = (e: AttendanceRecord['employee']) =>
  typeof e === 'object'
    ? `${e?.surname ?? ''} ${e?.otherNames ?? ''}`.trim()
    : (e ?? '—');

// navigate days
const addDays = (dateStr: string, n: number) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const LIMIT = 200;

export default function AttendanceScreen() {
  const [date,       setDate]       = useState(todayStr());
  const [items,      setItems]      = useState<AttendanceRecord[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary,    setSummary]    = useState({ present: 0, absent: 0, late: 0, halfDay: 0, leave: 0 });

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const { data } = await api.get('/hr/attendance', { params: { date, limit: LIMIT } });
      const rows: AttendanceRecord[] = data?.data ?? data?.records ?? (Array.isArray(data) ? data : []);
      setItems(rows);
      setSummary({
        present: rows.filter(r => r.status === 'Present').length,
        absent:  rows.filter(r => r.status === 'Absent').length,
        late:    rows.filter(r => r.status === 'Late').length,
        halfDay: rows.filter(r => r.status === 'HalfDay').length,
        leave:   rows.filter(r => r.status === 'Leave').length,
      });
    } catch (err: any) {
      setItems([]);
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to load attendance records.');
    }
    finally { setLoading(false); setRefreshing(false); }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const isToday = date === todayStr();

  const renderItem = ({ item }: { item: AttendanceRecord }) => {
    const sc = STATUS_CFG[item.status] ?? STATUS_CFG.Present;
    return (
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.empName} numberOfLines={1}>{getEmpName(item.employee)}</Text>
          {(item.checkIn || item.checkOut) && (
            <Text style={styles.times}>
              {item.checkIn ? `In: ${item.checkIn}` : ''}
              {item.checkIn && item.checkOut ? '  ·  ' : ''}
              {item.checkOut ? `Out: ${item.checkOut}` : ''}
              {item.hoursWorked ? `  ·  ${item.hoursWorked.toFixed(1)}h` : ''}
            </Text>
          )}
        </View>
        <View style={[styles.badge, { backgroundColor: sc.bg }]}>
          <Text style={[styles.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Date navigator */}
      <View style={styles.dateNav}>
        <TouchableOpacity style={styles.navBtn} onPress={() => setDate(d => addDays(d, -1))}>
          <Ionicons name="chevron-back" size={20} color={HC} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.dateMain}>{fmtDate(date)}</Text>
          {isToday && <Text style={styles.todayLbl}>Today</Text>}
        </View>
        <TouchableOpacity
          style={[styles.navBtn, isToday && { opacity: 0.3 }]}
          onPress={() => setDate(d => addDays(d, 1))}
          disabled={isToday}
        >
          <Ionicons name="chevron-forward" size={20} color={HC} />
        </TouchableOpacity>
      </View>

      {/* Summary strip */}
      {!loading && items.length > 0 && (
        <View style={styles.summaryRow}>
          {[
            { label: 'Present',  value: summary.present,  color: '#065F46' },
            { label: 'Absent',   value: summary.absent,   color: '#DC2626' },
            { label: 'Late',     value: summary.late,     color: '#D97706' },
            { label: 'Half Day', value: summary.halfDay,  color: '#7C3AED' },
            { label: 'Leave',    value: summary.leave,    color: '#0369A1' },
          ].map(s => (
            <View key={s.label} style={styles.sumItem}>
              <Text style={[styles.sumVal, { color: s.color }]}>{s.value}</Text>
              <Text style={styles.sumLbl}>{s.label}</Text>
            </View>
          ))}
        </View>
      )}

      {loading ? <MilikLoader fullscreen /> : (
        <FlatList
          data={items}
          keyExtractor={r => r._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: '#F1F5F9' }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={HC} />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="time-outline" size={48} color="#CBD5E1" />
              <Text style={styles.emptyTxt}>No attendance records for this date</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F3FF' },

  dateNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  navBtn:   { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  dateMain: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  todayLbl: { fontSize: 10, fontWeight: '600', color: HC, marginTop: 1 },

  summaryRow: {
    flexDirection: 'row', backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
    paddingVertical: 10,
  },
  sumItem: { flex: 1, alignItems: 'center', gap: 2 },
  sumVal:  { fontSize: 18, fontWeight: '900' },
  sumLbl:  { fontSize: 9, fontWeight: '600', color: '#94A3B8', letterSpacing: 0.5 },

  list:      { paddingBottom: 40 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8', textAlign: 'center' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 12,
  },
  empName: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  times:   { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  badge:   { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt:{ fontSize: 10, fontWeight: '800' },
});
