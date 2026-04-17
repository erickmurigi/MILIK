import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { getProperties, updateProperty } from '../../redux/propertyRedux';
import { toast } from 'react-toastify';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { FaEdit, FaTrash, FaPlus, FaCheck, FaTimes, FaSearch, FaArrowLeft, FaRedoAlt } from 'react-icons/fa';

const MILIK_GREEN = "#0B3B2E";
const MILIK_GREEN_BG = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "#FF8C00";

const CommissionsList = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const { properties } = useSelector((state) => state.property);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState('all'); // all, configured, unconfigured
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editFormData, setEditFormData] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addFormData, setAddFormData] = useState({
    property: null,
    commissionPercentage: 0,
    commissionRecognitionBasis: 'received',
    tenantsPaysTo: 'propertyManager',
    depositHeldBy: 'propertyManager'
  });

  // Fetch properties on mount
  useEffect(() => {
    const businessId = currentCompany?._id || currentUser?.company?._id || currentUser?.company;
    if (businessId) {
      setLoading(true);
      dispatch(getProperties({ business: businessId }))
        .finally(() => setLoading(false));
    }
  }, [currentCompany?._id, currentUser?.company, dispatch]);

  // Filter properties
  const filteredProperties = properties?.filter(prop => {
    const matchesSearch = 
      (prop.propertyCode?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (prop.propertyName?.toLowerCase() || '').includes(searchTerm.toLowerCase());
    
    const hasCommission = prop.commissionPercentage && prop.commissionPercentage > 0;
    
    if (filterMode === 'configured') return matchesSearch && hasCommission;
    if (filterMode === 'unconfigured') return matchesSearch && !hasCommission;
    return matchesSearch;
  }) || [];

  // Stats
  const stats = {
    total: properties?.length || 0,
    configured: properties?.filter(p => p.commissionPercentage && p.commissionPercentage > 0).length || 0,
    unconfigured: properties?.filter(p => !p.commissionPercentage || p.commissionPercentage === 0).length || 0,
  };

  const resetFilters = () => {
    setSearchTerm('');
    setFilterMode('all');
  };

  const handleEdit = (property) => {
    setEditingId(property._id);
    setEditFormData({
      commissionPercentage: property.commissionPercentage || 0,
      commissionRecognitionBasis: property.commissionRecognitionBasis || 'received',
      tenantsPaysTo: property.tenantsPaysTo || 'propertyManager',
      depositHeldBy: property.depositHeldBy || 'propertyManager'
    });
  };

  const handleEditChange = (field, value) => {
    setEditFormData(prev => ({
      ...prev,
      [field]: field === 'commissionPercentage' ? parseFloat(value) || 0 : value
    }));
  };

  const handleSaveEdit = async (propertyId) => {
    if (editFormData.commissionPercentage < 0 || editFormData.commissionPercentage > 100) {
      toast.error('Commission percentage must be between 0 and 100');
      return;
    }

    try {
      await dispatch(updateProperty({ 
        id: propertyId, 
        propertyData: editFormData 
      })).unwrap();
      
      toast.success('Commission updated successfully');
      setEditingId(null);
      setEditFormData(null);
    } catch (error) {
      toast.error('Failed to update commission');
    }
  };

  const handleDelete = async (propertyId) => {
    if (!window.confirm('Remove commission settings for this property?')) return;

    try {
      await dispatch(updateProperty({ 
        id: propertyId, 
        propertyData: { 
          commissionPercentage: 0,
          commissionRecognitionBasis: 'received',
          tenantsPaysTo: 'propertyManager',
          depositHeldBy: 'propertyManager'
        }
      })).unwrap();
      
      toast.success('Commission removed');
    } catch (error) {
      toast.error('Failed to remove commission');
    }
  };

  const handleAddCommission = async () => {
    if (!addFormData.property) {
      toast.error('Please select a property');
      return;
    }

    if (addFormData.commissionPercentage < 0 || addFormData.commissionPercentage > 100) {
      toast.error('Commission percentage must be between 0 and 100');
      return;
    }

    try {
      await dispatch(updateProperty({ 
        id: addFormData.property, 
        propertyData: {
          commissionPercentage: addFormData.commissionPercentage,
          commissionRecognitionBasis: addFormData.commissionRecognitionBasis,
          tenantsPaysTo: addFormData.tenantsPaysTo,
          depositHeldBy: addFormData.depositHeldBy
        }
      })).unwrap();
      
      toast.success('Commission added successfully');
      setShowAddModal(false);
      setAddFormData({
        property: null,
        commissionPercentage: 0,
        commissionRecognitionBasis: 'received',
        tenantsPaysTo: 'propertyManager',
        depositHeldBy: 'propertyManager'
      });
    } catch (error) {
      toast.error('Failed to add commission');
    }
  };

  const unconfiguredProperties = properties?.filter(p => !p.commissionPercentage || p.commissionPercentage === 0) || [];

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto flex w-full max-w-[96%] flex-col gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#0B3B2E]">Property Management</p>
                <h1 className="mt-1 text-2xl font-black text-slate-900">Commission Management</h1>
                <p className="mt-1 text-sm text-slate-500">
                  Maintain commission settings in a property-style list with cleaner filters, compact actions, and a tighter table layout.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setShowAddModal(true)}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black text-white shadow-sm transition ${MILIK_GREEN_BG} ${MILIK_GREEN_HOVER}`}
                >
                  <FaPlus /> Add Commission
                </button>
                <button
                  onClick={() => navigate(-1)}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  <FaArrowLeft /> Back
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Total Properties</p>
              <p className="mt-2 text-2xl font-black text-slate-900">{stats.total}</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Configured</p>
              <p className="mt-2 text-2xl font-black text-emerald-800">{stats.configured}</p>
            </div>
            <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-700">Unconfigured</p>
              <p className="mt-2 text-2xl font-black text-orange-800">{stats.unconfigured}</p>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="sticky top-0 z-20 flex-shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[240px] flex-1">
                  <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search by property code or name"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 shadow-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                  />
                </div>

                <select
                  value={filterMode}
                  onChange={(e) => setFilterMode(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-[#DDEFE1] px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                >
                  <option value="all">All Properties</option>
                  <option value="configured">Configured Only</option>
                  <option value="unconfigured">Unconfigured Only</option>
                </select>

                <button
                  onClick={resetFilters}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
                >
                  <FaRedoAlt /> Reset
                </button>

                <div className="ml-auto flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm">
                  Visible
                  <span className="text-sm text-slate-900">{filteredProperties.length}</span>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full min-w-[1120px] text-sm">
                <thead>
                  <tr className={`${MILIK_GREEN_BG} sticky top-0 z-10 text-white`}>
                    <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-[0.16em]">Code</th>
                    <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-[0.16em]">Property</th>
                    <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-[0.16em]">Commission</th>
                    <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-[0.16em]">Recognition Basis</th>
                    <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-[0.16em]">Tenants Pay To</th>
                    <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-[0.16em]">Deposits Held By</th>
                    <th className="px-4 py-3 text-right text-xs font-black uppercase tracking-[0.16em]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProperties.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="px-4 py-10 text-center text-slate-500">
                        <FaSearch className="mx-auto mb-3 text-3xl text-slate-300" />
                        <p className="text-sm font-semibold">No commission rows matched the current filters.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredProperties.map((property, index) => (
                      <React.Fragment key={property._id}>
                        {editingId === property._id ? (
                          <tr className="border-t border-slate-200 bg-slate-50/80">
                            <td colSpan="7" className="px-4 py-4">
                              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                                <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                  <div>
                                    <p className="text-sm font-black text-slate-900">
                                      {property.propertyCode || '—'} • {property.propertyName || property.name || 'Property'}
                                    </p>
                                    <p className="text-xs text-slate-500">Edit commission and collection settings for this property.</p>
                                  </div>
                                </div>

                                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                  <div>
                                    <label className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-500">Commission %</label>
                                    <input
                                      type="number"
                                      value={editFormData.commissionPercentage}
                                      onChange={(e) => handleEditChange('commissionPercentage', e.target.value)}
                                      min="0"
                                      max="100"
                                      step="0.01"
                                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                                    />
                                  </div>

                                  <div>
                                    <label className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-500">Recognition Basis</label>
                                    <select
                                      value={editFormData.commissionRecognitionBasis}
                                      onChange={(e) => handleEditChange('commissionRecognitionBasis', e.target.value)}
                                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                                    >
                                      <option value="received">Rent Collected (Cash)</option>
                                      <option value="invoiced">Rent Expected (Accrual)</option>
                                    </select>
                                  </div>

                                  <div>
                                    <label className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-500">Tenants Pay To</label>
                                    <select
                                      value={editFormData.tenantsPaysTo}
                                      onChange={(e) => handleEditChange('tenantsPaysTo', e.target.value)}
                                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                                    >
                                      <option value="propertyManager">Manager</option>
                                      <option value="landlord">Landlord</option>
                                    </select>
                                  </div>

                                  <div>
                                    <label className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-500">Deposits Held By</label>
                                    <select
                                      value={editFormData.depositHeldBy}
                                      onChange={(e) => handleEditChange('depositHeldBy', e.target.value)}
                                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                                    >
                                      <option value="propertyManager">Manager</option>
                                      <option value="landlord">Landlord</option>
                                    </select>
                                  </div>
                                </div>

                                <div className="mt-4 flex flex-wrap justify-end gap-2">
                                  <button
                                    onClick={() => {
                                      setEditingId(null);
                                      setEditFormData(null);
                                    }}
                                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-100"
                                  >
                                    <FaTimes /> Cancel
                                  </button>
                                  <button
                                    onClick={() => handleSaveEdit(property._id)}
                                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black text-white transition ${MILIK_GREEN_BG} ${MILIK_GREEN_HOVER}`}
                                  >
                                    <FaCheck /> Save Changes
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          <tr className={`border-t border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'} hover:bg-slate-50`}>
                            <td className="px-4 py-3 text-sm font-semibold text-slate-900">{property.propertyCode || '-'}</td>
                            <td className="px-4 py-3 text-sm text-slate-700">
                              <div className="font-semibold text-slate-900">{property.propertyName || property.name || '-'}</div>
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {property.commissionPercentage && property.commissionPercentage > 0 ? (
                                <span className="inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-black text-orange-700">
                                  {property.commissionPercentage}%
                                </span>
                              ) : (
                                <span className="text-slate-400">Not set</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-700">
                              {property.commissionRecognitionBasis
                                ? property.commissionRecognitionBasis === 'received'
                                  ? 'Rent Collected (Cash)'
                                  : 'Rent Expected (Accrual)'
                                : '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-700">
                              {property.tenantsPaysTo ? (property.tenantsPaysTo === 'propertyManager' ? 'Manager' : 'Landlord') : '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-700">
                              {property.depositHeldBy ? (property.depositHeldBy === 'propertyManager' ? 'Manager' : 'Landlord') : '-'}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex flex-wrap justify-end gap-2">
                                <button
                                  onClick={() => handleEdit(property)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 transition hover:bg-blue-100"
                                >
                                  <FaEdit /> Edit
                                </button>
                                <button
                                  onClick={() => handleDelete(property._id)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 transition hover:bg-rose-100"
                                >
                                  <FaTrash /> Remove
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className={`${MILIK_GREEN_BG} px-6 py-4 text-white`}>
              <h3 className="text-xl font-black">Add Commission Settings</h3>
              <p className="mt-1 text-sm text-emerald-100">Apply a commission structure to a property that is still unconfigured.</p>
            </div>

            <div className="grid gap-4 p-6 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-bold text-slate-700">Property</label>
                <select
                  value={addFormData.property || ''}
                  onChange={(e) => setAddFormData(prev => ({ ...prev, property: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                >
                  <option value="">-- Select Property --</option>
                  {unconfiguredProperties.map((prop) => (
                    <option key={prop._id} value={prop._id}>
                      {prop.propertyCode} - {prop.propertyName || prop.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-700">Commission (%)</label>
                <input
                  type="number"
                  value={addFormData.commissionPercentage}
                  onChange={(e) => setAddFormData(prev => ({ ...prev, commissionPercentage: parseFloat(e.target.value) || 0 }))}
                  min="0"
                  max="100"
                  step="0.01"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-700">Recognition Basis</label>
                <select
                  value={addFormData.commissionRecognitionBasis}
                  onChange={(e) => setAddFormData(prev => ({ ...prev, commissionRecognitionBasis: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                >
                  <option value="received">Rent Collected (Cash)</option>
                  <option value="invoiced">Rent Expected (Accrual)</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-700">Tenants Pay To</label>
                <select
                  value={addFormData.tenantsPaysTo}
                  onChange={(e) => setAddFormData(prev => ({ ...prev, tenantsPaysTo: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                >
                  <option value="propertyManager">Manager</option>
                  <option value="landlord">Landlord</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-700">Deposits Held By</label>
                <select
                  value={addFormData.depositHeldBy}
                  onChange={(e) => setAddFormData(prev => ({ ...prev, depositHeldBy: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/20"
                >
                  <option value="propertyManager">Manager</option>
                  <option value="landlord">Landlord</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button
                onClick={() => setShowAddModal(false)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleAddCommission}
                className={`rounded-xl px-4 py-2.5 text-sm font-black text-white transition ${MILIK_GREEN_BG} ${MILIK_GREEN_HOVER}`}
              >
                Add Commission
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );

};

export default CommissionsList;
