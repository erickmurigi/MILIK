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
  tenant?: { name?: string; phone?: string; email?: string };
  unit?:   { unitNumber?: string; property?: { propertyName?: string; name?: string; address?: string } };
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

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const fmtCost = (n: number) =>
  Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function MaintenanceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [item,       setItem]       = useState<Maintenance | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updating,   setUpdating]   = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const { data } = await api.get(`/maintenances/${id}`);
      setItem(data?.data ?? data);
    } catch { /* fail silently */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = (newStatus: string) => {
    Alert.alert(
      'Update Status',
      `Change status to "${newStatus.replace('_', ' ')}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Update',
          onPress: async () => {
            setUpdating(true);
            try {
              await api.put(`/maintenances/status/${id}`, { status: newStatus });
              await load();
            } catch (err: unknown) {
              const e = err as { response?: { data?: { message?: string } } };
              Alert.alert('Error', e?.response?.data?.message ?? 'Failed to update status.');
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
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={Colors.border} />
          <Text style={styles.emptyText}>Request not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const pc       = PRIORITY_COLORS[item.priority] ?? PRIORITY_COLORS.low;
  const sc       = STATUS_COLORS[item.status]   ?? STATUS_COLORS.pending;
  const propName = item.unit?.property?.propertyName ?? item.unit?.property?.name ?? '';
  const hasCosts = (item.estimatedCost ?? 0) > 0 || (item.actualCost ?? 0) > 0;

  return (
    <>
      <Stack.Screen options={{ title: item.title.length > 30 ? item.title.slice(0, 28) + '…' : item.title }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.primary} />}
        >
          <View style={styles.heroCard}>
            <View style={styles.heroTop}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.title}>{item.title}</Text>
                <View style={styles.badgeRow}>
                  <View style={[styles.badge, { backgroundColor: sc.bg }]}>
                    <Text style={[styles.badgeText, { color: sc.text }]}>
                      {item.status?.replace('_', ' ').toUpperCase()}
                    </Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: pc.bg }]}>
                    <Text style={[styles.badgeText, { color: pc.text }]}>
                      {item.priority?.toUpperCase()} PRIORITY
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {(item.unit?.unitNumber || propName) && (
              <View style={styles.infoRow}>
                <Ionicons name="location-outline" size={16} color={Colors.textMuted} />
                <Text style={styles.infoText}>
                  {[item.unit?.unitNumber && `Unit ${item.unit.unitNumber}`, propName].filter(Boolean).join(' · ')}
                </Text>
              </View>
            )}

            {item.tenant?.name && (
              <View style={styles.infoRow}>
                <Ionicons name="person-outline" size={16} color={Colors.textMuted} />
                <Text style={styles.infoText}>{item.tenant.name}</Text>
                {item.tenant.phone && (
                  <TouchableOpacity
                    style={styles.callBtn}
                    onPress={() => Linking.openURL(`tel:${item.tenant?.phone}`)}
                  >
                    <Ionicons name="call-outline" size={14} color={Colors.primary} />
                    <Text style={styles.callBtnText}>Call</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {item.assignedTo && (
              <View style={styles.infoRow}>
                <Ionicons name="hammer-outline" size={16} color={Colors.textMuted} />
                <Text style={styles.infoText}>Assigned: {item.assignedTo}</Text>
              </View>
            )}

            {item.scheduledDate && (
              <View style={styles.infoRow}>
                <Ionicons name="calendar-outline" size={16} color={Colors.textMuted} />
                <Text style={styles.infoText}>Scheduled: {fmtDate(item.scheduledDate)}</Text>
              </View>
            )}

            {item.completedDate && (
              <View style={styles.infoRow}>
                <Ionicons name="checkmark-done-outline" size={16} color={Colors.textMuted} />
                <Text style={styles.infoText}>Completed: {fmtDate(item.completedDate)}</Text>
              </View>
            )}

            <View style={styles.dateRow}>
              <Text style={styles.dateMeta}>Opened {fmtDate(item.createdAt)}</Text>
              {item.updatedAt !== item.createdAt && (
                <Text style={styles.dateMeta}>Updated {fmtDate(item.updatedAt)}</Text>
              )}
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
                    <Text style={styles.costValue}>KES {fmtCost(item.estimatedCost ?? 0)}</Text>
                  </View>
                )}
                {(item.actualCost ?? 0) > 0 && (
                  <View style={[styles.costCell, (item.estimatedCost ?? 0) > 0 && styles.costCellBorder]}>
                    <Text style={styles.costLabel}>Actual</Text>
                    <Text style={[styles.costValue, { color: Colors.primary }]}>KES {fmtCost(item.actualCost ?? 0)}</Text>
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
