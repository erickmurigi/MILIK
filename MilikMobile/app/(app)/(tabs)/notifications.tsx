import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../../../constants/colors';
import api from '../../../services/api';
import { ErrorBanner, ErrorState } from '../../../components/ui/PmsStates';
import { apiError, fmtDate as fmtAbsDate } from '../../../utils/pmsFormat';

type Notification = {
  _id:         string;
  type:        string;
  title:       string;
  message:     string;
  isRead:      boolean;
  priority:    string;
  createdAt:   string;
  relatedType: string;
  relatedId?:  string;
};

// Map notification type to icon + color
const TYPE_META: Record<string, { icon: string; color: string }> = {
  // Types the server's Notification model actually allows
  payment_due:          { icon: 'receipt-outline',         color: Colors.danger  },
  maintenance_request:  { icon: 'construct-outline',       color: Colors.warning },
  tenant_move_in:       { icon: 'log-in-outline',          color: Colors.success },
  tenant_move_out:      { icon: 'log-out-outline',         color: Colors.textMuted },
  system:               { icon: 'information-circle-outline', color: Colors.primary },
  // Legacy keys kept for older records
  overdue_invoice:      { icon: 'receipt-outline',        color: Colors.danger  },
  pending_maintenance:  { icon: 'construct-outline',       color: Colors.warning },
  lease_expiry:         { icon: 'document-text-outline',   color: Colors.warning },
  unposted_receipt:     { icon: 'cash-outline',            color: Colors.accent  },
  draft_voucher:        { icon: 'wallet-outline',          color: Colors.textMuted },
  pending_statement:    { icon: 'newspaper-outline',       color: Colors.primary },
  payment_received:     { icon: 'checkmark-circle-outline',color: Colors.success },
  default:              { icon: 'notifications-outline',   color: Colors.textMuted },
};

const PRIORITY_COLORS: Record<string, string> = {
  high:   Colors.danger,
  medium: Colors.warning,
  low:    Colors.textMuted,
};

const fmtDate = (d: string) => {
  const diff = Date.now() - new Date(d).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7)   return `${days}d ago`;
  return fmtAbsDate(d);
};

export default function NotificationsScreen() {
  const router = useRouter();
  const [items,       setItems]       = useState<Notification[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [showUnread,  setShowUnread]  = useState(false);
  const [page,        setPage]        = useState(1);
  const [hasMore,     setHasMore]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [error,       setError]       = useState<string | null>(null);
  const reqRef = useRef(0);

  const LIMIT = 50;

  const load = useCallback(async (pg = 1, mode: 'initial' | 'refresh' | 'more' = 'initial') => {
    const id = ++reqRef.current;
    if (mode === 'initial') setLoading(true);
    else if (mode === 'refresh') setRefreshing(true);
    else setLoadingMore(true);

    try {
      const params: Record<string, string> = { page: String(pg), limit: String(LIMIT) };
      if (showUnread) params.isRead = 'false';

      const { data } = await api.get('/notifications', { params });
      if (id !== reqRef.current) return;
      const rows: Notification[] = data.notifications ?? [];
      const pages: number | undefined = data.pagination?.pages;

      setItems(prev => {
        if (pg === 1) return rows;
        const seen = new Set(prev.map(n => n._id));
        return [...prev, ...rows.filter(n => !seen.has(n._id))];
      });
      setHasMore(pages ? pg < pages : rows.length === LIMIT);
      setPage(pg);
      setError(null);
      if (showUnread) setUnreadTotal(Number(data.pagination?.total ?? rows.length));
    } catch (err) {
      if (id !== reqRef.current) return;
      setError(apiError(err, 'Could not load notifications.'));
    } finally {
      if (id === reqRef.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [showUnread]);

  // Server-side unread total (independent of how many pages are loaded)
  const loadUnreadTotal = useCallback(() => {
    api.get('/notifications', { params: { isRead: 'false', limit: '1' } })
      .then(({ data }) => setUnreadTotal(Number(data?.pagination?.total ?? 0)))
      .catch(() => {});
  }, []);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => { loadUnreadTotal(); }, [loadUnreadTotal]);

  const markRead = async (item: Notification) => {
    if (!item.isRead) {
      try {
        await api.put(`/notifications/read/${item._id}`);
        setItems(prev => prev.map(n => n._id === item._id ? { ...n, isRead: true } : n));
        setUnreadTotal(t => Math.max(0, t - 1));
      } catch { /* fail silently */ }
    }
    // Jump straight to the maintenance request when the notification points at one.
    if (item.type === 'maintenance_request' && item.relatedId) {
      router.push(`/pms/maintenance/${item.relatedId}` as any);
    }
  };

  const markAllRead = async () => {
    try {
      await api.put('/notifications/read-all');
      setUnreadTotal(0);
      // In the "Unread" view everything just left the filter.
      setItems(prev => showUnread ? [] : prev.map(n => ({ ...n, isRead: true })));
    } catch (err) {
      setError(apiError(err, 'Could not mark notifications as read.'));
    }
  };

  const unreadCount = unreadTotal;

  const renderItem = ({ item }: { item: Notification }) => {
    const meta = TYPE_META[item.type] ?? TYPE_META.default;
    const priorityColor = PRIORITY_COLORS[item.priority] ?? PRIORITY_COLORS.low;

    return (
      <TouchableOpacity
        style={[styles.card, !item.isRead && styles.cardUnread]}
        onPress={() => markRead(item)}
        activeOpacity={0.75}
      >
        {/* Unread indicator */}
        {!item.isRead && <View style={[styles.unreadDot, { backgroundColor: priorityColor }]} />}

        <View style={[styles.iconBox, { backgroundColor: meta.color + '18' }]}>
          <Ionicons name={meta.icon as any} size={20} color={meta.color} />
        </View>

        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[styles.cardTitle, !item.isRead && styles.cardTitleBold]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.cardMessage} numberOfLines={2}>{item.message}</Text>
        </View>

        <Text style={styles.cardDate}>{fmtDate(item.createdAt)}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.topBar}>
        <Text style={styles.title}>Notifications</Text>
        {unreadCount > 0 && (
          <TouchableOpacity onPress={markAllRead}>
            <Text style={styles.markAll}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Unread toggle */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterPill, !showUnread && styles.filterPillActive]}
          onPress={() => setShowUnread(false)}
        >
          <Text style={[styles.filterText, !showUnread && styles.filterTextActive]}>All</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterPill, showUnread && styles.filterPillActive]}
          onPress={() => setShowUnread(true)}
        >
          <Text style={[styles.filterText, showUnread && styles.filterTextActive]}>Unread</Text>
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : error && items.length === 0 ? (
        <ErrorState message={error} onRetry={() => load(1)} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { load(1, 'refresh'); loadUnreadTotal(); }} tintColor={Colors.primary} />
          }
          onEndReached={() => { if (!loadingMore && hasMore) load(page + 1, 'more'); }}
          ListHeaderComponent={error ? <ErrorBanner message={error} onRetry={() => load(1, 'refresh')} /> : null}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="notifications-outline" size={56} color={Colors.border} />
              <Text style={styles.emptyTitle}>
                {showUnread ? 'All caught up' : 'No notifications'}
              </Text>
              <Text style={styles.emptySub}>
                {showUnread ? 'No unread notifications' : 'Notifications will appear here'}
              </Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={Colors.primary} />
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  centered:{ flex: 1, alignItems: 'center', justifyContent: 'center' },
  list:    { paddingBottom: 40 },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8,
  },
  title:   { fontSize: 24, fontWeight: '800', color: Colors.text },
  markAll: { fontSize: 13, fontWeight: '700', color: Colors.primary },

  filterRow: {
    flexDirection: 'row', paddingHorizontal: 20, paddingBottom: 10, gap: 8,
  },
  filterPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  filterPillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText:       { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  filterTextActive: { color: Colors.white },

  badge:     { backgroundColor: Colors.danger, borderRadius: 10, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: Colors.white, fontSize: 10, fontWeight: '800' },

  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
    padding: 14,
  },
  cardUnread:     { borderLeftWidth: 3, borderLeftColor: Colors.primary },
  cardTitle:      { fontSize: 14, fontWeight: '600', color: Colors.text },
  cardTitleBold:  { fontWeight: '800' },
  cardMessage:    { fontSize: 12, color: Colors.textMuted, lineHeight: 18 },
  cardDate:       { fontSize: 11, color: Colors.textMuted, marginTop: 2 },

  iconBox: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  unreadDot: {
    position: 'absolute', top: 14, right: 14,
    width: 8, height: 8, borderRadius: 4,
  },

  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingHorizontal: 40, paddingTop: 80,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  emptySub:   { fontSize: 13, color: Colors.textMuted, textAlign: 'center' },
});
