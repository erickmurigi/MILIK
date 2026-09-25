import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { ErrorState } from '../../../../components/ui/PmsStates';
import { apiError, fmtDate, fmtDateTime, fmtMoney } from '../../../../utils/pmsFormat';

type Maintenance = {
  _id:            string;
  title:          string;
  description:    string;
  priority:       string;
  status:         string;
  assignedTo?:    string;
  estimatedCost?: number;
  actualCost?:    number;
  scheduledDate?: string;
  completedDate?: string;
  createdAt:      string;
  updatedAt:      string;
  tenant?: { name?: string; phone?: string; email?: string } | null;
  unit?:   { unitNumber?: string; property?: { propertyName?: string; name?: string; address?: string } | null } | null;
};

const STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;

const PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
  emergency: { bg: '#FFF1F0', text: '#CF1322' },
  high:      { bg: Colors.dangerLight,  text: Colors.danger  },
  medium:    { bg: Colors.warningLight, text: Colors.warning },
  low:       { bg: Colors.borderLight,  text: Colors.textMuted },
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending:     { bg: Colors.dangerLight,  text: Colors.danger  },
  in_progress: { bg: Colors.warningLight, text: Colors.warning },
  completed:   { bg: Colors.successLight, text: Colors.success },
  cancelled:   { bg: Colors.borderLight,  text: Colors.textMuted },
};

const STATUS_LABEL = (st: string) => st.replace(/_/g, ' ').replace(/\w/g, ch => ch.toUpperCase());

export default function MaintenanceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [item,       setItem]       = useState<Maintenance | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updating,   setUpdating]   = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true);
    else if (mode === 'initial') setLoading(true);
    try {
      const { data } = await api.get(`/maintenances/${id}`);
      setItem((data?.data ?? data) as Maintenance);
      setError(null);
    } catch (err) {
      setError(apiError(err, 'Could not load this request.'));
    } finally { setLoading(false); setRefreshing(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = (newStatus: string) => {
    Alert.alert(
      'Update Status',
      newStatus === 'completed'
        ? 'Mark this request as completed? The completion date will be set to today.'
        : `Change status to "${STATUS_LABEL(newStatus)}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Update',
          onPress: async () => {
            setUpdating(true);
            try {
              await api.put(`/maintenances/status/${id}`, { status: newStatus });
              await load('silent');
            } catch (err: unknown) {
              Alert.alert('Could not update', apiError(err, 'Failed to update status.'));
            } finally { setUpdating(false); }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Maintenance Request' }} />
        <MilikLoader fullscreen />
      </SafeAreaView>
    );
  }

  if (!item) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Maintenance Request' }} />
        <ErrorState message={error ?? 'Request not found'} onRetry={() => load()} />
      </SafeAreaView>
    );
  }

  const pc       = PRIORITY_COLORS[item.priority] ?? PRIORITY_COLORS.low;
  const sc       = STATUS_COLORS[item.status]   ?? STATUS_COLORS.pending;
  const propName = item.unit?.property?.propertyName ?? item.unit?.property?.name ?? '';
  const hasCosts = (item.estimatedCost ?? 0) > 0 || (item.actualCost ?? 0) > 0;

  return (
    <>
      <Stack.Screen options={{ title: (item.title ?? '').length > 30 ? item.title.slice(0, 28) + '…' : (item.title || 'Maintenance Request') }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={Colors.primary} />}
        >
          <View style={styles.heroCard}>
            <View style={styles.heroTop}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.title}>{item.title || 'Untitled request'}</Text>
                <View style={styles.badgeRow}>
                  <View style={[styles.badge, { backgroundColor: sc.bg }]}>
                    <Text style={[styles.badgeText, { color: sc.text }]}>
                      {(item.status ?? '').replace(/_/g, ' ').toUpperCase()}
                    </Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: pc.bg }]}>
                    <Text style={[styles.badgeText, { color: pc.text }]}>
                      {(item.priority ?? 'medium').toUpperCase()} PRIORITY
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {item.unit?.unitNumber || propName ? (
              <View style={styles.infoRow}>
                <Ionicons name="location-outline" size={16} color={Colors.textMuted} />
                <Text style={styles.infoText}>
                  {[item.unit?.unitNumber && `Unit ${item.unit.unitNumber}`, propName].filter(Boolean).join(' · ')}
                </Text>
              </View>
            ) : null}

            {item.tenant?.name ? (
              <View style={styles.infoRow}>
                <Ionicons name="person-outline" size={16} color={Colors.textMuted} />
                <Text style={styles.infoText}>{item.tenant.name}</Text>
                {item.tenant.phone ? (
                  <TouchableOpacity
                    style={styles.callBtn}
                    onPress={() => Linking.openURL(`tel:${item.tenant?.phone}`).catch(() => Alert.alert('Cannot call', 'This device cannot place calls.'))}
                  >
                    <Ionicons name="call-outline" size={14} color={Colors.primary} />
                    <Text style={styles.callBtnText}>Call</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            {item.assignedTo ? (
              <View style={styles.infoRow}>
                <Ionicons name="hammer-outline" size={16} color={Colors.textMuted} />
                <Text style={styles.infoText}>Assigned: {item.assignedTo}</Text>
              </View>
            ) : null}

            {item.scheduledDate ? (
              <View style={styles.infoRow}>
                <Ionicons name="calendar-outline" size={16} color={Colors.textMuted} />
                <Text style={styles.infoText}>Scheduled: {fmtDate(item.scheduledDate)}</Text>
              </View>
            ) : null}

            {item.completedDate ? (
              <View style={styles.infoRow}>
                <Ionicons name="checkmark-done-outline" size={16} color={Colors.textMuted} />
                <Text style={styles.infoText}>Completed: {fmtDate(item.completedDate)}</Text>
              </View>
            ) : null}

            <View style={styles.dateRow}>
              <Text style={styles.dateMeta}>Opened {fmtDateTime(item.createdAt)}</Text>
              {item.updatedAt && item.updatedAt !== item.createdAt ? (
                <Text style={styles.dateMeta}>Updated {fmtDateTime(item.updatedAt)}</Text>
              ) : null}
            </View>
          </View>

          {item.description ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>DESCRIPTION</Text>
              <Text style={styles.description}>{item.description}</Text>
            </View>
          ) : null}

          {hasCosts && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>COSTS</Text>
              <View style={styles.costsRow}>
                {(item.estimatedCost ?? 0) > 0 && (
                  <View style={styles.costCell}>
                    <Text style={styles.costLabel}>Estimated</Text>
                    <Text style={styles.costValue}>KES {fmtMoney(item.estimatedCost ?? 0)}</Text>
                  </View>
                )}
                {(item.actualCost ?? 0) > 0 && (
                  <View style={[styles.costCell, (item.estimatedCost ?? 0) > 0 && styles.costCellBorder]}>
                    <Text style={styles.costLabel}>Actual</Text>
                    <Text style={[styles.costValue, { color: Colors.primary }]}>KES {fmtMoney(item.actualCost ?? 0)}</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>UPDATE STATUS</Text>
            {updating ? (
              <View style={{ alignItems: 'center', padding: 20 }}>
                <ActivityIndicator color={Colors.primary} />
              </View>
            ) : (
              <View style={styles.statusGrid}>
                {STATUSES.map(s => {
                  const c = STATUS_COLORS[s] ?? STATUS_COLORS.pending;
                  const isActive = item.status === s;
                  return (
                    <TouchableOpacity
                      key={s}
                      style={[
                        styles.statusBtn,
                        isActive && { borderColor: c.text, backgroundColor: c.bg },
                      ]}
                      onPress={() => !isActive && updateStatus(s)}
                      disabled={isActive}
                    >
                      {isActive && <Ionicons name="checkmark-circle" size={16} color={c.text} />}
                      <Text style={[
                        styles.statusBtnText,
                        isActive && { color: c.text, fontWeight: '800' },
                      ]}>
                        {s.replace('_', ' ').replace(/\b\w/g, ch => ch.toUpperCase())}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 15, color: Colors.textMuted },
  scroll:    { padding: 16, gap: 16, paddingBottom: 40 },

  heroCard: {
    backgroundColor: Colors.white, borderRadius: 18,
    borderWidth: 1, borderColor: Colors.border,
    padding: 16, gap: 12,
  },
  heroTop:   { gap: 8 },
  title:     { fontSize: 17, fontWeight: '800', color: Colors.text },
  badgeRow:  { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  badge:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },

  infoRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoText:   { fontSize: 14, color: Colors.textSecondary, flex: 1 },
  callBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 8, borderWidth: 1, borderColor: Colors.primary,
  },
  callBtnText: { fontSize: 12, fontWeight: '700', color: Colors.primary },

  dateRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  dateMeta:{ fontSize: 11, color: Colors.textMuted },

  section:      { backgroundColor: Colors.white, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 16, gap: 12 },
  sectionTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted },
  description:  { fontSize: 14, color: Colors.text, lineHeight: 22 },

  costsRow:       { flexDirection: 'row' },
  costCell:       { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 4 },
  costCellBorder: { borderLeftWidth: 1, borderLeftColor: Colors.borderLight },
  costLabel:      { fontSize: 11, color: Colors.textMuted, fontWeight: '600' },
  costValue:      { fontSize: 16, fontWeight: '800', color: Colors.text },

  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statusBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  statusBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
});
