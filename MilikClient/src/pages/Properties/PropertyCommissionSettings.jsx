import React, { useEffect, useMemo, useState } from 'react';
import { useTabState } from '../../hooks/useTabState';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FaArrowLeft, FaInfoCircle, FaSave } from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { getProperties, updateProperty } from '../../redux/propertyRedux';
import { adminRequests } from '../../utils/requestMethods';
import { selectCurrentCompany, selectCurrentUser } from '../../redux/selectors';
import { hasCompanyPermission } from '../../utils/permissions';
import AppSelect from '../../components/common/AppSelect';

const CARD = 'rounded-2xl border border-slate-200 bg-white shadow-sm';
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
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const currentUser = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
  const canWrite = hasCompanyPermission(currentUser || {}, currentCompany, "commissions", "create", "propertyManagement");
  const propertyState = useSelector((state) => state.property || {});
  const properties = Array.isArray(propertyState?.properties)
    ? propertyState.properties
    : [];

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
        label: 'Rent',
        categoryType: 'rent',
        description: 'Classic rent line items remain commissionable by default for backward compatibility.',
      },
      ...utilityRows,
    ];
  }, [taxConfig.utilityTypes]);

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
      toast.success('Property commission settings updated successfully');
      dispatch(getProperties({ business: businessId, limit: 500 }));
    } catch (error) {
      toast.error(error || 'Failed to update property commission settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Commission Settings</h1>
              <p className="mt-1 text-sm text-slate-600">
                Configure property-level management commission rules and VAT/tax treatment for statements.
              </p>
            </div>
            <button
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <FaArrowLeft /> Back
            </button>
          </div>

          <div className={`${CARD} p-5`}>
            <label className="mb-0.5 block text-xs font-semibold text-slate-700">Select Property</label>
            <AppSelect
              value={selectedPropertyId}
              onChange={(v) => setSelectedPropertyId(v ?? "")}
              options={properties.map((p) => ({ value: p._id, label: `${p.propertyCode} - ${p.propertyName}` }))}
              placeholder="-- Select Property --"
              searchable
              disabled={loading}
              size="sm"
            />
          </div>

          {selectedProperty && (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className={`${GREEN} rounded-2xl p-5 text-white shadow-sm`}>
                <div className="text-xl font-bold">{selectedProperty.propertyName}</div>
                <div className="mt-1 text-sm text-emerald-50">Property Code: {selectedProperty.propertyCode}</div>
              </div>

              {String(selectedProperty.letManage || "").toLowerCase() === "letting" && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
                  <div className="flex items-start gap-3">
                    <FaInfoCircle className="mt-0.5 flex-shrink-0 text-amber-600" />
                    <div>
                      <p className="text-sm font-bold text-amber-900">Letting Mode Property</p>
                      <p className="mt-1 text-xs text-amber-800">
                        This property is set to <strong>Letting</strong> mode. Tenant payments go directly to the landlord and the landlord holds the deposit.
                        Commission processing and landlord disbursement statements are not available for Letting properties.
                        Any commission settings saved here will be stored but will not be applied to processed statements.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid gap-6 lg:grid-cols-2">
                <div className={`${CARD} p-5`}>
                  <h2 className="text-lg font-bold text-slate-900">Commission Rule</h2>
                  <p className="mt-1 text-xs text-slate-500">These settings control the core management commission architecture for this property.</p>

                  <div className="mt-5 space-y-4">
                    <div>
                      <label className="mb-0.5 block text-xs font-semibold text-slate-700">Commission Mode</label>
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
                      <label className="mb-0.5 block text-xs font-semibold text-slate-700">Commission Percentage</label>
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
                        <label className="mb-0.5 block text-xs font-semibold text-slate-700">Fixed Commission Amount</label>
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
                      <label className="mb-0.5 block text-xs font-semibold text-slate-700">Commission Recognition Basis</label>
                      <AppSelect
                        value={formData.commissionRecognitionBasis || null}
                        onChange={(v) => setFormData((f) => ({ ...f, commissionRecognitionBasis: v ?? '' }))}
                        options={[
                          { value: 'received', label: 'Collections Received' },
                          { value: 'invoiced', label: 'Rent Expected (Invoiced / Accrual)' },
                          { value: 'received_manager_only', label: 'Manager-Held Collections Only' },
                        ]}
                        size="sm"
                      />
                    </div>

                    <div>
                      <label className="mb-0.5 block text-xs font-semibold text-slate-700">Tenants Pay To</label>
                      <AppSelect
                        value={formData.tenantsPaysTo || null}
                        onChange={(v) => setFormData((f) => ({ ...f, tenantsPaysTo: v ?? '' }))}
                        options={[
                          { value: 'propertyManager', label: 'Property Manager' },
                          { value: 'landlord', label: 'Landlord' },
                        ]}
                        size="sm"
                      />
                    </div>

                    <div>
                      <label className="mb-0.5 block text-xs font-semibold text-slate-700">Deposit Held By</label>
                      <AppSelect
                        value={formData.depositHeldBy || null}
                        onChange={(v) => setFormData((f) => ({ ...f, depositHeldBy: v ?? '' }))}
                        options={[
                          { value: 'propertyManager', label: 'Property Manager' },
                          { value: 'landlord', label: 'Landlord' },
                        ]}
                        size="sm"
                      />
                    </div>

                    <div>
                      <label className="mb-0.5 block text-xs font-semibold text-slate-700">Commissionable Statement Categories</label>
                      <p className="mb-3 text-xs leading-5 text-slate-500">
                        Select the normalized landlord-statement categories that should contribute to the commission base.
                        Rent stays available for backward compatibility, while active utility and service-charge types come from company operational settings.
                      </p>
                      <div className="space-y-3">
                        {availableCommissionCategories.map((item) => {
                          const isChecked = (formData.commissionCategoryKeys || []).includes(item.key);
                          return (
                            <label key={item.key} className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition ${isChecked ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleCommissionCategoryToggle(item.key)}
                                className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600"
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

                <div className={`${CARD} p-5`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900">Management Commission VAT / Tax</h2>
                      <p className="mt-1 text-xs text-slate-500">
                        This is the advanced property-level tax section for management commission. The simple commission list remains untouched.
                      </p>
                    </div>
                    <div className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${taxConfig?.taxSettings?.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {taxConfig?.taxSettings?.enabled ? 'Company tax enabled' : 'Company tax off'}
                    </div>
                  </div>

                  <div className="mt-5 space-y-4">
                    <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <input
                        type="checkbox"
                        name="enabled"
                        checked={Boolean(formData.commissionTaxSettings.enabled)}
                        onChange={handleTaxFieldChange}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600"
                      />
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Apply VAT/tax on management commission</div>
                        <div className="mt-1 text-xs leading-5 text-slate-600">
                          When enabled, processed statements will calculate tax on commission and post Output VAT / Tax Payable separately.
                        </div>
                      </div>
                    </label>

                    <div>
                      <label className="mb-0.5 block text-xs font-semibold text-slate-700">Tax Code</label>
                      <AppSelect
                        value={formData.commissionTaxSettings.taxCodeKey || null}
                        onChange={(v) => setFormData((f) => ({ ...f, commissionTaxSettings: { ...f.commissionTaxSettings, taxCodeKey: v ?? '' } }))}
                        options={activeTaxCodes.map((taxCode) => ({ value: taxCode.key, label: `${taxCode.name} (${Number(taxCode.rate || 0)}%)` }))}
                        disabled={!formData.commissionTaxSettings.enabled}
                        size="sm"
                      />
                    </div>

                    <div>
                      <label className="mb-0.5 block text-xs font-semibold text-slate-700">Tax Mode</label>
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
                      <label className="mb-0.5 block text-xs font-semibold text-slate-700">Rate Override (Optional)</label>
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

                    <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-800">
                      <div className="flex items-start gap-2">
                        <FaInfoCircle className="mt-0.5" />
                        <div>
                          <div className="font-bold">Phase 1 behavior</div>
                          <div className="mt-1 leading-5">
                            Statement deductions will use gross commission where tax applies, while ledger posting will separate commission income and tax payable.
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setFormData(selectedProperty ? normalizePropertyForm(selectedProperty) : defaultForm)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Reset
                </button>
                {canWrite && (
                <button
                  type="submit"
                  disabled={saving}
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-black text-white disabled:opacity-60 ${GREEN} ${GREEN_HOVER}`}
                >
                  <FaSave /> {saving ? 'Saving...' : 'Save Commission Settings'}
                </button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default PropertyCommissionSettings;
