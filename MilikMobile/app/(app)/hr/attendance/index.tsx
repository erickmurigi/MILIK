import { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { ErrorBanner, ErrorState } from '../../../../components/ui/PmsStates';
import { useDebounced, usePmsList } from '../../../../hooks/usePmsList';
import { fmtDate, todayISO } from '../../../../utils/pmsFormat';
import {
  HC, addDaysISO, dayRange, fmtDuration, fmtTime, personName, recordsOf, type AttendanceRec,
} from '../../../../utils/hr';

const parse = (data: any) => recordsOf(data);

export default function AttendanceScreen() {
  const [date,   setDate]   = useState(todayISO());
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search.trim(), 400);

  const listParams = useMemo(() => {
    const { from, to } = dayRange(date);   // the local day, not the UTC one
    return { from, to, search: debouncedSearch || undefined };
  }, [date, debouncedSearch]);

  const list = usePmsList<AttendanceRec>({ path: '/hr/attendance', params: listParams, limit: 50, parse });

  const isToday = date >= todayISO();

  // The counts describe the rows loaded so far (the header shows the server's total).
  const summary = useMemo(() => {
    let out = 0, still = 0, durSum = 0, durN = 0;
    for (const r of list.items) {
      if (r.checkOut) out++; else still++;
      if (r.duration) { durSum += r.duration; durN++; }
    }
    return { out, still, avg: durN ? durSum / durN : 0 };
  }, [list.items]);

  const renderItem = ({ item }: { item: AttendanceRec }) => {
    const emp   = typeof item.employee === 'object' ? item.employee : null;
    const still = !item.checkOut;
    return (
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.empName} numberOfLines={1}>{personName(emp)}</Text>
          <Text style={styles.times}>
            In {fmtTime(item.checkIn)}
            {item.checkOut ? `  ·  Out ${fmtTime(item.checkOut)}  ·  ${fmtDuration(item.duration)}` : ''}
          </Text>
          {emp?.employeeNumber || item.note ? (
            <Text style={styles.sub} numberOfLines={1}>
              {[emp?.employeeNumber, item.note].filter(Boolean).join('  ·  ')}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <View style={[styles.badge, still ? styles.badgeStill : styles.badgeOut]}>
            <Text style={[styles.badgeTxt, { color: still ? '#D97706' : '#065F46' }]}>{still ? 'Still in' : 'Out'}</Text>
          </View>
          {item.source ? <Text style={styles.source}>{item.source === 'ess' ? 'Self-service' : 'Added by admin'}</Text> : null}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Date navigator */}
      <View style={styles.dateNav}>
        <TouchableOpacity style={styles.navBtn} onPress={() => setDate(d => addDaysISO(d, -1))} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Ionicons name="chevron-back" size={20} color={HC} />
        </TouchableOpacity>
        <TouchableOpacity style={{ alignItems: 'center' }} onPress={() => setDate(todayISO())} disabled={isToday} activeOpacity={0.7}>
          <Text style={styles.dateMain}>{fmtDate(`${date}T00:00:00`)}</Text>
          <Text style={styles.todayLbl}>{isToday ? 'Today' : 'Tap for today'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navBtn, isToday && { opacity: 0.3 }]}
          onPress={() => setDate(d => addDaysISO(d, 1))}
          disabled={isToday}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Ionicons name="chevron-forward" size={20} color={HC} />
        </TouchableOpacity>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color="#94A3B8" />
        <TextInput
          style={styles.searchInput}
          placeholder="Employee name, number, department..."
          placeholderTextColor="#94A3B8"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          autoCorrect={false}
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color="#94A3B8" />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Summary strip */}
      {!list.loading && list.items.length > 0 ? (
        <View style={styles.summaryRow}>
          {[
            { label: 'Records',   value: String(list.total || list.items.length), color: '#0F172A' },
            { label: 'Out',       value: String(summary.out),   color: '#065F46' },
            { label: 'Still in',  value: String(summary.still), color: '#D97706' },
            { label: 'Avg time',  value: fmtDuration(Math.round(summary.avg)), color: '#0369A1' },
          ].map(s => (
            <View key={s.label} style={styles.sumItem}>
              <Text style={[styles.sumVal, { color: s.color }]}>{s.value}</Text>
              <Text style={styles.sumLbl}>{s.label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {list.loading ? <MilikLoader fullscreen /> : list.error && list.items.length === 0 ? (
        <ErrorState message={list.error} onRetry={list.retry} />
      ) : (
        <>
          {list.error ? <ErrorBanner message={list.error} onRetry={list.retry} /> : null}
          <FlatList
            data={list.items}
            keyExtractor={r => r._id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: '#F1F5F9' }} />}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} tintColor={HC} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.3}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="time-outline" size={48} color="#CBD5E1" />
                <Text style={styles.emptyTxt}>
                  {debouncedSearch ? 'No attendance records match your search for this day' : 'No attendance records for this day'}
                </Text>
              </View>
            }
            ListFooterComponent={list.loadingMore ? <ActivityIndicator color={HC} style={{ padding: 20 }} /> : null}
          />
        </>
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

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    margin: 12, marginBottom: 8,
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 14, height: 46,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A' },

  summaryRow: {
    flexDirection: 'row', backgroundColor: '#fff',
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#F1F5F9', paddingVertical: 10,
  },
  sumItem: { flex: 1, alignItems: 'center', gap: 2 },
  sumVal:  { fontSize: 17, fontWeight: '900' },
  sumLbl:  { fontSize: 9, fontWeight: '600', color: '#94A3B8', letterSpacing: 0.5 },

  list:      { paddingBottom: 40 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60, paddingHorizontal: 24 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8', textAlign: 'center' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 12,
  },
  empName: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  times:   { fontSize: 12, color: '#475569', marginTop: 2 },
  sub:     { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  badge:   { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeOut:   { backgroundColor: '#D1FAE5' },
  badgeStill: { backgroundColor: '#FEF3C7' },
  badgeTxt:{ fontSize: 10, fontWeight: '800' },
  source:  { fontSize: 9, color: '#94A3B8', fontWeight: '600' },
});
