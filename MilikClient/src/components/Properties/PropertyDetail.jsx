// pages/PropertyDetail.js
import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import {
  FaArrowLeft, FaEdit, FaTrash, FaPhone, FaEnvelope,
  FaMapMarkerAlt, FaBuilding, FaHome, FaCity, FaCalendar,
  FaFileInvoice, FaChartLine, FaMoneyBillWave
} from 'react-icons/fa';
import { getPropertyById, deleteProperty } from '../../redux/propertyRedux';

const PropertyDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { currentProperty, loading } = useSelector((state) => state.property);

  useEffect(() => {
    dispatch(getPropertyById(id));
  }, [dispatch, id]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center items-center h-full">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600"></div>
        </div>
      </DashboardLayout>
    );
  }

  if (!currentProperty) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Property not found</h2>
          <button
            onClick={() => navigate('/properties')}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
          >
            Back to Properties
          </button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 w-full h-full overflow-y-auto bg-gray-50">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/properties')}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <FaArrowLeft />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-800">{currentProperty.propertyName}</h1>
              <p className="text-gray-600">Property Code: {currentProperty.propertyCode}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigate(`/properties/edit/${id}`)}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg flex items-center gap-2 hover:bg-emerald-700 transition-colors"
            >
              <FaEdit /> Edit
            </button>
          </div>
        </div>

        {/* Property Details Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Basic Information */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-4">Basic Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Property Type</label>
                  <p className="text-gray-900">{currentProperty.propertyType}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <p className="text-gray-900">{currentProperty.category}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">LR Number</label>
                  <p className="text-gray-900">{currentProperty.lrNumber}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date Acquired</label>
                  <p className="text-gray-900">
                    {new Date(currentProperty.dateAcquired).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Let/Manage</label>
                  <p className="text-gray-900">{currentProperty.letManage}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    currentProperty.status === 'active' ? 'bg-green-100 text-green-800' :
                    currentProperty.status === 'maintenance' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {currentProperty.status}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Unit Statistics */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-4">Unit Statistics</h2>
            <div className="space-y-4">
              <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                <span className="text-gray-700">Total Units</span>
                <span className="text-xl font-bold text-gray-900">{currentProperty.totalUnits}</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                <span className="text-gray-700">Occupied</span>
                <span className="text-xl font-bold text-green-600">{currentProperty.occupiedUnits}</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                <span className="text-gray-700">Vacant</span>
                <span className="text-xl font-bold text-blue-600">{currentProperty.vacantUnits}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Location Information */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <FaMapMarkerAlt /> Location Information
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
              <p className="text-gray-900">{currentProperty.country}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Town/City</label>
              <p className="text-gray-900">{currentProperty.townCityState}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Estate/Area</label>
              <p className="text-gray-900">{currentProperty.estateArea}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Road/Street</label>
              <p className="text-gray-900">{currentProperty.roadStreet}</p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Zone/Region</label>
              <p className="text-gray-900">{currentProperty.zoneRegion}</p>
            </div>
          </div>
        </div>

        {/* Landlords */}
        {currentProperty.landlords && currentProperty.landlords.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-800">Landlords</h2>
              <button
                onClick={() => navigate(`/landlord/statements?propertyId=${id}`)}
                className="text-sm text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-2"
              >
                <FaFileInvoice /> View Statements
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {currentProperty.landlords.map((landlord, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-medium text-gray-900">{landlord.name}</h3>
                    {landlord.isPrimary && (
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                        Primary
                      </span>
                    )}
                  </div>
                  {landlord.contact && (
                    <p className="text-sm text-gray-600 flex items-center gap-2">
                      <FaPhone /> {landlord.contact}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Financial Overview Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <FaChartLine className="text-emerald-600" />
            Financial Overview
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="bg-emerald-50 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <div className="bg-emerald-600 p-3 rounded-lg">
                  <FaMoneyBillWave className="text-white text-xl" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Expected Rent</p>
                  <p className="text-xl font-bold text-gray-900">
                    {currentProperty.currency || 'KES'} {Number(currentProperty.expectedRent || 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <div className="bg-blue-600 p-3 rounded-lg">
                  <FaFileInvoice className="text-white text-xl" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Occupancy Rate</p>
                  <p className="text-xl font-bold text-gray-900">
                    {currentProperty.totalUnits > 0 
                      ? Math.round((currentProperty.occupiedUnits / currentProperty.totalUnits) * 100)
                      : 0}%
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-purple-50 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <div className="bg-purple-600 p-3 rounded-lg">
                  <FaBuilding className="text-white text-xl" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Total Units</p>
                  <p className="text-xl font-bold text-gray-900">
                    {currentProperty.totalUnits}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => navigate(`/landlord/statements?propertyId=${id}`)}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg flex items-center gap-2 hover:bg-emerald-700 transition-colors"
            >
              <FaFileInvoice /> Generate Statement
            </button>
            <button
              onClick={() => navigate(`/reports/rental-collection?propertyId=${id}`)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center gap-2 hover:bg-blue-700 transition-colors"
            >
              <FaChartLine /> View Reports
            </button>
            <button
              onClick={() => navigate(`/receipts?propertyId=${id}`)}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg flex items-center gap-2 hover:bg-purple-700 transition-colors"
            >
              <FaMoneyBillWave /> View Payments
            </button>
          </div>
        </div>

        {/* Notes */}
        {currentProperty.notes && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-4">Notes</h2>
            <p className="text-gray-700 whitespace-pre-line">{currentProperty.notes}</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default PropertyDetail;