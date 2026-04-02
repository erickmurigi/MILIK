// pages/Vacants.js
import React, { useState } from 'react';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { 
  FaDoorOpen, FaPlus, FaFilter, FaDownload, FaSearch, FaEdit, FaTrash, FaEye,
  FaHome, FaBuilding, FaCalendarAlt, FaMoneyBillWave, FaUserPlus, FaChartLine
} from 'react-icons/fa';
import { Link } from 'react-router-dom';

const Vacants = () => {
  const [searchTerm, setSearchTerm] = useState('');

  // Sample vacant units data
  const vacantUnits = [
    {
      id: 1,
      unitNumber: 'A102',
      property: 'Milik Towers',
      type: '1-Bedroom',
      size: '650 sq ft',
      rent: 'KSh 32,000',
      deposit: 'KSh 64,000',
      vacantSince: '2024-01-15',
      daysVacant: 20,
      lastTenant: 'John Doe',
      reason: 'End of lease',
      amenities: ['Parking', 'Balcony'],
      marketValue: 'KSh 32,000 - 35,000',
      showingRequests: 5
    },
    {
      id: 2,
      unitNumber: 'C301',
      property: 'Garden Villas',
      type: '3-Bedroom',
      size: '1200 sq ft',
      rent: 'KSh 85,000',
      deposit: 'KSh 170,000',
      vacantSince: '2024-01-05',
      daysVacant: 30,
      lastTenant: 'Mary Johnson',
      reason: 'Relocation',
      amenities: ['Parking', 'Garden', 'Pool', 'Security'],
      marketValue: 'KSh 85,000 - 90,000',
      showingRequests: 8
    },
    {
      id: 3,
      unitNumber: 'B305',
      property: 'Westgate Apartments',
      type: 'Studio',
      size: '450 sq ft',
      rent: 'KSh 25,000',
      deposit: 'KSh 50,000',
      vacantSince: '2023-12-20',
      daysVacant: 46,
      lastTenant: 'Peter Smith',
      reason: 'Job transfer',
      amenities: ['Parking'],
      marketValue: 'KSh 25,000 - 28,000',
      showingRequests: 3
    },
    {
      id: 4,
      unitNumber: 'D204',
      property: 'CBD Business Center',
      type: 'Office',
      size: '600 sq ft',
      rent: 'KSh 45,000',
      deposit: 'KSh 90,000',
      vacantSince: '2024-01-10',
      daysVacant: 25,
      lastTenant: 'Startup Tech Ltd',
      reason: 'Business closure',
      amenities: ['Parking', 'WiFi', 'Meeting Room'],
      marketValue: 'KSh 45,000 - 50,000',
      showingRequests: 12
    },
    {
      id: 5,
      unitNumber: 'F102',
      property: 'Riverside Suites',
      type: '2-Bedroom',
      size: '900 sq ft',
      rent: 'KSh 75,000',
      deposit: 'KSh 150,000',
      vacantSince: '2024-01-20',
      daysVacant: 15,
      lastTenant: 'Sarah Williams',
      reason: 'Purchase own home',
      amenities: ['Parking', 'Pool', 'Gym', 'Concierge'],
      marketValue: 'KSh 75,000 - 80,000',
      showingRequests: 7
    },
    {
      id: 6,
      unitNumber: 'E305',
      property: 'Milik Towers',
      type: '2-Bedroom',
      size: '850 sq ft',
      rent: 'KSh 45,000',
      deposit: 'KSh 90,000',
      vacantSince: '2024-01-25',
      daysVacant: 10,
      lastTenant: 'Robert Brown',
      reason: 'End of lease',
      amenities: ['Parking', 'Balcony', 'Security'],
      marketValue: 'KSh 45,000 - 48,000',
      showingRequests: 6
    }
  ];

  const getVacancyColor = (days) => {
    if (days < 15) return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    if (days < 30) return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200';
    return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
  };

  const calculateVacancyRate = () => {
    const totalUnits = 75;
    const vacantUnitsCount = vacantUnits.length;
    return ((vacantUnitsCount / totalUnits) * 100).toFixed(1);
  };

  const calculateAverageVacancyDays = () => {
    const totalDays = vacantUnits.reduce((sum, unit) => sum + unit.daysVacant, 0);
    return Math.round(totalDays / vacantUnits.length);
  };

  return (
    <DashboardLayout>
      <div className="p-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold dark:text-white">Vacant Units Management</h1>
            <p className="text-gray-600 dark:text-gray-400">Manage and track all vacant rental units</p>
          </div>
          <div className="flex space-x-3 mt-4 md:mt-0">
            <button className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg flex items-center space-x-2">
              <FaFilter />
              <span>Filter</span>
            </button>
            <button className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg flex items-center space-x-2">
              <FaDownload />
              <span>Export</span>
            </button>
            <button className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg flex items-center space-x-2 hover:shadow-lg">
              <FaChartLine />
              <span>Vacancy Report</span>
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl p-5 text-white shadow-lg">
            <div className="flex items-start justify-between mb-4">
              <div className="p-2.5 bg-white/20 rounded-xl">
                <FaDoorOpen />
              </div>
              <span className="text-xs font-medium bg-white/20 px-2 py-1 rounded-full">-2.3%</span>
            </div>
            <h3 className="text-2xl font-bold mb-1">{vacantUnits.length}</h3>
            <p className="text-white/90 text-sm">Vacant Units</p>
          </div>
          
          <div className="bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl p-5 text-white shadow-lg">
            <div className="flex items-start justify-between mb-4">
              <div className="p-2.5 bg-white/20 rounded-xl">
                <FaChartLine />
              </div>
              <span className="text-xs font-medium bg-white/20 px-2 py-1 rounded-full">+1.2%</span>
            </div>
            <h3 className="text-2xl font-bold mb-1">{calculateVacancyRate()}%</h3>
            <p className="text-white/90 text-sm">Vacancy Rate</p>
          </div>
          
          <div className="bg-gradient-to-br from-emerald-500 to-green-500 rounded-xl p-5 text-white shadow-lg">
            <div className="flex items-start justify-between mb-4">
              <div className="p-2.5 bg-white/20 rounded-xl">
                <FaCalendarAlt />
              </div>
              <span className="text-xs font-medium bg-white/20 px-2 py-1 rounded-full">-5 days</span>
            </div>
            <h3 className="text-2xl font-bold mb-1">{calculateAverageVacancyDays()}</h3>
            <p className="text-white/90 text-sm">Avg. Vacancy Days</p>
          </div>
          
          <div className="bg-gradient-to-br from-orange-500 to-red-500 rounded-xl p-5 text-white shadow-lg">
            <div className="flex items-start justify-between mb-4">
              <div className="p-2.5 bg-white/20 rounded-xl">
                <FaMoneyBillWave />
              </div>
              <span className="text-xs font-medium bg-white/20 px-2 py-1 rounded-full">KSh 297K</span>
            </div>
            <h3 className="text-2xl font-bold mb-1">KSh 297K</h3>
            <p className="text-white/90 text-sm">Monthly Loss</p>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-gradient-to-r from-emerald-500 to-green-500 rounded-xl p-4 mb-6 text-white">
          <div className="flex flex-col md:flex-row md:items-center justify-between">
            <div>
              <h3 className="font-bold">Quick Tenant Placement</h3>
              <p className="text-sm text-white/80">Fill vacant units quickly with these actions</p>
            </div>
            <div className="flex space-x-3 mt-4 md:mt-0">
              <Link to="/tenants/add">
                <button className="px-4 py-2 bg-white text-emerald-600 rounded-lg font-semibold hover:bg-white/90">
                  <FaUserPlus className="inline mr-2" />
                  Add New Tenant
                </button>
              </Link>
              <button className="px-4 py-2 bg-white/20 rounded-lg font-semibold hover:bg-white/30">
                Market Units
              </button>
              <button className="px-4 py-2 bg-white/20 rounded-lg font-semibold hover:bg-white/30">
                Schedule Showings
              </button>
            </div>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 mb-6 shadow">
          <div className="flex flex-col md:flex-row md:items-center justify-between space-y-4 md:space-y-0">
            <div className="relative flex-1">
              <FaSearch className="absolute left-3 top-3 text-gray-400" />
              <input
                type="text"
                placeholder="Search vacant units by number, property, or type..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-transparent dark:text-white"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="flex space-x-3">
              <select className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-transparent dark:text-white">
                <option>All Properties</option>
                <option>Milik Towers</option>
                <option>Westgate Apartments</option>
                <option>Garden Villas</option>
              </select>
              <select className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-transparent dark:text-white">
                <option>All Unit Types</option>
                <option>1-Bedroom</option>
                <option>2-Bedroom</option>
                <option>3-Bedroom</option>
                <option>Studio</option>
                <option>Office</option>
              </select>
              <select className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-transparent dark:text-white">
                <option>Sort by: Vacancy Days</option>
                <option>Sort by: Rent Amount</option>
                <option>Sort by: Showing Requests</option>
              </select>
            </div>
          </div>
        </div>

        {/* Vacant Units Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {vacantUnits.map((unit) => (
            <div key={unit.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden hover:shadow-xl transition-shadow duration-300 border border-blue-200 dark:border-blue-800">
              {/* Unit Header */}
              <div className="bg-gradient-to-r from-blue-500 to-cyan-500 p-4 text-white">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-xl font-bold">Unit {unit.unitNumber}</h3>
                    <p className="text-white/80 text-sm">{unit.property}</p>
                  </div>
                  <span className={`px-3 py-1 text-xs font-semibold rounded-full ${getVacancyColor(unit.daysVacant)}`}>
                    {unit.daysVacant} days vacant
                  </span>
                </div>
              </div>

              {/* Unit Details */}
              <div className="p-6">
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Type</p>
                    <p className="font-medium dark:text-white">{unit.type}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Size</p>
                    <p className="font-medium dark:text-white">{unit.size}</p>
                  </div>
                </div>

                <div className="mb-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Monthly Rent</p>
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{unit.rent}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Deposit: {unit.deposit}</p>
                </div>

                <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <div className="text-sm">
                    <div className="flex justify-between mb-2">
                      <span className="text-gray-600 dark:text-gray-400">Vacant Since:</span>
                      <span className="font-medium dark:text-white">{unit.vacantSince}</span>
                    </div>
                    <div className="flex justify-between mb-2">
                      <span className="text-gray-600 dark:text-gray-400">Last Tenant:</span>
                      <span className="font-medium dark:text-white">{unit.lastTenant}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Reason:</span>
                      <span className="font-medium dark:text-white">{unit.reason}</span>
                    </div>
                  </div>
                </div>

                {/* Market Info */}
                <div className="mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Market Value:</span>
                    <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{unit.marketValue}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Showing Requests:</span>
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                      unit.showingRequests > 5 
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                    }`}>
                      {unit.showingRequests} requests
                    </span>
                  </div>
                </div>

                {/* Amenities */}
                <div className="mb-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Amenities</p>
                  <div className="flex flex-wrap gap-2">
                    {unit.amenities.map((amenity, index) => (
                      <span key={index} className="px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded">
                        {amenity}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex space-x-2">
                  <Link to={`/units/${unit.id}`} className="flex-1">
                    <button className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 rounded-lg text-sm">
                      View Details
                    </button>
                  </Link>
                  <Link to={`/tenants/add?unit=${unit.id}`} className="flex-1">
                    <button className="w-full px-3 py-2 bg-gradient-to-r from-emerald-500 to-green-500 text-white rounded-lg text-sm hover:shadow-lg">
                      Add Tenant
                    </button>
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Vacancy Analysis */}
        <div className="mt-8 bg-white dark:bg-gray-800 rounded-xl p-6 shadow">
          <h3 className="font-bold dark:text-white mb-4">Vacancy Analysis</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-3">Vacancy by Property</h4>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-sm">Milik Towers</span>
                    <span className="text-sm font-semibold">2 units (33%)</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full" style={{ width: '33%' }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-sm">Westgate Apartments</span>
                    <span className="text-sm font-semibold">1 unit (17%)</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div className="bg-purple-500 h-2 rounded-full" style={{ width: '17%' }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-sm">Garden Villas</span>
                    <span className="text-sm font-semibold">1 unit (17%)</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div className="bg-emerald-500 h-2 rounded-full" style={{ width: '17%' }}></div>
                  </div>
                </div>
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-3">Vacancy by Unit Type</h4>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-sm">2-Bedroom</span>
                    <span className="text-sm font-semibold">2 units (33%)</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div className="bg-amber-500 h-2 rounded-full" style={{ width: '33%' }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-sm">1-Bedroom</span>
                    <span className="text-sm font-semibold">1 unit (17%)</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div className="bg-pink-500 h-2 rounded-full" style={{ width: '17%' }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-sm">Office</span>
                    <span className="text-sm font-semibold">1 unit (17%)</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div className="bg-cyan-500 h-2 rounded-full" style={{ width: '17%' }}></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Vacants;