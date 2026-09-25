import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import { Dropdown, DropdownItem } from '../../../../components/ui/Dropdown';
import { DateField } from '../../../../components/ui/DateField';
import { useDebounced } from '../../../../hooks/usePagedList';
import { apiError, cleanDecimal, fmtDate, fmtMoney, todayISO } from '../../../../utils/pmsFormat';
import { INVOICE_CATEGORY_LABEL, rowsOf } from '../../../../utils/pmsBilling';

type TenantOption = {
  _id:       string;
  name:      string;
  unitId?:   string;
  unitNum?:  string;
  propName?: string;
};

type OpenInvoice = {
  _id:           string;
  invoiceNumber: string;
  category:      string;
  outstanding:   number;
  dueDate?:      string;
};

type TenantBalance = {
  currentBalance: number;
  totalPaid:      number;
  depositAmount:  number;
};

// `value` is what the server stores (RentPayment.paymentMethod enum).
const PAYMENT_METHODS = [
  { value: 'mobile_money',  label: 'M-Pesa',        refLabel: 'M-Pesa transaction code', refHint: 'e.g. QJZ7HK3P2T' },
  { value: 'cash',          label: 'Cash',          refLabel: 'Reference / slip no.',    refHint: 'Receipt book or slip number' },
  { value: 'bank_transfer', label: 'Bank Transfer', refLabel: 'Bank reference',          refHint: 'EFT reference / slip no.' },
  { value: 'check',         label: 'Cheque',        refLabel: 'Cheque number',           refHint: 'Cheque number' },
  { value: 'credit_card',   label: 'Card',          refLabel: 'Card auth. reference',    refHint: 'Authorisation code' },
] as const;

// Same test the web uses to decide which asset accounts are cashbooks.
const CASHBOOK_RE = /cash|bank|m-?pesa|mobile money|wallet|petty|till|collection/i;
const isCashbookAccount = (a: Record<string, any>) =>
  String(a?.type || '').toLowerCase() === 'asset' &&
  !a.isHeader && a.isPosting !== false && !a.isControl &&
  CASHBOOK_RE.test(`${a?.name || ''} ${a?.group || ''} ${a?.subGroup || ''}`);

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function parseTenant(t: Record<string, any>): TenantOption {
  const unit = t.unit as Record<string, any> | undefined;
  const prop = unit?.property as Record<string, any> | undefined;
  return {
    _id:      String(t._id ?? ''),
    name:     String(t.name ?? '') || 'Unnamed tenant',
    unitId:   unit?._id ? String(unit._id) : undefined,
    unitNum:  unit?.unitNumber,
    propName: prop?.propertyName ?? prop?.name,
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
  const [includePast,      setIncludePast]      = useState(false);
  const [tenantResults,    setTenantResults]    = useState<TenantOption[]>([]);
  const [tenantSearching,  setTenantSearching]  = useState(false);
  const debouncedSearch = useDebounced(tenantSearch.trim(), 400);

  // Tenant data
  const [balance,        setBalance]        = useState<TenantBalance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [openInvoices,   setOpenInvoices]   = useState<OpenInvoice[]>([]);
  const [invLoading,     setInvLoading]     = useState(false);
  const [selectedInv,    setSelectedInv]    = useState<string[]>([]);

  // Cashbook
  const [cashbooks,        setCashbooks]        = useState<DropdownItem[]>([]);
  const [cashbooksLoading, setCashbooksLoading] = useState(false);
  const [cashbookId,       setCashbookId]       = useState('');
  const [cashbookLabel,    setCashbookLabel]    = useState('');
  const [cashbookOpen,     setCashbookOpen]     = useState(false);

  // Form
  const [paymentMethod,    setPaymentMethod]    = useState<typeof PAYMENT_METHODS[number]['value']>('mobile_money');
  const [amount,           setAmount]           = useState('');
  const [refNumber,        setRefNumber]        = useState('');
  const [paymentDate,      setPaymentDate]      = useState(todayISO());
  const [description,      setDescription]      = useState('');
  const [directToLandlord, setDirectToLandlord] = useState(false);
  const [submitting,       setSubmitting]       = useState(false);
  const submittingRef = useRef(false);
  const invoicePreselected = useRef(false);

  const method = PAYMENT_METHODS.find(m => m.value === paymentMethod) ?? PAYMENT_METHODS[0];

  // Load properties
  useEffect(() => {
    setPropsLoading(true);
    api.get('/properties', { params: { limit: 200, status: 'active' } })
      .then(({ data }) =>
        setProperties(
          (Array.isArray(data?.data) ? data.data : []).map((p: Record<string, any>) => ({
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
    setSelectedTenant({ _id: prefilledTenantId, name: prefilledTenantName || 'Tenant' });
    api.get(`/tenants/${prefilledTenantId}`)
      .then(({ data }) => {
        const t = data?.data ?? data;
        if (t?._id) setSelectedTenant(parseTenant(t));
      })
      .catch(() => {});
  }, [prefilledTenantId, prefilledTenantName]);

  // Load cashbooks once (asset accounts that look like cashbooks — same rule as the web)
  useEffect(() => {
    setCashbooksLoading(true);
    api.get('/chart-of-accounts', { params: { type: 'asset' } })
      .then(({ data }) => {
        const all: Record<string, any>[] = Array.isArray(data) ? data : [];
        const banks: DropdownItem[] = all.filter(isCashbookAccount).map(a => ({
          _id:      String(a._id ?? ''),
          label:    String(a.name ?? a.accountName ?? ''),
          sublabel: String(a.code ?? ''),
        }));
        setCashbooks(banks);
        const preferred = banks.find(b => b.label === 'Main Cashbook') ?? banks[0];
        if (preferred) { setCashbookId(preferred._id); setCashbookLabel(preferred.label); }
      })
      .catch(() => {})
      .finally(() => setCashbooksLoading(false));
  }, []);

  // Live tenant search (filtered by property when one is selected)
  useEffect(() => {
    if (selectedTenant) return;
    if (debouncedSearch.length < 2 && !selectedPropId) { setTenantResults([]); return; }
    let cancelled = false;
    setTenantSearching(true);
    const params: Record<string, string | number> = { limit: 20 };
    if (debouncedSearch) params.search = debouncedSearch;
    if (!includePast) params.status = 'active';
    if (selectedPropId) params.property = selectedPropId;
    api.get('/tenants', { params })
      .then(({ data }) => {
        if (cancelled) return;
        setTenantResults((Array.isArray(data?.data) ? data.data : []).map(parseTenant));
      })
      .catch(() => { if (!cancelled) setTenantResults([]); })
      .finally(() => { if (!cancelled) setTenantSearching(false); });
    return () => { cancelled = true; };
  }, [debouncedSearch, selectedTenant, selectedPropId, includePast]);

  // Load balance + open invoices when a tenant is selected
  const loadTenantData = useCallback(async (tenantId: string) => {
    setBalanceLoading(true);
    setInvLoading(true);
    const [balRes, invRes] = await Promise.allSettled([
      api.get(`/tenants/balance/${tenantId}`),
      // No paginate/limit -> plain array, oldest first, with outstanding amounts computed by the server
      api.get('/tenant-invoices', { params: { tenant: tenantId, includeSnapshots: 'true' } }),
    ]);
    if (balRes.status === 'fulfilled') {
      const b = balRes.value.data?.data ?? balRes.value.data;
      setBalance({
        currentBalance: Number(b?.currentBalance ?? 0),
        totalPaid:      Number(b?.totalPaid ?? 0),
        depositAmount:  Number(b?.depositAmount ?? 0),
      });
    } else {
      setBalance(null);
    }
    setBalanceLoading(false);
    if (invRes.status === 'fulfilled') {
      const open = rowsOf<Record<string, any>>(invRes.value.data)
        .filter(inv => {
          const st = String(inv.computedStatus || inv.status || '').toLowerCase();
          return st !== 'cancelled' && st !== 'reversed' && Number(inv.outstanding ?? 0) > 0.009;
        })
        .map((inv): OpenInvoice => ({
          _id:           String(inv._id ?? ''),
          invoiceNumber: String(inv.invoiceNumber ?? ''),
          category:      String(inv.category ?? ''),
          outstanding:   round2(Number(inv.outstanding ?? 0)),
          dueDate:       inv.dueDate ? String(inv.dueDate) : undefined,
        }));
      setOpenInvoices(open);

      // Arrived from an invoice: pre-select it and suggest its outstanding amount
      if (prefilledInvoiceId && !invoicePreselected.current) {
        const target = open.find(o => o._id === prefilledInvoiceId);
        if (target) {
          invoicePreselected.current = true;
          setSelectedInv([target._id]);
          setAmount(prev => prev || String(target.outstanding));
        }
      }
    } else {
      setOpenInvoices([]);
    }
    setInvLoading(false);
  }, [prefilledInvoiceId]);

  useEffect(() => {
    setSelectedInv([]);
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
    setSelectedInv([]);
  };

  const toggleInvoice = (id: string) =>
    setSelectedInv(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  // Allocation preview: with invoices ticked the amount is applied to them in list order (oldest first),
  // otherwise the server settles the oldest open invoices first. Anything above that is kept as prepayment.
  const preview = useMemo(() => {
    const value = Number(amount);
    const chosen = openInvoices.filter(i => selectedInv.includes(i._id));
    const scope  = chosen.length ? chosen : openInvoices;
    const scopeTotal = round2(scope.reduce((s, i) => s + i.outstanding, 0));
    const valid  = Number.isFinite(value) && value > 0;
    return {
      chosen,
      scopeTotal,
      excess: valid ? round2(Math.max(0, value - scopeTotal)) : 0,
    };
  }, [amount, openInvoices, selectedInv]);

  const submit = async () => {
    if (submittingRef.current) return;
    const value = Number(amount);

    if (!selectedTenant)                        { Alert.alert('Select a tenant', 'Choose the tenant who paid.'); return; }
    if (!selectedTenant.unitId)                 { Alert.alert('No unit', 'This tenant has no unit assigned, so a receipt cannot be recorded.'); return; }
    if (!Number.isFinite(value) || value <= 0)  { Alert.alert('Enter an amount', 'The amount must be greater than zero.'); return; }
    if (!refNumber.trim())                      { Alert.alert('Reference required', `Enter the ${method.refLabel.toLowerCase()}.`); return; }
    if (!paymentDate)                           { Alert.alert('Select a date', 'Choose the payment date.'); return; }
    if (!directToLandlord && !cashbookId)       { Alert.alert('Select a cashbook', 'Choose the cashbook that received the money, or tick "Paid directly to landlord".'); return; }

    const post = async () => {
      submittingRef.current = true;
      setSubmitting(true);
      try {
        const [y, m] = paymentDate.split('-');
        const body: Record<string, unknown> = {
          tenant:               selectedTenant._id,
          unit:                 selectedTenant.unitId,
          amount:               round2(value),
          referenceNumber:      refNumber.trim(),
          paymentMethod,
          paymentDate,
          bankingDate:          paymentDate,
          dueDate:              `${y}-${m}-01`,
          month:                Number(m),          // required by the receipt schema
          year:                 Number(y),          // required by the receipt schema
          ledgerType:           'receipts',
          paidDirectToLandlord: directToLandlord,
          cashbook:             directToLandlord ? '' : cashbookLabel,
          description:          description.trim() || undefined,
        };

        // Invoices ticked -> manual allocation in list (oldest-first) order, capped at each outstanding.
        if (preview.chosen.length) {
          let remaining = round2(value);
          const allocations: { invoiceId: string; appliedAmount: number }[] = [];
          for (const inv of preview.chosen) {
            if (remaining <= 0.009) break;
            const applied = round2(Math.min(inv.outstanding, remaining));
            allocations.push({ invoiceId: inv._id, appliedAmount: applied });
            remaining = round2(remaining - applied);
          }
          body.allocations    = allocations;
          body.allocationMode = 'manual';
        }

        const { data } = await api.post('/rent-payments', body);
        const label = data?.receiptNumber || data?.referenceNumber || '';
        const posted = data?.isConfirmed === true;
        Alert.alert(
          'Receipt recorded',
          `${label ? `Receipt ${label} ` : 'Receipt '}was saved${posted ? ' and posted to the ledger.' : ' and is pending confirmation.'}`,
          [
            { text: 'Done', onPress: () => router.back() },
            ...(data?._id ? [{ text: 'View receipt', onPress: () => router.replace(`/pms/receipts/${data._id}` as any) }] : []),
          ],
        );
      } catch (err) {
        Alert.alert('Could not record receipt', apiError(err, 'Failed to record receipt.'));
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    };

    if (preview.excess > 0.009) {
      Alert.alert(
        'Amount is more than owed',
        `KES ${fmtMoney(preview.excess)} is above the ${preview.chosen.length ? 'selected' : 'open'} invoices (KES ${fmtMoney(preview.scopeTotal)}). The excess will be kept as a rent prepayment on the tenant's account.`,
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Record anyway', onPress: post }],
      );
      return;
    }
    await post();
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Record Payment' }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Property filter */}
          {!prefilledTenantId && (
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
          )}

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
                    placeholder="Search tenant name, phone or unit…"
                    placeholderTextColor={Colors.textMuted}
                    value={tenantSearch}
                    onChangeText={setTenantSearch}
                    autoCorrect={false}
                  />
                  {tenantSearching && <ActivityIndicator size="small" color={Colors.primary} />}
                </View>

                <TouchableOpacity style={styles.inlineToggle} onPress={() => setIncludePast(v => !v)} activeOpacity={0.7}>
                  <View style={[styles.toggleBoxSm, includePast && styles.toggleBoxActive]}>
                    {includePast && <Ionicons name="checkmark" size={11} color={Colors.white} />}
                  </View>
                  <Text style={styles.inlineToggleText}>Include past tenants (balances stay collectible)</Text>
                </TouchableOpacity>

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

                {(debouncedSearch.length >= 2 || selectedPropId) && !tenantSearching && tenantResults.length === 0 && (
                  <Text style={styles.noResults}>
                    {debouncedSearch ? `No tenants found for "${debouncedSearch}"` : 'No tenants found'}
                  </Text>
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
                    <Text style={styles.balanceStatLabel}>{balance.currentBalance < -0.009 ? 'Credit' : 'Outstanding'}</Text>
                    <Text style={[styles.balanceStatValue, {
                      color: balance.currentBalance > 0.009 ? Colors.danger : Colors.success,
                    }]}>
                      KES {fmtMoney(Math.abs(balance.currentBalance))}
                    </Text>
                  </View>
                  <View style={styles.balanceDivider} />
                  <View style={styles.balanceStat}>
                    <Text style={styles.balanceStatLabel}>Total Paid</Text>
                    <Text style={[styles.balanceStatValue, { color: Colors.success }]}>
                      KES {fmtMoney(balance.totalPaid)}
                    </Text>
                  </View>
                </View>
              ) : (
                <Text style={styles.noResults}>Balance unavailable</Text>
              )}
            </View>
          )}

          {/* Open invoices — tick to apply the payment to specific invoices */}
          {selectedTenant && (invLoading || openInvoices.length > 0) && (
            <View style={styles.invoicesCard}>
              <Text style={styles.cardTitle}>OPEN INVOICES</Text>
              {invLoading ? (
                <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 8 }} />
              ) : (
                <>
                  {openInvoices.map(inv => {
                    const on = selectedInv.includes(inv._id);
                    return (
                      <TouchableOpacity
                        key={inv._id}
                        style={[styles.openInvRow, on && styles.openInvRowHighlighted]}
                        onPress={() => toggleInvoice(inv._id)}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.toggleBoxSm, on && styles.toggleBoxActive, { marginRight: 10 }]}>
                          {on && <Ionicons name="checkmark" size={11} color={Colors.white} />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.openInvNum}>{inv.invoiceNumber || 'Invoice'}</Text>
                          <Text style={styles.openInvCat}>
                            {INVOICE_CATEGORY_LABEL[inv.category] ?? inv.category}
                            {inv.dueDate ? ` · Due ${fmtDate(inv.dueDate)}` : ''}
                          </Text>
                        </View>
                        <Text style={styles.openInvAmt}>KES {fmtMoney(inv.outstanding)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                  <Text style={styles.helperText}>
                    {selectedInv.length
                      ? `Payment goes to the ${selectedInv.length} selected invoice${selectedInv.length > 1 ? 's' : ''}, oldest first.`
                      : 'Nothing ticked: the payment settles the oldest open invoices first.'}
                  </Text>
                </>
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
            <View style={styles.labelRow}>
              <Text style={styles.label}>AMOUNT (KES) <Text style={{ color: Colors.danger }}>*</Text></Text>
              {selectedTenant && preview.scopeTotal > 0.009 ? (
                <TouchableOpacity onPress={() => setAmount(String(preview.scopeTotal))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.fillLink}>
                    Use {preview.chosen.length ? 'selected' : 'total open'}: {fmtMoney(preview.scopeTotal)}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <View style={styles.inputBox}>
              <Text style={styles.prefix}>KES</Text>
              <TextInput
                style={[styles.inputText, { flex: 1 }]}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={Colors.textMuted}
                value={amount}
                onChangeText={t => setAmount(cleanDecimal(t))}
              />
            </View>
            {preview.excess > 0.009 ? (
              <Text style={styles.warnText}>
                KES {fmtMoney(preview.excess)} is more than the {preview.chosen.length ? 'selected' : 'open'} invoices and will be kept as a rent prepayment.
              </Text>
            ) : null}
          </View>

          {/* Reference number */}
          <View style={styles.field}>
            <Text style={styles.label}>{method.refLabel.toUpperCase()} <Text style={{ color: Colors.danger }}>*</Text></Text>
            <View style={styles.inputBox}>
              <TextInput
                style={[styles.inputText, { flex: 1 }]}
                placeholder={method.refHint}
                placeholderTextColor={Colors.textMuted}
                value={refNumber}
                onChangeText={setRefNumber}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </View>
            <Text style={styles.helperText}>Must be unique in your company; a duplicate is rejected.</Text>
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
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 20, gap: 18, paddingBottom: 60 },

  field: { gap: 6 },
  label: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fillLink: { fontSize: 11, fontWeight: '700', color: Colors.primary },
  warnText: { fontSize: 12, color: Colors.warning, fontWeight: '600', lineHeight: 17 },

  tenantChip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.primaryFaded,
    borderRadius: 12, borderWidth: 1.5, borderColor: Colors.primary,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  tenantChipName: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  tenantChipSub:  { fontSize: 12, color: Colors.textMuted, marginTop: 2 },

  inlineToggle:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  inlineToggleText: { fontSize: 12, color: Colors.textSecondary },

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
    borderWidth: 1, borderColor: Colors.border, padding: 16, gap: 4,
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
  toggleBoxSm: {
    width: 18, height: 18, borderRadius: 5,
    borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
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
