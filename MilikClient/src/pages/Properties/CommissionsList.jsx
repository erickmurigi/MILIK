import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { getProperties, updateProperty } from '../../redux/propertyRedux';
import { toast } from 'react-toastify';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { FaEdit, FaTrash, FaPlus, FaCheck, FaTimes, FaSearch, FaArrowLeft } from 'react-icons/fa';

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
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Commission Management</h1>
              <p className="text-gray-600 mt-1">View and manage property commission settings</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowAddModal(true)}
                className={`flex items-center gap-2 px-4 py-2 ${MILIK_GREEN_BG} ${MILIK_GREEN_HOVER} text-white rounded-lg font-semibold transition`}
              >
                <FaPlus /> Add Commission
              </button>
              <button
                onClick={() => navigate(-1)}
                className="flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition"
              >
                <FaArrowLeft /> Back
              </button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-600 mb-1">Total Properties</div>
              <div className="text-3xl font-bold text-gray-900">{stats.total}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-600 mb-1">Configured</div>
              <div className="text-3xl font-bold" style={{ color: MILIK_GREEN }}>{stats.configured}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-600 mb-1">Unconfigured</div>
              <div className="text-3xl font-bold" style={{ color: MILIK_ORANGE }}>{stats.unconfigured}</div>
            </div>
          </div>

          {/* Search & Filter */}
          <div className="bg-white rounded-lg shadow p-4 mb-6">
            <div className="flex gap-4 items-center">
              <div className="flex-1 relative">
                <FaSearch className="absolute left-3 top-3 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by code or name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
              <select
                value={filterMode}
                onChange={(e) => setFilterMode(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              >
                <option value="all">All Properties</option>
                <option value="configured">Configured Only</option>
                <option value="unconfigured">Unconfigured Only</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead style={{ backgroundColor: MILIK_GREEN }} className="text-white">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold">Code</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold">Property Name</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold">Commission %</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold">Recognition Basis</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold">Tenants Pay To</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold">Deposits Held By</th>
                    <th className="px-6 py-3 text-center text-sm font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProperties.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="px-6 py-8 text-center text-gray-500">
                        <FaSearch className="text-4xl text-gray-300 mx-auto mb-3" />
                        <p>No properties found</p>
                      </td>
                    </tr>
                  ) : (
                    filteredProperties.map((property) => (
                      <React.Fragment key={property._id}>
                        {editingId === property._id ? (
                          // Edit Mode Row
                          <tr className="border-t border-gray-200" style={{ backgroundColor: '#f0f8ff' }}>
                            <td colSpan="7" className="px-6 py-4">
                              <div className="grid grid-cols-2 gap-4 items-end">
                                {/* Commission % */}
                                <div>
                                  <label className="block text-xs font-semibold text-gray-700 mb-1">Commission %</label>
                                  <input
                                    type="number"
                                    value={editFormData.commissionPercentage}
                                    onChange={(e) => handleEditChange('commissionPercentage', e.target.value)}
                                    min="0"
                                    max="100"
                                    step="0.01"
                                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                  />
                                </div>

                                {/* Recognition Basis */}
                                <div>
                                  <label className="block text-xs font-semibold text-gray-700 mb-1">Recognition Basis</label>
                                  <select
                                    value={editFormData.commissionRecognitionBasis}
                                    onChange={(e) => handleEditChange('commissionRecognitionBasis', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                  >
                                    <option value="received">Rent Collected (Cash)</option>
                                    <option value="invoiced">Rent Expected (Accrual)</option>
                                  </select>
                                </div>

                                {/* Tenants Pay To */}
                                <div>
                                  <label className="block text-xs font-semibold text-gray-700 mb-1">Tenants Pay To</label>
                                  <select
                                    value={editFormData.tenantsPaysTo}
                                    onChange={(e) => handleEditChange('tenantsPaysTo', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                  >
                                    <option value="propertyManager">Manager</option>
                                    <option value="landlord">Landlord</option>
                                  </select>
                                </div>

                                {/* Deposits Held By */}
                                <div>
                                  <label className="block text-xs font-semibold text-gray-700 mb-1">Deposits Held By</label>
                                  <select
                                    value={editFormData.depositHeldBy}
                                    onChange={(e) => handleEditChange('depositHeldBy', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                  >
                                    <option value="propertyManager">Manager</option>
                                    <option value="landlord">Landlord</option>
                                  </select>
                                </div>

                                {/* Buttons */}
                                <div className="col-span-2 flex gap-2">
                                  <button
                                    onClick={() => handleSaveEdit(property._id)}
                                    className={`flex items-center gap-1 flex-1 px-3 py-2 ${MILIK_GREEN_BG} ${MILIK_GREEN_HOVER} text-white rounded text-sm font-semibold transition`}
                                  >
                                    <FaCheck /> Save
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingId(null);
                                      setEditFormData(null);
                                    }}
                                    className="flex items-center gap-1 flex-1 px-3 py-2 bg-gray-400 hover:bg-gray-500 text-white rounded text-sm font-semibold transition"
                                  >
                                    <FaTimes /> Cancel
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          // Display Mode Row
                          <tr className="border-t border-gray-200 hover:bg-gray-50">
                            <td className="px-6 py-4 text-sm font-semibold text-gray-900">{property.propertyCode || '-'}</td>
                            <td className="px-6 py-4 text-sm text-gray-700">{property.propertyName}</td>
                            <td className="px-6 py-4 text-sm">
                              {property.commissionPercentage && property.commissionPercentage > 0 ? (
                                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold" style={{ backgroundColor: `${MILIK_ORANGE}15`, color: MILIK_ORANGE }}>
                                  {property.commissionPercentage}%
                                </span>
                              ) : (
                                <span className="text-gray-400">Not set</span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-700">{property.commissionRecognitionBasis ? (property.commissionRecognitionBasis === 'received' ? 'Rent Collected (Cash)' : 'Rent Expected (Accrual)') : '-'}</td>
                            <td className="px-6 py-4 text-sm text-gray-700">{property.tenantsPaysTo ? (property.tenantsPaysTo === 'propertyManager' ? 'Manager' : 'Landlord') : '-'}</td>
                            <td className="px-6 py-4 text-sm text-gray-700">{property.depositHeldBy ? (property.depositHeldBy === 'propertyManager' ? 'Manager' : 'Landlord') : '-'}</td>
                            <td className="px-6 py-4 text-center">
                              <div className="flex gap-2 justify-center">
                                <button
                                  onClick={() => handleEdit(property)}
                                  className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm font-semibold transition flex items-center gap-1"
                                >
                                  <FaEdit /> Edit
                                </button>
                                <button
                                  onClick={() => handleDelete(property._id)}
                                  className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-sm font-semibold transition flex items-center gap-1"
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

      {/* Add Commission Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full">
            <div className={`${MILIK_GREEN_BG} text-white p-4 rounded-t-lg`}>
              <h3 className="text-lg font-bold">Add Commission Settings</h3>
            </div>

            <div className="p-6 space-y-4">
              {/* Select Property */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Property</label>
                <select
                  value={addFormData.property || ''}
                  onChange={(e) => setAddFormData(prev => ({ ...prev, property: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                >
                  <option value="">-- Select Property --</option>
                  {unconfiguredProperties.map((prop) => (
                    <option key={prop._id} value={prop._id}>
                      {prop.propertyCode} - {prop.propertyName}
                    </option>
                  ))}
                </select>
              </div>

              {/* Commission % */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Commission (%)</label>
                <input
                  type="number"
                  value={addFormData.commissionPercentage}
                  onChange={(e) => setAddFormData(prev => ({ ...prev, commissionPercentage: parseFloat(e.target.value) || 0 }))}
                  min="0"
                  max="100"
                  step="0.01"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>

              {/* Recognition Basis */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Recognition Basis</label>
                <select
                  value={addFormData.commissionRecognitionBasis}
                  onChange={(e) => setAddFormData(prev => ({ ...prev, commissionRecognitionBasis: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                >
                  <option value="received">Rent Collected (Cash)</option>
                  <option value="invoiced">Rent Expected (Accrual)</option>
                </select>
              </div>

              {/* Tenants Pay To */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Tenants Pay To</label>
                <select
                  value={addFormData.tenantsPaysTo}
                  onChange={(e) => setAddFormData(prev => ({ ...prev, tenantsPaysTo: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                >
                  <option value="propertyManager">Manager</option>
                  <option value="landlord">Landlord</option>
                </select>
              </div>

              {/* Deposits Held By */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Deposits Held By</label>
                <select
                  value={addFormData.depositHeldBy}
                  onChange={(e) => setAddFormData(prev => ({ ...prev, depositHeldBy: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                >
                  <option value="propertyManager">Manager</option>
                  <option value="landlord">Landlord</option>
                </select>
              </div>

              {/* Buttons */}
              <div className="flex gap-2 pt-4">
                <button
                  onClick={handleAddCommission}
                  className={`flex-1 px-4 py-2 ${MILIK_GREEN_BG} ${MILIK_GREEN_HOVER} text-white font-semibold rounded-lg transition`}
                >
                  Add Commission
                </button>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-700 font-semibold rounded-lg transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default CommissionsList;
