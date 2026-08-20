import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import { Dropdown, DropdownItem } from '../../../../components/ui/Dropdown';
import { DateField } from '../../../../components/ui/DateField';

type TenantOption = {
  _id:      string;
  name:     string;
  unitId?:  string;
  unitNum?: string;
  propName?: string;
};

type OpenInvoice = {
  _id:           string;
  invoiceNumber: string;
  category:      string;
  amount:        number;
  outstanding:   number;
  dueDate?:      string;
};

type TenantBalance = {
  currentBalance: number;
  totalPaid:      number;
  depositAmount:  number;
};

const PAYMENT_METHODS = [
  { value: 'MPESA',         label: 'M-Pesa',        schema: 'mobile_money'  },
  { value: 'CASH',          label: 'Cash',          schema: 'cash'          },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer', schema: 'bank_transfer' },
  { value: 'CHEQUE',        label: 'Cheque',        schema: 'check'         },
];

const INVOICE_CAT_LABELS: Record<string, string> = {
  RENT_CHARGE:    'Rent',
  UTILITY_CHARGE: 'Utility',
  DEPOSIT_CHARGE: 'Deposit',
  PENALTY_CHARGE: 'Penalty',
  DEBIT_NOTE:     'Debit Note',
  TAKE_ON_DEBIT:  'Take-on',
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const today = new Date();
const todayStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;

const fmt = (n: number) =>
  Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });

function parseTenant(t: Record<string, unknown>): TenantOption {
  const unit = t.unit as Record<string, unknown> | undefined;
  const prop = unit?.property as Record<string, unknown> | undefined;
  return {
    _id:      String(t._id ?? ''),
    name:     String(t.name ?? ''),
    unitId:   unit?._id as string | undefined,
    unitNum:  unit?.unitNumber as string | undefined,
    propName: (prop?.propertyName ?? prop?.name) as string | undefined,
  };
}

export default function NewReceiptScreen() {
  const router = useRouter();
  const {
    tenant:     prefilledTenantId,
    tenantName: prefilledTenantName,
    invoice:    prefilledInvoiceId,
  } = useLocalSearchParams<{ tenant?: string; tenantName?: string; invoice?: string }>();

  // Property filter
  const [properties,       setProperties]       = useState<DropdownItem[]>([]);
  const [propsLoading,     setPropsLoading]     = useState(false);
  const [selectedPropId,   setSelectedPropId]   = useState('');
  const [selectedPropLabel,setSelectedPropLabel]= useState('');
  const [propOpen,         setPropOpen]         = useState(false);

  // Tenant selection
  const [selectedTenant,   setSelectedTenant]   = useState<TenantOption | null>(null);
  const [tenantSearch,     setTenantSearch]     = useState('');
  const [tenantResults,    setTenantResults]    = useState<TenantOption[]>([]);
  const [tenantSearching,  setTenantSearching]  = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tenant data
  const [balance,        setBalance]        = useState<TenantBalance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [openInvoices,   setOpenInvoices]   = useState<OpenInvoice[]>([]);
  const [invLoading,     setInvLoading]     = useState(false);

  // Cashbook
  const [cashbooks,        setCashbooks]        = useState<DropdownItem[]>([]);
  const [cashbooksLoading, setCashbooksLoading] = useState(false);
  const [cashbookId,       setCashbookId]       = useState('');
  const [cashbookLabel,    setCashbookLabel]    = useState('');
  const [cashbookOpen,     setCashbookOpen]     = useState(false);

  // Form
  const [paymentMethod,    setPaymentMethod]    = useState('MPESA');
  const [amount,           setAmount]           = useState('');
  const [refNumber,        setRefNumber]        = useState('');
  const [paymentDate,      setPaymentDate]      = useState(todayStr);
  const [description,      setDescription]      = useState('');
  const [directToLandlord, setDirectToLandlord] = useState(false);
  const [submitting,       setSubmitting]       = useState(false);

  // Load properties
  useEffect(() => {
    setPropsLoading(true);
    api.get('/properties', { params: { limit: 100 } })
      .then(({ data }) =>
        setProperties(
          (data.data ?? []).map((p: Record<string, unknown>) => ({
            _id:      String(p._id ?? ''),
            label:    String((p.propertyName ?? p.name) ?? ''),
            sublabel: String(p.propertyCode ?? ''),
          }))
        )
      )
      .catch(() => {})
      .finally(() => setPropsLoading(false));
  }, []);

  // Pre-fill from params on mount
  useEffect(() => {
    if (!prefilledTenantId) return;
    setSelectedTenant({
      _id:  prefilledTenantId,
      name: prefilledTenantName ?? prefilledTenantId,
    });
    api.get(`/tenants/${prefilledTenantId}`)
      .then(({ data }) => {
        const t = data?.data ?? data;
        if (t?._id) setSelectedTenant(parseTenant(t as Record<string, unknown>));
      })
      .catch(() => {});
  }, [prefilledTenantId, prefilledTenantName]);

  // Load cashbooks once — accounts are type "asset"; filter by name for cashbook-like accounts
  useEffect(() => {
    setCashbooksLoading(true);
    api.get('/chart-of-accounts', { params: { type: 'asset' } })
      .then(({ data }) => {
        const all: Record<string, unknown>[] = Array.isArray(data) ? data : [];
        const cashbookRe = /cash|bank|m-?pesa|mobile|wallet|petty|till|collection/i;
        const banks: DropdownItem[] = all
          .filter(a => cashbookRe.test(`${a.name ?? ''} ${a.accountName ?? ''} ${a.group ?? ''} ${a.subGroup ?? ''}`))
          .map(a => ({
            _id:      String(a._id ?? ''),
            label:    String(a.name ?? a.accountName ?? ''),
            sublabel: String(a.code ?? ''),
          }));
        setCashbooks(banks);
        if (banks.length > 0) { setCashbookId(banks[0]._id); setCashbookLabel(banks[0].label); }
      })
      .catch(() => {})
      .finally(() => setCashbooksLoading(false));
  }, []);

  // Debounced live tenant search (filtered by property when one is selected)
  useEffect(() => {
    if (selectedTenant) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (tenantSearch.length < 2) { setTenantResults([]); return; }
    searchTimer.current = setTimeout(() => {
      setTenantSearching(true);
      const params: Record<string, string | number> = { search: tenantSearch, limit: 20, status: 'active' };
      if (selectedPropId) params.property = selectedPropId;
      api.get('/tenants', { params })
        .then(({ data }) => {
          const list: Record<string, unknown>[] = Array.isArray(data?.data) ? data.data : [];
          setTenantResults(list.map(parseTenant));
        })
        .catch(() => setTenantResults([]))
        .finally(() => setTenantSearching(false));
    }, 400);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [tenantSearch, selectedTenant, selectedPropId]);

  // Load balance + open invoices when tenant selected
  const loadTenantData = useCallback(async (tenantId: string) => {
    setBalanceLoading(true);
    setInvLoading(true);
    const [balRes, invRes] = await Promise.allSettled([
      api.get(`/tenants/balance/${tenantId}`),
      api.get('/tenant-invoices', { params: { tenant: tenantId, status: 'unpaid', limit: 20 } }),
    ]);
    if (balRes.status === 'fulfilled') {
      const b = balRes.value.data?.data ?? balRes.value.data;
      setBalance({
        currentBalance: Number(b?.currentBalance ?? 0),
        totalPaid:      Number(b?.totalPaid ?? 0),
        depositAmount:  Number(b?.depositAmount ?? 0),
      });
    }
    setBalanceLoading(false);
    if (invRes.status === 'fulfilled') {
      const invs: Record<string, unknown>[] = Array.isArray(invRes.value.data?.data)
        ? invRes.value.data.data : [];
      setOpenInvoices(invs.map(inv => ({
        _id:           String(inv._id ?? ''),
        invoiceNumber: String(inv.invoiceNumber ?? ''),
        category:      String(inv.category ?? ''),
        amount:        Number(inv.amount ?? 0),
        outstanding:   Number(inv.outstanding ?? inv.balance ?? 0),
        dueDate:       inv.dueDate ? String(inv.dueDate) : undefined,
      })));
    }
    setInvLoading(false);
  }, []);

  useEffect(() => {
    if (selectedTenant?._id) {
      loadTenantData(selectedTenant._id);
    } else {
      setBalance(null);
      setOpenInvoices([]);
    }
  }, [selectedTenant?._id, loadTenantData]);

  const selectTenant = (t: TenantOption) => {
    setSelectedTenant(t);
    setTenantSearch('');
    setTenantResults([]);
  };

  const clearTenant = () => {
    setSelectedTenant(null);
    setBalance(null);
    setOpenInvoices([]);
  };

  const submit = async () => {
    if (!selectedTenant)               { Alert.alert('Missing', 'Please select a tenant.'); return; }
    if (!selectedTenant.unitId)        { Alert.alert('Missing', 'Tenant has no unit assigned.'); return; }
    if (!amount || Number(amount) <= 0){ Alert.alert('Missing', 'Enter a valid amount.'); return; }
    if (!refNumber.trim())             { Alert.alert('Missing', 'Reference number is required.'); return; }
    if (!directToLandlord && !cashbookId) { Alert.alert('Missing', 'Select a cashbook.'); return; }

    setSubmitting(true);
    try {
      const schemaMethod = PAYMENT_METHODS.find(pm => pm.value === paymentMethod)?.schema ?? 'cash';
      const body: Record<string, unknown> = {
        tenant:               selectedTenant._id,
        unit:                 selectedTenant.unitId,
        amount:               Number(amount),
        referenceNumber:      refNumber.trim(),
        paymentMethod:        schemaMethod,
        paymentDate:          new Date(paymentDate).toISOString(),
        paidDirectToLandlord: directToLandlord,
        description:          description.trim() || undefined,
      };
      if (!directToLandlord && cashbookId) body.cashbook = cashbookLabel;

      await api.post('/rent-payments', body);
      Alert.alert('Success', 'Receipt recorded successfully.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      Alert.alert('Error', msg ?? 'Failed to record receipt.');
    } finally { setSubmitting(false); }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Record Payment' }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Property filter */}
          <Dropdown
            label="PROPERTY"
            placeholder="All properties"
            selectedId={selectedPropId}
            selectedLabel={selectedPropLabel}
            items={properties}
            onSelect={(item) => {
              setSelectedPropId(item._id);
              setSelectedPropLabel(item.label);
              setTenantSearch('');
              setTenantResults([]);
              setPropOpen(false);
            }}
            onClear={() => {
              setSelectedPropId('');
              setSelectedPropLabel('');
              setTenantSearch('');
              setTenantResults([]);
            }}
            loading={propsLoading}
            open={propOpen}
            onToggle={() => setPropOpen(o => !o)}
          />

          {/* Tenant selection */}
          <View style={styles.field}>
            <Text style={styles.label}>TENANT <Text style={{ color: Colors.danger }}>*</Text></Text>

            {selectedTenant ? (
              <View style={styles.tenantChip}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.tenantChipName}>{selectedTenant.name}</Text>
                  {(selectedTenant.unitNum || selectedTenant.propName) ? (
                    <Text style={styles.tenantChipSub}>
                      {[
                        selectedTenant.unitNum && `Unit ${selectedTenant.unitNum}`,
                        selectedTenant.propName,
                      ].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                </View>
                {!prefilledTenantId && (
                  <TouchableOpacity onPress={clearTenant} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle" size={20} color={Colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <>
                <View style={styles.inputBox}>
                  <Ionicons name="search-outline" size={17} color={Colors.textMuted} />
                  <TextInput
                    style={[styles.inputText, { flex: 1 }]}
                    placeholder="Search tenant name…"
                    placeholderTextColor={Colors.textMuted}
                    value={tenantSearch}
                    onChangeText={setTenantSearch}
                    autoCorrect={false}
                  />
                  {tenantSearching && <ActivityIndicator size="small" color={Colors.primary} />}
                </View>

                {tenantResults.length > 0 && (
                  <View style={styles.searchResults}>
                    {tenantResults.map(t => (
                      <TouchableOpacity
                        key={t._id}
                        style={styles.searchResultRow}
                        onPress={() => selectTenant(t)}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.searchResultName}>{t.name}</Text>
                          {(t.unitNum || t.propName) ? (
                            <Text style={styles.searchResultSub}>
                              {[t.unitNum && `Unit ${t.unitNum}`, t.propName].filter(Boolean).join(' · ')}
                            </Text>
                          ) : null}
                        </View>
                        <Ionicons name="chevron-forward" size={14} color={Colors.border} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {tenantSearch.length >= 2 && !tenantSearching && tenantResults.length === 0 && (
                  <Text style={styles.noResults}>No tenants found for "{tenantSearch}"</Text>
                )}
              </>
            )}
          </View>

          {/* Tenant balance (when selected) */}
          {selectedTenant && (
            <View style={styles.balanceCard}>
              <Text style={styles.cardTitle}>TENANT BALANCE</Text>
              {balanceLoading ? (
                <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 8 }} />
              ) : balance ? (
                <View style={styles.balanceRow}>
                  <View style={styles.balanceStat}>
                    <Text style={styles.balanceStatLabel}>Outstanding</Text>
                    <Text style={[styles.balanceStatValue, {
                      color: balance.currentBalance > 0 ? Colors.danger : Colors.success,
                    }]}>
                      KES {fmt(balance.currentBalance)}
                    </Text>
                  </View>
                  <View style={styles.balanceDivider} />
                  <View style={styles.balanceStat}>
                    <Text style={styles.balanceStatLabel}>Total Paid</Text>
                    <Text style={[styles.balanceStatValue, { color: Colors.success }]}>
                      KES {fmt(balance.totalPaid)}
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>
          )}

          {/* Open invoices (when selected and available) */}
          {selectedTenant && (invLoading || openInvoices.length > 0) && (
            <View style={styles.invoicesCard}>
              <Text style={styles.cardTitle}>OPEN INVOICES</Text>
              {invLoading ? (
                <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 8 }} />
              ) : (
                openInvoices.map(inv => (
                  <View
                    key={inv._id}
                    style={[
                      styles.openInvRow,
                      inv._id === prefilledInvoiceId && styles.openInvRowHighlighted,
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.openInvNum}>{inv.invoiceNumber}</Text>
                      <Text style={styles.openInvCat}>
                        {INVOICE_CAT_LABELS[inv.category] ?? inv.category}
                        {inv.dueDate ? ` · Due ${fmtDate(inv.dueDate)}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.openInvAmt}>KES {fmt(inv.outstanding)}</Text>
                  </View>
                ))
              )}
            </View>
          )}

          {/* Payment method */}
          <View style={styles.field}>
            <Text style={styles.label}>PAYMENT METHOD <Text style={{ color: Colors.danger }}>*</Text></Text>
            <View style={styles.pillRow}>
              {PAYMENT_METHODS.map(pm => (
                <TouchableOpacity
                  key={pm.value}
                  style={[styles.pill, paymentMethod === pm.value && styles.pillActive]}
                  onPress={() => setPaymentMethod(pm.value)}
                >
                  <Text style={[styles.pillText, paymentMethod === pm.value && styles.pillTextActive]}>
                    {pm.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Amount */}
          <View style={styles.field}>
            <Text style={styles.label}>AMOUNT (KES) <Text style={{ color: Colors.danger }}>*</Text></Text>
            <View style={styles.inputBox}>
              <Text style={styles.prefix}>KES</Text>
              <TextInput
                style={[styles.inputText, { flex: 1 }]}
                keyboardType="numeric"
                placeholder="0.00"
                placeholderTextColor={Colors.textMuted}
                value={amount}
                onChangeText={setAmount}
              />
            </View>
          </View>

          {/* Reference number */}
          <View style={styles.field}>
            <Text style={styles.label}>REFERENCE NUMBER <Text style={{ color: Colors.danger }}>*</Text></Text>
            <View style={styles.inputBox}>
              <TextInput
                style={[styles.inputText, { flex: 1 }]}
                placeholder="M-Pesa code, bank ref, cheque no…"
                placeholderTextColor={Colors.textMuted}
                value={refNumber}
                onChangeText={setRefNumber}
                autoCapitalize="characters"
              />
            </View>
          </View>

          {/* Payment date */}
          <DateField label="PAYMENT DATE" value={paymentDate} onChange={setPaymentDate} required />

          {/* Notes */}
          <View style={styles.field}>
            <Text style={styles.label}>NOTES / DESCRIPTION</Text>
            <View style={styles.descriptionBox}>
              <TextInput
                style={styles.descriptionInput}
                placeholder="Optional notes…"
                placeholderTextColor={Colors.textMuted}
                value={description}
                onChangeText={setDescription}
                multiline
                textAlignVertical="top"
              />
            </View>
          </View>

          {/* Cashbook */}
          {!directToLandlord && (
            <Dropdown
              label="CASHBOOK"
              placeholder="Select cashbook…"
              selectedId={cashbookId}
              selectedLabel={cashbookLabel}
              items={cashbooks}
              onSelect={(item) => { setCashbookId(item._id); setCashbookLabel(item.label); setCashbookOpen(false); }}
              loading={cashbooksLoading}
              open={cashbookOpen}
              onToggle={() => setCashbookOpen(o => !o)}
              required
              emptyText="No cashbooks found"
            />
          )}

          {/* Direct to landlord */}
          <TouchableOpacity style={styles.toggle} onPress={() => setDirectToLandlord(v => !v)}>
            <View style={[styles.toggleBox, directToLandlord && styles.toggleBoxActive]}>
              {directToLandlord && <Ionicons name="checkmark" size={14} color={Colors.white} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Paid directly to landlord</Text>
              <Text style={styles.helperText}>No cashbook required</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
            onPress={submit}
            disabled={submitting}
          >
            {submitting
              ? <ActivityIndicator size="small" color={Colors.white} />
              : <Text style={styles.submitText}>Record Payment</Text>}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 20, gap: 18, paddingBottom: 60 },

  field: { gap: 6 },
  label: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted },

  tenantChip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.primaryFaded,
    borderRadius: 12, borderWidth: 1.5, borderColor: Colors.primary,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  tenantChipName: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  tenantChipSub:  { fontSize: 12, color: Colors.textMuted, marginTop: 2 },

  searchResults: {
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.border, overflow: 'hidden', marginTop: 4,
  },
  searchResultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  searchResultName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  searchResultSub:  { fontSize: 12, color: Colors.textMuted, marginTop: 1 },
  noResults:        { fontSize: 13, color: Colors.textMuted, textAlign: 'center', marginTop: 4 },

  balanceCard: {
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border, padding: 16, gap: 12,
  },
  cardTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted },
  balanceRow: { flexDirection: 'row', alignItems: 'center' },
  balanceStat: { flex: 1, alignItems: 'center', gap: 4 },
  balanceStatLabel: { fontSize: 11, color: Colors.textMuted },
  balanceStatValue: { fontSize: 17, fontWeight: '800' },
  balanceDivider: { width: 1, height: 36, backgroundColor: Colors.borderLight, marginHorizontal: 8 },

  invoicesCard: {
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border, padding: 16,
  },
  openInvRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  openInvRowHighlighted: {
    borderLeftWidth: 3, borderLeftColor: Colors.primary, paddingLeft: 8,
  },
  openInvNum: { fontSize: 13, fontWeight: '700', color: Colors.text },
  openInvCat: { fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  openInvAmt: { fontSize: 14, fontWeight: '800', color: Colors.danger },

  inputBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.border,
    paddingHorizontal: 14, height: 50,
  },
  inputText: { fontSize: 14, color: Colors.text },
  prefix:    { fontSize: 13, fontWeight: '700', color: Colors.textMuted },

  descriptionBox: {
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  descriptionInput: { fontSize: 14, color: Colors.text, minHeight: 72, textAlignVertical: 'top' },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 20, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  pillActive:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillText:       { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  pillTextActive: { color: Colors.white },

  toggle: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.border, padding: 14,
  },
  toggleBox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  toggleBoxActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  toggleLabel:     { fontSize: 14, fontWeight: '600', color: Colors.text },
  helperText:      { fontSize: 12, color: Colors.textMuted, marginTop: 2 },

  submitBtn: {
    backgroundColor: Colors.primary, borderRadius: 14,
    height: 54, alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  submitText: { color: Colors.white, fontSize: 16, fontWeight: '800' },
});
