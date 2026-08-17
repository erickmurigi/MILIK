import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const AC  = '#064E3B';
const ACL = '#ECFDF5';

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Voucher = {
  _id:            string;
  voucherNumber?: string;
  payee:          string;
  date:           string;
  amount:         number;
  narration:      string;
  status:         string;
  paymentMethod?: string;
  reference?:     string;
  paymentAccount?:{ _id: string; name: string; code?: string };
  expenseAccount?:{ _id: string; name: string; code?: string };
  preparedBy?:    { name?: string };
  approvedBy?:    { name?: string };
  createdAt:      string;
};

const STATUS_CFG: Record<string, { bg: string; color: string; label: string }> = {
  draft:    { bg: '#F1F5F9', color: '#64748B', label: 'Draft'    },
  pending:  { bg: '#FEF3C7', color: '#D97706', label: 'Pending'  },
  approved: { bg: '#D1FAE5', color: '#065F46', label: 'Approved' },
  rejected: { bg: '#FEE2E2', color: '#DC2626', label: 'Rejected' },
  posted:   { bg: '#EDE9FE', color: '#7C3AED', label: 'Posted'   },
};

const PM_LABELS: Record<string, string> = {
  cash: 'Cash', cheque: 'Cheque', bank_transfer: 'Bank Transfer', mpesa: 'M-Pesa',
};

const PM_ICONS: Record<string, string> = {
  cash: 'cash-outline', cheque: 'document-outline',
  bank_transfer: 'card-outline', mpesa: 'phone-portrait-outline',
};

export default function VoucherDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router   = useRouter();

  const [voucher,  setVoucher]  = useState<Voucher | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [acting,   setActing]   = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/payment-vouchers/${id}`);
      setVoucher(data?.data ?? data);
    } catch { Alert.alert('Error', 'Could not load voucher.'); router.back(); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const doAction = (endpoint: string, label: string, confirm = true) => {
    const run = async () => {
      setActing(true);
      try {
        await api.post(`/payment-vouchers/${id}/${endpoint}`);
        await load();
      } catch (err: any) {
        Alert.alert('Error', err?.response?.data?.message ?? `Failed to ${label}.`);
      } finally { setActing(false); }
    };

    if (!confirm) { run(); return; }
    Alert.alert(label, `Are you sure you want to ${label.toLowerCase()} this voucher?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: label, style: endpoint === 'reject' ? 'destructive' : 'default', onPress: run },
    ]);
  };

  if (loading) return <MilikLoader fullscreen />;
  if (!voucher) return null;

  const sc = STATUS_CFG[voucher.status] ?? STATUS_CFG.draft;
  const pm = voucher.paymentMethod ?? 'cash';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={{ flex: 1 }}>
              {voucher.voucherNumber && (
                <Text style={styles.heroNum}>{voucher.voucherNumber}</Text>
              )}
              <Text style={styles.heroPayee}>{voucher.payee}</Text>
              <Text style={styles.heroNarration} numberOfLines={2}>{voucher.narration}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: sc.color + '25' }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
            </View>
          </View>

          <Text style={styles.heroAmount}>{fmt(voucher.amount)}</Text>

          <View style={styles.heroMeta}>
            <View style={styles.heroMetaItem}>
              <Ionicons name="calendar-outline" size={13} color="rgba(255,255,255,0.6)" />
              <Text style={styles.heroMetaTxt}>{fmtDate(voucher.date || voucher.createdAt)}</Text>
            </View>
            <View style={styles.heroMetaItem}>
              <Ionicons name={PM_ICONS[pm] as any ?? 'cash-outline'} size={13} color="rgba(255,255,255,0.6)" />
              <Text style={styles.heroMetaTxt}>{PM_LABELS[pm] ?? pm}</Text>
            </View>
            {voucher.reference && (
              <View style={styles.heroMetaItem}>
                <Ionicons name="link-outline" size={13} color="rgba(255,255,255,0.6)" />
                <Text style={styles.heroMetaTxt}>{voucher.reference}</Text>
              </View>
            )}
          </View>
        </View>

        {/* GL Accounts */}
        {(voucher.paymentAccount || voucher.expenseAccount) && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>GL ACCOUNTS</Text>
            {voucher.paymentAccount && (
              <View style={styles.accountRow}>
                <View style={styles.accountBadge}>
                  <Ionicons name="card-outline" size={14} color="#1D4ED8" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.accountType}>Payment Account</Text>
                  <Text style={styles.accountName}>{voucher.paymentAccount.name}</Text>
                </View>
                {voucher.paymentAccount.code && (
                  <Text style={styles.accountCode}>{voucher.paymentAccount.code}</Text>
                )}
              </View>
            )}
            {voucher.paymentAccount && voucher.expenseAccount && (
              <View style={styles.divider} />
            )}
            {voucher.expenseAccount && (
              <View style={styles.accountRow}>
                <View style={[styles.accountBadge, { backgroundColor: '#F3E8FF' }]}>
                  <Ionicons name="albums-outline" size={14} color="#7C3AED" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.accountType}>Expense Account</Text>
                  <Text style={styles.accountName}>{voucher.expenseAccount.name}</Text>
                </View>
                {voucher.expenseAccount.code && (
                  <Text style={styles.accountCode}>{voucher.expenseAccount.code}</Text>
                )}
              </View>
            )}
          </View>
        )}

        {/* Audit trail */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>AUDIT</Text>
          {voucher.preparedBy?.name && (
            <View style={styles.auditRow}>
              <Ionicons name="create-outline" size={14} color="#94A3B8" />
              <Text style={styles.auditLabel}>Prepared by</Text>
              <Text style={styles.auditValue}>{voucher.preparedBy.name}</Text>
            </View>
          )}
          {voucher.approvedBy?.name && (
            <View style={styles.auditRow}>
              <Ionicons name="checkmark-circle-outline" size={14} color="#065F46" />
              <Text style={styles.auditLabel}>Approved by</Text>
              <Text style={styles.auditValue}>{voucher.approvedBy.name}</Text>
            </View>
          )}
          <View style={styles.auditRow}>
            <Ionicons name="time-outline" size={14} color="#94A3B8" />
            <Text style={styles.auditLabel}>Created</Text>
            <Text style={styles.auditValue}>{fmtDate(voucher.createdAt)}</Text>
          </View>
        </View>

      </ScrollView>

      {/* Action buttons */}
      {acting ? (
        <View style={styles.actionsWrap}>
          <ActivityIndicator color={AC} />
        </View>
      ) : (
        <ActionBar status={voucher.status} doAction={doAction} />
      )}
    </SafeAreaView>
  );
}

function ActionBar({ status, doAction }: { status: string; doAction: (ep: string, label: string) => void }) {
  if (status === 'draft') {
    return (
      <View style={styles.actionsWrap}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#1D4ED8' }]} onPress={() => doAction('submit', 'Submit for Review')}>
          <Ionicons name="send-outline" size={16} color="#fff" />
          <Text style={styles.actionBtnTxt}>Submit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: AC }]} onPress={() => doAction('post', 'Post to Ledger')}>
          <Ionicons name="checkmark-done-outline" size={16} color="#fff" />
          <Text style={styles.actionBtnTxt}>Post Directly</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (status === 'pending') {
    return (
      <View style={styles.actionsWrap}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#DC2626', flex: 0.6 }]} onPress={() => doAction('reject', 'Reject')}>
          <Ionicons name="close-outline" size={16} color="#fff" />
          <Text style={styles.actionBtnTxt}>Reject</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: AC }]} onPress={() => doAction('approve', 'Approve')}>
          <Ionicons name="checkmark-outline" size={16} color="#fff" />
          <Text style={styles.actionBtnTxt}>Approve</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (status === 'approved') {
    return (
      <View style={styles.actionsWrap}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: AC }]} onPress={() => doAction('post', 'Post to Ledger')}>
          <Ionicons name="arrow-up-circle-outline" size={16} color="#fff" />
          <Text style={styles.actionBtnTxt}>Post to Ledger</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (status === 'posted') {
    return (
      <View style={styles.actionsWrap}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#DC2626' }]} onPress={() => doAction('reverse', 'Reverse')}>
          <Ionicons name="refresh-outline" size={16} color="#fff" />
          <Text style={styles.actionBtnTxt}>Reverse</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return null;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#F0FDF4' },
  scroll: { padding: 16, gap: 14, paddingBottom: 16 },

  hero: {
    backgroundColor: AC, borderRadius: 18, padding: 20, gap: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
  heroTop:     { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  heroNum:     { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 0.8, marginBottom: 2 },
  heroPayee:   { fontSize: 20, fontWeight: '900', color: '#fff' },
  heroNarration:{ fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  heroAmount:  { fontSize: 32, fontWeight: '900', color: '#fff', letterSpacing: -0.5, marginTop: 4 },
  heroMeta:    { flexDirection: 'row', gap: 14, flexWrap: 'wrap', marginTop: 6 },
  heroMetaItem:{ flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroMetaTxt: { fontSize: 12, color: 'rgba(255,255,255,0.65)', fontWeight: '500' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeTxt: { fontSize: 11, fontWeight: '800' },

  card: {
    backgroundColor: '#fff', borderRadius: 16, borderWidth: 1,
    borderColor: '#E2E8F0', padding: 16, gap: 12,
  },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8' },
  divider:      { height: 1, backgroundColor: '#F1F5F9' },

  accountRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  accountBadge:{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  accountType: { fontSize: 10, fontWeight: '700', color: '#94A3B8', marginBottom: 2 },
  accountName: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  accountCode: { fontSize: 12, fontWeight: '800', color: '#94A3B8' },

  auditRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  auditLabel: { fontSize: 12, color: '#94A3B8', flex: 1 },
  auditValue: { fontSize: 13, fontWeight: '600', color: '#0F172A' },

  actionsWrap: {
    borderTopWidth: 1, borderTopColor: '#E2E8F0',
    backgroundColor: '#fff', padding: 16,
    flexDirection: 'row', gap: 10,
  },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 7,
    borderRadius: 14, paddingVertical: 14,
  },
  actionBtnTxt: { fontSize: 15, fontWeight: '800', color: '#fff' },
});
