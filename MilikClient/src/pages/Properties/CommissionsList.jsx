import React, { useState, useEffect, useMemo } from 'react';
import { useTabState } from '../../hooks/useTabState';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { getProperties, updateProperty } from '../../redux/propertyRedux';
import { selectCurrentCompany, selectCurrentUser, selectAllProperties } from '../../redux/selectors';
import { hasCompanyPermission } from '../../utils/permissions';
import { toast } from 'react-toastify';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { FaEdit, FaTrash, FaPlus, FaCheck, FaTimes, FaSearch, FaArrowLeft, FaRedoAlt } from 'react-icons/fa';
import { useConfirm } from '../../context/ConfirmContext';
import AppSelect from '../../components/common/AppSelect';
import PaginationBar from '../../components/PaginationBar';
import MilikTable from '../../components/common/MilikTable';
import ListToolbar from '../../components/common/ListToolbar';

const MILIK_GREEN = "#0B3B2E";
const MILIK_GREEN_BG = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "#FF8C00";

const CommissionsList = () => {
  const confirm = useConfirm();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const currentUser = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
  const properties = useSelector(selectAllProperties);

  const canWrite = hasCompanyPermission(currentUser || {}, currentCompany, "commissions", "create", "propertyManagement");

  const [searchTerm, setSearchTerm] = useTabState('/properties/commissions-list:searchTerm', '');
  const [filterMode, setFilterMode] = useTabState('/properties/commissions-list:filterMode', 'all');
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useTabState('/properties/commissions-list:currentPage', 1);
  const [pageSize, setPageSize] = useState(50);
  const [expandedPropertyId, setExpandedPropertyId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editFormData, setEditFormData] = useState(null);

  // Fetch properties on mount
  useEffect(() => {
    const businessId = currentCompany?._id || currentUser?.company?._id || currentUser?.company;
    if (businessId) {
      setLoading(true);
      dispatch(getProperties({ business: businessId, limit: 500 }))
        .finally(() => setLoading(false));
    }
  }, [currentCompany?._id, currentUser?.company, dispatch]);

  const filteredProperties = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return (properties || []).filter(prop => {
      const matchesSearch =
        (prop.propertyCode?.toLowerCase() || '').includes(q) ||
        (prop.propertyName?.toLowerCase() || '').includes(q);
      const hasCommission = Number(prop.commissionPercentage) > 0;
      if (filterMode === 'configured') return matchesSearch && hasCommission;
      if (filterMode === 'unconfigured') return matchesSearch && !hasCommission;
      return matchesSearch;
    });
  }, [properties, searchTerm, filterMode]);

  const totalPages = Math.max(1, Math.ceil(filteredProperties.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedProperties = useMemo(
    () => filteredProperties.slice(startIndex, endIndex),
    [filteredProperties, startIndex, endIndex]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterMode]);

  useEffect(() => {
    if (currentPage !== safeCurrentPage) setCurrentPage(safeCurrentPage);
  }, [currentPage, safeCurrentPage]);

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
    if (!await confirm({ title: "Remove Commission Settings", message: "Remove commission settings for this property?", confirmText: "Remove", isDangerous: true })) return;

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



  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-2">
        <div className="mx-auto flex w-full max-w-full min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <ListToolbar>
              <span className="shrink-0 border border-slate-200 bg-white px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-slate-500">Visible <span className="normal-case text-slate-900">{filteredProperties.length}</span></span>
              <ListToolbar.Divider />
              <ListToolbar.Input type="text" placeholder="Search by property code or name" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} width="w-32" />
              <AppSelect
                value={filterMode || null}
                onChange={(v) => setFilterMode(v ?? '')}
                options={[
                  { value: 'all', label: 'All Properties' },
                  { value: 'configured', label: 'Configured Only' },
                  { value: 'unconfigured', label: 'Unconfigured Only' },
                ]}
                clearable
                compact
              />
              <ListToolbar.Button icon={FaRedoAlt} variant="outline" onClick={resetFilters}>Reset</ListToolbar.Button>
              <ListToolbar.Divider />
              {canWrite && <ListToolbar.Button icon={FaPlus} onClick={() => navigate('/properties/commission-settings')}>Add commission</ListToolbar.Button>}
              <ListToolbar.Button icon={FaArrowLeft} variant="outline" onClick={() => navigate(-1)}>Back</ListToolbar.Button>
            </ListToolbar>

            <MilikTable
              columns={[
                { label: "Code" },
                { label: "Property" },
                { label: "Commission" },
                { label: "Recognition Basis" },
                { label: "Tenants Pay To" },
                { label: "Deposits Held By" },
              ]}
              rows={paginatedProperties}
              rowKey="_id"
              loading={false}
              empty="No commission rows matched the current filters."
              minWidth="980px"
              renderRow={(property) => {
                if (editingId === property._id) {
                  return (
                    <td colSpan={6} className="px-4 py-4">
                      <div className="border border-slate-200 bg-white px-2 py-1">
                        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-[10px] font-black text-slate-900">
                              {property.propertyCode || '—'} • {property.propertyName || property.name || 'Property'}
                            </p>
                            <p className="text-xs text-slate-500">Edit commission and collection settings for this property.</p>
                          </div>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                          <div>
                            <label className="mb-1 block text-xs font-bold text-slate-900">Commission %</label>
                            <input
                              type="number"
                              value={editFormData.commissionPercentage}
                              onChange={(e) => handleEditChange('commissionPercentage', e.target.value)}
                              min="0"
                              max="100"
                              step="0.01"
                              className="h-7 w-full border border-slate-300 px-2 text-sm focus:border-[#0B3B2E] focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-bold text-slate-900">Recognition Basis</label>
                            <AppSelect
                              value={editFormData.commissionRecognitionBasis || null}
                              onChange={(v) => handleEditChange('commissionRecognitionBasis', v ?? '')}
                              options={[
                                { value: 'received', label: 'Rent Collected (Cash)' },
                                { value: 'invoiced', label: 'Rent Expected (Accrual)' },
                              ]}
                              size="sm"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-bold text-slate-900">Tenants Pay To</label>
                            <AppSelect
                              value={editFormData.tenantsPaysTo || null}
                              onChange={(v) => handleEditChange('tenantsPaysTo', v ?? '')}
                              options={[
                                { value: 'propertyManager', label: 'Manager' },
                                { value: 'landlord', label: 'Landlord' },
                              ]}
                              size="sm"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-bold text-slate-900">Deposits Held By</label>
                            <AppSelect
                              value={editFormData.depositHeldBy || null}
                              onChange={(v) => handleEditChange('depositHeldBy', v ?? '')}
                              options={[
                                { value: 'propertyManager', label: 'Manager' },
                                { value: 'landlord', label: 'Landlord' },
                              ]}
                              size="sm"
                            />
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap justify-end gap-2">
                          <button
                            onClick={() => { setEditingId(null); setEditFormData(null); }}
                            className="inline-flex h-7 items-center gap-1 border border-slate-300 bg-white px-3 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50"
                          >
                            <FaTimes /> Cancel
                          </button>
                          <button
                            onClick={() => handleSaveEdit(property._id)}
                            className={`inline-flex h-7 items-center gap-1 px-3 text-[11px] font-bold text-white transition ${MILIK_GREEN_BG} ${MILIK_GREEN_HOVER}`}
                          >
                            <FaCheck /> Save Changes
                          </button>
                        </div>
                      </div>
                    </td>
                  );
                }
                return (
                  <>
                    <td className="px-2 py-1 border-r border-gray-100 font-semibold text-slate-900">{property.propertyCode || '-'}</td>
                    <td className="px-2 py-1 border-r border-gray-100 text-slate-700">
                      <div className="font-semibold text-slate-900">{property.propertyName || property.name || '-'}</div>
                    </td>
                    <td className="px-2 py-1 border-r border-gray-100">
                      {Number(property.commissionPercentage) > 0 ? (
                        <span className="inline-flex items-center text-xs font-semibold text-slate-900">
                          {property.commissionPercentage}%
                        </span>
                      ) : (
                        <span className="text-slate-400">Not set</span>
                      )}
                    </td>
                    <td className="px-2 py-1 border-r border-gray-100 text-slate-700">
                      {property.commissionRecognitionBasis
                        ? property.commissionRecognitionBasis === 'received'
                          ? 'Rent Collected (Cash)'
                          : 'Rent Expected (Accrual)'
                        : '-'}
                    </td>
                    <td className="px-2 py-1 border-r border-gray-100 text-slate-700">
                      {property.tenantsPaysTo ? (property.tenantsPaysTo === 'propertyManager' ? 'Manager' : 'Landlord') : '-'}
                    </td>
                    <td className="px-2 py-1 border-r border-gray-100 text-slate-700">
                      {property.depositHeldBy ? (property.depositHeldBy === 'propertyManager' ? 'Manager' : 'Landlord') : '-'}
                    </td>
                  </>
                );
              }}
              renderActions={(property) => {
                if (editingId === property._id) return null;
                return (
                  <div className="inline-flex flex-wrap justify-end gap-2">
                    {canWrite && (
                      <button
                        onClick={(event) => { event.stopPropagation(); handleEdit(property); }}
                        className="inline-flex items-center gap-1 border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-bold text-slate-800 transition hover:bg-slate-50"
                      >
                        <FaEdit /> Edit
                      </button>
                    )}
                    {canWrite && (
                      <button
                        onClick={(event) => { event.stopPropagation(); handleDelete(property._id); }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold text-red-700 transition hover:underline"
                      >
                        <FaTrash /> Remove
                      </button>
                    )}
                  </div>
                );
              }}
              renderExpanded={(property) => {
                if (editingId === property._id) return null;
                return (
                  <div className="grid gap-2 text-[10px] md:grid-cols-4">
                    <div><span className="font-black uppercase tracking-[0.12em] text-slate-500">Property</span><p className="font-semibold text-slate-900">{property.propertyName || property.name || '-'}</p></div>
                    <div><span className="font-black uppercase tracking-[0.12em] text-slate-500">Commission</span><p className="font-semibold text-slate-900">{property.commissionPercentage ? `${property.commissionPercentage}%` : 'Not set'}</p></div>
                    <div><span className="font-black uppercase tracking-[0.12em] text-slate-500">Recognition</span><p className="font-semibold text-slate-900">{property.commissionRecognitionBasis === 'received' ? 'Rent Collected (Cash)' : property.commissionRecognitionBasis === 'invoiced' ? 'Rent Expected (Accrual)' : '-'}</p></div>
                    <div><span className="font-black uppercase tracking-[0.12em] text-slate-500">Collections / Deposits</span><p className="font-semibold text-slate-900">Tenants pay {property.tenantsPaysTo === 'landlord' ? 'Landlord' : 'Manager'} · Deposits held by {property.depositHeldBy === 'landlord' ? 'Landlord' : 'Manager'}</p></div>
                  </div>
                );
              }}
            />
            <PaginationBar
              page={safeCurrentPage}
              pages={totalPages}
              total={filteredProperties.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(n) => { setPageSize(n); setCurrentPage(1); }}
              loading={false}
              label="properties"
            />
          </div>
        </div>
      </div>

    </DashboardLayout>
  );

};

export default CommissionsList;
