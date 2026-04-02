import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FaArrowLeft, FaInfoCircle, FaSave } from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { getProperties, updateProperty } from '../../redux/propertyRedux';
import { adminRequests } from '../../utils/requestMethods';

const CARD = 'rounded-2xl border border-slate-200 bg-white shadow-sm';
const INPUT = 'w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100';
const SELECT = INPUT;
const GREEN = 'bg-[#0B3B2E]';
const GREEN_HOVER = 'hover:bg-[#0A3127]';

const defaultForm = {
  commissionPaymentMode: 'percentage',
  commissionPercentage: 0,
  commissionFixedAmount: 0,
  commissionRecognitionBasis: 'received',
  tenantsPaysTo: 'propertyManager',
  depositHeldBy: 'propertyManager',
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
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const propertyState = useSelector((state) => state.property || {});
  const properties = Array.isArray(propertyState?.properties?.data)
    ? propertyState.properties.data
    : Array.isArray(propertyState?.properties)
    ? propertyState.properties
    : [];

  const businessId = currentCompany?._id || currentUser?.company?._id || currentUser?.company;
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [formData, setFormData] = useState(defaultForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [taxConfig, setTaxConfig] = useState({
    taxSettings: { enabled: false, defaultVatRate: 16 },
    taxCodes: [],
  });

  useEffect(() => {
    if (!businessId) return;
    setLoading(true);
    dispatch(getProperties({ business: businessId }))
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
        });
      } catch (error) {
        if (!cancelled) {
          setTaxConfig({
            taxSettings: { enabled: false, defaultVatRate: 16 },
            taxCodes: [],
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

    const payload = {
      ...formData,
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
      dispatch(getProperties({ business: businessId }));
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
            <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-700">Select Property</label>
            <select
              value={selectedPropertyId}
              onChange={(event) => setSelectedPropertyId(event.target.value)}
              className={SELECT}
              disabled={loading}
            >
              <option value="">-- Select Property --</option>
              {properties.map((property) => (
                <option key={property._id} value={property._id}>
                  {property.propertyCode} - {property.propertyName}
                </option>
              ))}
            </select>
          </div>

          {selectedProperty && (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className={`${GREEN} rounded-2xl p-5 text-white shadow-sm`}>
                <div className="text-xl font-bold">{selectedProperty.propertyName}</div>
                <div className="mt-1 text-sm text-emerald-50">Property Code: {selectedProperty.propertyCode}</div>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className={`${CARD} p-5`}>
                  <h2 className="text-lg font-bold text-slate-900">Commission Rule</h2>
                  <p className="mt-1 text-xs text-slate-500">These settings control the core management commission architecture for this property.</p>

                  <div className="mt-5 space-y-4">
                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-700">Commission Mode</label>
                      <select name="commissionPaymentMode" value={formData.commissionPaymentMode} onChange={handleFieldChange} className={SELECT}>
                        <option value="percentage">Percentage (%)</option>
                        <option value="fixed">Fixed Amount</option>
                        <option value="both">Percentage + Fixed</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-700">Commission Percentage</label>
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
                        <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-700">Fixed Commission Amount</label>
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
                      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-700">Commission Recognition Basis</label>
                      <select name="commissionRecognitionBasis" value={formData.commissionRecognitionBasis} onChange={handleFieldChange} className={SELECT}>
                        <option value="received">Collections Received</option>
                        <option value="invoiced">Rent Expected (Invoiced / Accrual)</option>
                        <option value="received_manager_only">Manager-Held Collections Only</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-700">Tenants Pay To</label>
                      <select name="tenantsPaysTo" value={formData.tenantsPaysTo} onChange={handleFieldChange} className={SELECT}>
                        <option value="propertyManager">Property Manager</option>
                        <option value="landlord">Landlord</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-700">Deposit Held By</label>
                      <select name="depositHeldBy" value={formData.depositHeldBy} onChange={handleFieldChange} className={SELECT}>
                        <option value="propertyManager">Property Manager</option>
                        <option value="landlord">Landlord</option>
                      </select>
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
                      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-700">Tax Code</label>
                      <select
                        name="taxCodeKey"
                        value={formData.commissionTaxSettings.taxCodeKey}
                        onChange={handleTaxFieldChange}
                        className={SELECT}
                        disabled={!formData.commissionTaxSettings.enabled}
                      >
                        {activeTaxCodes.map((taxCode) => (
                          <option key={taxCode.key} value={taxCode.key}>
                            {taxCode.name} ({Number(taxCode.rate || 0)}%)
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-700">Tax Mode</label>
                      <select
                        name="taxMode"
                        value={formData.commissionTaxSettings.taxMode}
                        onChange={handleTaxFieldChange}
                        className={SELECT}
                        disabled={!formData.commissionTaxSettings.enabled}
                      >
                        <option value="company_default">Use Company Default</option>
                        <option value="exclusive">Tax Exclusive</option>
                        <option value="inclusive">Tax Inclusive</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-700">Rate Override (Optional)</label>
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
                  className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Reset
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white transition ${GREEN} ${GREEN_HOVER} disabled:opacity-60`}
                >
                  <FaSave /> {saving ? 'Saving...' : 'Save Commission Settings'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default PropertyCommissionSettings;
