import React, { useEffect, useMemo, useState } from 'react';
import { useTabState } from '../../hooks/useTabState';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FaArrowLeft, FaRedoAlt, FaSave } from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { getProperties, updateProperty } from '../../redux/propertyRedux';
import { adminRequests } from '../../utils/requestMethods';
import { selectCurrentCompany, selectCurrentUser, selectAllProperties } from '../../redux/selectors';
import { hasCompanyPermission } from '../../utils/permissions';
import AppSelect from '../../components/common/AppSelect';
import ListToolbar from '../../components/common/ListToolbar';
import { useTerm } from '../../hooks/useTerm';

const CARD = 'border border-slate-200 bg-white';
const INPUT = 'w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20';
const SELECT = INPUT;
const GREEN = 'bg-[#0B3B2E]';
const GREEN_HOVER = 'hover:bg-[#0A3127]';

const normalizeCategoryKey = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '_')
    .replace(/^_+|_+$/g, '');

const buildCommissionCategoryKey = (kind = 'utility', name = '') => {
  if (kind === 'rent') return 'rent';
  const normalizedName = normalizeCategoryKey(name);
  return normalizedName ? `${kind}:${normalizedName}` : `${kind}:other`;
};

const readableCategoryKind = (value = '') =>
  String(value || 'utility')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());

const defaultForm = {
  commissionPaymentMode: 'percentage',
  commissionPercentage: 0,
  commissionFixedAmount: 0,
  commissionRecognitionBasis: 'received',
  prepaymentRecognition: 'on_invoice_allocation',
  tenantsPaysTo: 'propertyManager',
  depositHeldBy: 'propertyManager',
  commissionCategoryKeys: ['rent'],
  commissionTaxSettings: {
    enabled: false,
    taxCodeKey: 'vat_standard',
    taxMode: 'company_default',
    rateOverride: '',
  },
};

const normalizePropertyForm = (property) => ({
  commissionPaymentMode: property?.commissionPaymentMode || 'percentage',
  commissionPercentage: Number(property?.commissionPercentage || 0),
  commissionFixedAmount: Number(property?.commissionFixedAmount || 0),
  commissionRecognitionBasis: property?.commissionRecognitionBasis || 'received',
  prepaymentRecognition: property?.prepaymentRecognition || 'on_invoice_allocation',
  tenantsPaysTo: property?.tenantsPaysTo || 'propertyManager',
  depositHeldBy: property?.depositHeldBy || 'propertyManager',
  commissionCategoryKeys: Array.isArray(property?.commissionCategoryKeys) && property.commissionCategoryKeys.length > 0
    ? Array.from(new Set(property.commissionCategoryKeys.map((item) => normalizeCategoryKey(item)).filter(Boolean)))
    : ['rent'],
  commissionTaxSettings: {
    enabled: Boolean(property?.commissionTaxSettings?.enabled),
    taxCodeKey: property?.commissionTaxSettings?.taxCodeKey || 'vat_standard',
    taxMode: property?.commissionTaxSettings?.taxMode || 'company_default',
    rateOverride:
      property?.commissionTaxSettings?.rateOverride === null || property?.commissionTaxSettings?.rateOverride === undefined
        ? ''
        : String(property.commissionTaxSettings.rateOverride),
  },
});

const PropertyCommissionSettings = () => {
  const termProperty   = useTerm('property');
  const termProperties = useTerm('properties');
  const termRent       = useTerm('rent');
  const termTenant     = useTerm('tenant');
  const termTenants    = useTerm('tenants');
  const termLandlord   = useTerm('landlord');
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const currentUser = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
  const canWrite = hasCompanyPermission(currentUser || {}, currentCompany, "commissions", "create", "propertyManagement");
  const properties = useSelector(selectAllProperties);

  const businessId = currentCompany?._id || currentUser?.company?._id || currentUser?.company;
  const [selectedPropertyId, setSelectedPropertyId] = useTabState('/properties/commission-settings:selectedPropertyId', '');
  const [formData, setFormData] = useState(defaultForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [taxConfig, setTaxConfig] = useState({
    taxSettings: { enabled: false, defaultVatRate: 16 },
    taxCodes: [],
    utilityTypes: [],
  });

  useEffect(() => {
    if (!businessId) return;
    setLoading(true);
    dispatch(getProperties({ business: businessId, limit: 500 }))
      .unwrap()
      .catch(() => toast.error('Failed to load properties'))
      .finally(() => setLoading(false));
  }, [businessId, dispatch]);

  useEffect(() => {
    let cancelled = false;

    const loadTaxConfig = async () => {
      if (!businessId) return;
      try {
        const response = await adminRequests.get(`/company-settings/${businessId}`);
        if (cancelled) return;
        setTaxConfig({
          taxSettings: response?.data?.taxSettings || { enabled: false, defaultVatRate: 16 },
          taxCodes: Array.isArray(response?.data?.taxCodes) ? response.data.taxCodes : [],
          utilityTypes: Array.isArray(response?.data?.utilityTypes) ? response.data.utilityTypes : [],
        });
      } catch (error) {
        if (!cancelled) {
          setTaxConfig({
            taxSettings: { enabled: false, defaultVatRate: 16 },
            taxCodes: [],
            utilityTypes: [],
          });
        }
      }
    };

    loadTaxConfig();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const selectedProperty = useMemo(
    () => properties.find((item) => String(item?._id) === String(selectedPropertyId)) || null,
    [properties, selectedPropertyId]
  );

  const activeTaxCodes = useMemo(() => {
    const rows = Array.isArray(taxConfig.taxCodes) ? taxConfig.taxCodes.filter((item) => item?.isActive !== false) : [];
    if (rows.length > 0) return rows;
    return [{ key: 'vat_standard', name: 'VAT Standard', rate: Number(taxConfig?.taxSettings?.defaultVatRate || 16) }];
  }, [taxConfig]);


  const availableCommissionCategories = useMemo(() => {
    const utilityTypes = Array.isArray(taxConfig.utilityTypes)
      ? taxConfig.utilityTypes.filter((item) => item?.isActive !== false)
      : [];

    const utilityRows = utilityTypes
      .map((item) => {
        const categoryType = normalizeCategoryKey(item?.category || 'utility') || 'utility';
        const normalizedName = String(item?.name || '').trim();
        if (!normalizedName) return null;
        return {
          key: buildCommissionCategoryKey(categoryType, normalizedName),
          label: normalizedName,
          categoryType,
          description: item?.description || '',
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.label.localeCompare(right.label));

    return [
      {
        key: 'rent',
        label: termRent,
        categoryType: 'rent',
        description: `Rent charges on statements.`,
      },
      ...utilityRows,
    ];
  }, [taxConfig.utilityTypes, termRent]);

  useEffect(() => {
    if (!selectedProperty) {
      setFormData(defaultForm);
      return;
    }
    setFormData(normalizePropertyForm(selectedProperty));
  }, [selectedProperty]);

  const handleFieldChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({
      ...prev,
      [name]: ['commissionPercentage', 'commissionFixedAmount'].includes(name) ? Number(value || 0) : value,
    }));
  };

  const handleTaxFieldChange = (event) => {
    const { name, value, type, checked } = event.target;
    setFormData((prev) => ({
      ...prev,
      commissionTaxSettings: {
        ...prev.commissionTaxSettings,
        [name]: type === 'checkbox' ? checked : value,
      },
    }));
  };


  const handleCommissionCategoryToggle = (categoryKey) => {
    const normalizedKey = normalizeCategoryKey(categoryKey);
    if (!normalizedKey) return;

    setFormData((prev) => {
      const existing = new Set(
        Array.isArray(prev.commissionCategoryKeys)
          ? prev.commissionCategoryKeys.map((item) => normalizeCategoryKey(item)).filter(Boolean)
          : ['rent']
      );

      if (existing.has(normalizedKey)) existing.delete(normalizedKey);
      else existing.add(normalizedKey);

      const nextKeys = Array.from(existing);
      return {
        ...prev,
        commissionCategoryKeys: nextKeys.length > 0 ? nextKeys : ['rent'],
      };
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!selectedProperty) {
      toast.error('Select a property first');
      return;
    }

    if (['percentage', 'both'].includes(formData.commissionPaymentMode)) {
      if (formData.commissionPercentage < 0 || formData.commissionPercentage > 100) {
        toast.error('Commission percentage must be between 0 and 100');
        return;
      }
    }

    if (['fixed', 'both'].includes(formData.commissionPaymentMode) && formData.commissionFixedAmount < 0) {
      toast.error('Fixed commission amount cannot be negative');
      return;
    }

    const normalizedCommissionCategoryKeys = Array.from(
      new Set(
        (Array.isArray(formData.commissionCategoryKeys) ? formData.commissionCategoryKeys : ['rent'])
          .map((item) => normalizeCategoryKey(item))
          .filter(Boolean)
      )
    );

    if (normalizedCommissionCategoryKeys.length === 0) {
      toast.error('Select at least one commissionable statement category');
      return;
    }

    const payload = {
      ...formData,
      commissionCategoryKeys: normalizedCommissionCategoryKeys,
      commissionTaxSettings: {
        enabled: Boolean(formData.commissionTaxSettings.enabled),
        taxCodeKey: formData.commissionTaxSettings.taxCodeKey || 'vat_standard',
        taxMode: formData.commissionTaxSettings.taxMode || 'company_default',
        rateOverride:
          formData.commissionTaxSettings.rateOverride === ''
            ? null
            : Number(formData.commissionTaxSettings.rateOverride || 0),
      },
    };

    setSaving(true);
    try {
      await dispatch(updateProperty({ id: selectedProperty._id, propertyData: payload })).unwrap();
      toast.success(`${termProperty} commission settings updated successfully`);
      dispatch(getProperties({ business: businessId, limit: 500 }));
    } catch (error) {
      toast.error(error || `Failed to update ${termProperty.toLowerCase()} commission settings`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">
        <ListToolbar>
          <span className="text-xs font-black uppercase tracking-wide text-slate-900">Commission settings</span>
          <ListToolbar.Divider />
          <AppSelect
            value={selectedPropertyId}
            onChange={(v) => setSelectedPropertyId(v ?? "")}
            options={properties.map((p) => ({ value: p._id, label: `${p.propertyCode} - ${p.propertyName}` }))}
            placeholder={`Select ${termProperty.toLowerCase()}`}
            searchable
            disabled={loading}
            compact
          />
          <ListToolbar.Divider />
          <ListToolbar.Button icon={FaArrowLeft} variant="outline" onClick={() => navigate(-1)}>Back</ListToolbar.Button>
        </ListToolbar>

        {/* Scrollable content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">

          {selectedProperty && (
            <form id="commission-settings-form" onSubmit={handleSubmit} className="space-y-3">
              <div className="border border-slate-200 bg-white px-3 py-2">
                <div className="text-sm font-bold text-slate-900">{selectedProperty.propertyName}</div>
                <div className="text-xs text-slate-500">{termProperty} code: {selectedProperty.propertyCode}</div>
              </div>

              {String(selectedProperty.letManage || "").toLowerCase() === "letting" && (
                <div className="border border-slate-300 bg-slate-50 p-3">
                  <div className="flex items-start gap-3">
                    <FaInfoCircle className="mt-0.5 flex-shrink-0 text-slate-500" />
                    <div>
                      <p className="text-xs font-bold text-slate-900">Letting mode {termProperty}</p>
                      <p className="mt-1 text-xs text-slate-700">
                        This {termProperty.toLowerCase()} is set to <strong>Letting</strong> mode. {termTenant} payments go directly to the {termLandlord.toLowerCase()} and the {termLandlord.toLowerCase()} holds the deposit.
                        Commission processing and {termLandlord.toLowerCase()} disbursement statements are not available for Letting {termProperties.toLowerCase()}.
                        Any commission settings saved here will be stored but will not be applied to processed statements.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid gap-3 lg:grid-cols-2">
                <div className={`${CARD} p-3`}>
                  <h2 className="text-xs font-black uppercase tracking-wide text-slate-800">Commission Rule</h2>
                  <p className="mt-1 text-xs text-slate-500">These settings control the core management commission architecture for this {termProperty.toLowerCase()}.</p>

                  <div className="mt-5 space-y-4">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-900">Commission Mode</label>
                      <AppSelect
                        value={formData.commissionPaymentMode || null}
                        onChange={(v) => setFormData((f) => ({ ...f, commissionPaymentMode: v ?? '' }))}
                        options={[
                          { value: 'percentage', label: 'Percentage (%)' },
                          { value: 'fixed', label: 'Fixed Amount' },
                          { value: 'both', label: 'Percentage + Fixed' },
                        ]}
                        size="sm"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-900">Commission Percentage</label>
                      <input
                        type="number"
                        name="commissionPercentage"
                        min="0"
                        max="100"
                        step="0.01"
                        disabled={formData.commissionPaymentMode === 'fixed'}
                        value={formData.commissionPercentage}
                        onChange={handleFieldChange}
                        className={`${INPUT} disabled:bg-slate-100 disabled:text-slate-500`}
                      />
                    </div>

                    {(formData.commissionPaymentMode === 'fixed' || formData.commissionPaymentMode === 'both') && (
                      <div>
                        <label className="mb-1 block text-xs font-bold text-slate-900">Fixed Commission Amount</label>
                        <input
                          type="number"
                          name="commissionFixedAmount"
                          min="0"
                          step="0.01"
                          value={formData.commissionFixedAmount}
                          onChange={handleFieldChange}
                          className={INPUT}
                        />
                      </div>
                    )}

                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-900">Commission Recognition Basis</label>
                      <AppSelect
                        value={formData.commissionRecognitionBasis || null}
                        onChange={(v) => setFormData((f) => ({ ...f, commissionRecognitionBasis: v ?? '' }))}
                        options={[
                          { value: 'received', label: 'Collections Received' },
                          { value: 'invoiced', label: `${termRent} Expected (Invoiced / Accrual)` },
                          { value: 'received_manager_only', label: 'Manager-Held Collections Only' },
                        ]}
                        size="sm"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-900">Prepayment Recognition</label>
                      <AppSelect
                        value={formData.prepaymentRecognition || null}
                        onChange={(v) => setFormData((f) => ({ ...f, prepaymentRecognition: v ?? '' }))}
                        options={[
                          { value: 'on_invoice_allocation', label: 'On invoice allocation (hold prepayment until its rent is billed)' },
                          { value: 'on_receipt', label: 'On receipt (recognise the full payment when it lands)' },
                        ]}
                        size="sm"
                      />
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Controls when a payment received ahead of its {termRent.toLowerCase()} bill counts toward
                        collections, commission and remittance. &ldquo;On invoice allocation&rdquo; defers it to the
                        period the {termRent.toLowerCase()} falls due &mdash; no early remittance, counted once.
                      </p>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-900">{termTenants} Pay To</label>
                      <AppSelect
                        value={formData.tenantsPaysTo || null}
                        onChange={(v) => setFormData((f) => ({ ...f, tenantsPaysTo: v ?? '' }))}
                        options={[
                          { value: 'propertyManager', label: `${termProperty} Manager` },
                          { value: 'landlord', label: termLandlord },
                        ]}
                        size="sm"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-900">Deposit Held By</label>
                      <AppSelect
                        value={formData.depositHeldBy || null}
                        onChange={(v) => setFormData((f) => ({ ...f, depositHeldBy: v ?? '' }))}
                        options={[
                          { value: 'propertyManager', label: `${termProperty} Manager` },
                          { value: 'landlord', label: termLandlord },
                        ]}
                        size="sm"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-900">Commissionable Statement Categories</label>
                      <p className="mb-3 text-xs leading-5 text-slate-500">
                        Choose which statement charges count toward the commission.
                        Utility and service-charge types are managed under Operational Settings, Utility Types.
                      </p>
                      <div className="space-y-3">
                        {availableCommissionCategories.map((item) => {
                          const isChecked = (formData.commissionCategoryKeys || []).includes(item.key);
                          return (
                            <label key={item.key} className={`flex items-start gap-3 border px-3 py-2 transition ${isChecked ? 'border-slate-400 bg-slate-100' : 'border-slate-200 bg-white'}`}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleCommissionCategoryToggle(item.key)}
                                className="mt-1 h-4 w-4 rounded border-slate-300 text-[#0B3B2E]"
                              />
                              <div>
                                <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {readableCategoryKind(item.categoryType)}
                                  {item.description ? ` • ${item.description}` : ''}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                <div className={`${CARD} p-3`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-xs font-black uppercase tracking-wide text-slate-800">Management Commission VAT / Tax</h2>
                      <p className="mt-1 text-xs text-slate-500">
                        This is the advanced property-level tax section for management commission. The simple commission list remains untouched.
                      </p>
                    </div>
                    <div className={`border border-slate-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700`}>
                      {taxConfig?.taxSettings?.enabled ? 'Company tax enabled' : 'Company tax off'}
                    </div>
                  </div>

                  <div className="mt-5 space-y-4">
                    <label className="flex items-start gap-3 border border-slate-200 bg-white px-3 py-2">
                      <input
                        type="checkbox"
                        name="enabled"
                        checked={Boolean(formData.commissionTaxSettings.enabled)}
                        onChange={handleTaxFieldChange}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-[#0B3B2E]"
                      />
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Apply VAT/tax on management commission</div>
                        <div className="mt-1 text-xs leading-5 text-slate-600">
                          When enabled, processed statements will calculate tax on commission and post Output VAT / Tax Payable separately.
                        </div>
                      </div>
                    </label>

                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-900">Tax Code</label>
                      <AppSelect
                        value={formData.commissionTaxSettings.taxCodeKey || null}
                        onChange={(v) => setFormData((f) => ({ ...f, commissionTaxSettings: { ...f.commissionTaxSettings, taxCodeKey: v ?? '' } }))}
                        options={activeTaxCodes.map((taxCode) => ({ value: taxCode.key, label: `${taxCode.name} (${Number(taxCode.rate || 0)}%)` }))}
                        disabled={!formData.commissionTaxSettings.enabled}
                        size="sm"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-900">Tax Mode</label>
                      <AppSelect
                        value={formData.commissionTaxSettings.taxMode || null}
                        onChange={(v) => setFormData((f) => ({ ...f, commissionTaxSettings: { ...f.commissionTaxSettings, taxMode: v ?? '' } }))}
                        options={[
                          { value: 'company_default', label: 'Use Company Default' },
                          { value: 'exclusive', label: 'Tax Exclusive' },
                          { value: 'inclusive', label: 'Tax Inclusive' },
                        ]}
                        disabled={!formData.commissionTaxSettings.enabled}
                        size="sm"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-900">Rate Override (Optional)</label>
                      <input
                        type="number"
                        name="rateOverride"
                        min="0"
                        step="0.01"
                        placeholder={`Default ${Number(taxConfig?.taxSettings?.defaultVatRate || 16)}%`}
                        value={formData.commissionTaxSettings.rateOverride}
                        onChange={handleTaxFieldChange}
                        disabled={!formData.commissionTaxSettings.enabled}
                        className={`${INPUT} disabled:bg-slate-100 disabled:text-slate-500`}
                      />
                    </div>

                  </div>
                </div>
              </div>

            </form>
          )}
        </div>

        {/* Sticky footer */}
        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-white px-3 py-2">
          <button
            type="button"
            onClick={() => setFormData(selectedProperty ? normalizePropertyForm(selectedProperty) : defaultForm)}
            disabled={!selectedProperty || saving}
            className="border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Reset
          </button>
          {canWrite && (
            <button
              type="submit"
              form="commission-settings-form"
              disabled={!selectedProperty || saving}
              className="flex items-center gap-1.5 bg-[#0B3B2E] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FaSave /> {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default PropertyCommissionSettings;
