// pages/Inspections.js
import React, { useState } from 'react';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { 
  FaClipboardCheck, FaPlus, FaFilter, FaDownload, FaSearch, FaEdit, FaTrash, FaEye,
  FaHome, FaUser, FaCalendarAlt, FaCheckCircle, FaExclamationTriangle, FaCalendarPlus
} from 'react-icons/fa';
import { Link } from 'react-router-dom';

const Inspections = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState('all');

  // Sample inspections data
  const inspections = [
    {
      id: 1,
      inspectionNumber: 'INSP-2024-001',
      property: 'Milik Towers',
      unit: 'A101',
      type: 'Routine',
      inspector: 'John Doe',
      scheduledDate: '2024-01-15',
      completedDate: '2024-01-15',
      status: 'completed',
      score: 92,
      issuesFound: 2,
      recommendations: 'Minor paint touch-up needed',
      nextInspection: '2024-04-15',
      tenantPresent: true,
      photos: 8
    },
    {
      id: 2,
      inspectionNumber: 'INSP-2024-002',
      property: 'Westgate Apartments',
      unit: 'B201',
      type: 'Move-in',
      inspector: 'Jane Smith',
      scheduledDate: '2024-01-20',
      completedDate: null,
      status: 'scheduled',
      score: null,
      issuesFound: null,
      recommendations: null,
      nextInspection: null,
      tenantPresent: false,
      photos: 0
    },
    {
      id: 3,
      inspectionNumber: 'INSP-2024-003',
      property: 'Garden Villas',
      unit: 'C301',
      type: 'Move-out',
      inspector: 'Robert Johnson',
      scheduledDate: '2024-01-18',
      completedDate: '2024-01-18',
      status: 'completed',
      score: 85,
      issuesFound: 5,
      recommendations: 'Deduct KSh 15,000 from security deposit',
      nextInspection: 'N/A',
      tenantPresent: true,
      photos: 12
    },
    {
      id: 4,
      inspectionNumber: 'INSP-2024-004',
      property: 'CBD Business Center',
      unit: 'D101',
      type: 'Safety',
      inspector: 'Security Team',
      scheduledDate: '2024-01-25',
      completedDate: null,
      status: 'scheduled',
      score: null,
      issuesFound: null,
      recommendations: null,
      nextInspection: null,
      tenantPresent: false,
      photos: 0
    },
    {
      id: 5,
      inspectionNumber: 'INSP-2024-005',
      property: 'Riverside Suites',
      unit: 'E201',
      type: 'Routine',
      inspector: 'John Doe',
      scheduledDate: '2024-01-22',
      completedDate: null,
      status: 'scheduled',
      score: null,
      issuesFound: null,
      recommendations: null,
      nextInspection: null,
      tenantPresent: true,
      photos: 0
    },
    {
      id: 6,
      inspectionNumber: 'INSP-2024-006',
      property: 'Milik Towers',
      unit: 'F102',
      type: 'Emergency',
      inspector: 'Maintenance Team',
      scheduledDate: '2024-01-19',
      completedDate: '2024-01-19',
      status: 'completed',
      score: 70,
      issuesFound: 8,
      recommendations: 'Immediate plumbing repairs needed',
      nextInspection: '2024-02-19',
      tenantPresent: true,
      photos: 15
    },
    {
      id: 7,
      inspectionNumber: 'INSP-2024-007',
      property: 'Westgate Apartments',
      unit: 'Common Areas',
      type: 'Routine',
      inspector: 'Jane Smith',
      scheduledDate: '2024-01-10',
      completedDate: '2024-01-10',
      status: 'completed',
      score: 95,
      issuesFound: 1,
      recommendations: 'Replace hallway light bulbs',
      nextInspection: '2024-04-10',
      tenantPresent: false,
      photos: 6
    },
    {
      id: 8,
      inspectionNumber: 'INSP-2024-008',
      property: 'Garden Villas',
      unit: 'Pool Area',
      type: 'Safety',
      inspector: 'Robert Johnson',
      scheduledDate: '2024-01-28',
      completedDate: null,
      status: 'scheduled',
      score: null,
      issuesFound: null,
      recommendations: null,
      nextInspection: null,
      tenantPresent: false,
      photos: 0
    }
  ];

  const statusColors = {
    scheduled: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    'in-progress': 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
  };

  const typeColors = {
    routine: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
    'move-in': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    'move-out': 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    safety: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    emergency: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
  };

  const getScoreColor = (score) => {
    if (!score) return 'bg-gray-100 text-gray-800';
    if (score >= 90) return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    if (score >= 70) return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200';
    return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
  };

  const filteredInspections = filter === 'all' 
    ? inspections 
    : inspections.filter(insp => insp.status === filter);

  const calculateStats = () => {
    const total = inspections.length;
    const scheduled = inspections.filter(insp => insp.status === 'scheduled').length;
    const completed = inspections.filter(insp => insp.status === 'completed').length;
    const avgScore = inspections
      .filter(insp => insp.score)
      .reduce((sum, insp) => sum + insp.score, 0) / completed || 0;
    
    return { total, scheduled, completed, avgScore: avgScore.toFixed(1) };
  };

  const stats = calculateStats();

  return (
    <DashboardLayout>
      <div className="p-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold dark:text-white">Property Inspections</h1>
            <p className="text-gray-600 dark:text-gray-400">Schedule and manage property inspections</p>
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
            <Link to="/inspections/create">
              <button className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-green-500 text-white rounded-lg flex items-center space-x-2 hover:shadow-lg">
                <FaPlus />
                <span>Schedule Inspection</span>
              </button>
            </Link>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl p-5 text-white shadow-lg">
            <div className="flex items-start justify-between mb-4">
              <div className="p-2.5 bg-white/20 rounded-xl">
                <FaClipboardCheck />
              </div>
              <span className="text-xs font-medium bg-white/20 px-2 py-1 rounded-full">+{stats.scheduled} scheduled</span>
            </div>
            <h3 className="text-2xl font-bold mb-1">{stats.total}</h3>
            <p className="text-white/90 text-sm">Total Inspections</p>
          </div>
          
          <div className="bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl p-5 text-white shadow-lg">
            <div className="flex items-start justify-between mb-4">
              <div className="p-2.5 bg-white/20 rounded-xl">
                <FaCalendarAlt />
              </div>
              <span className="text-xs font-medium bg-white/20 px-2 py-1 rounded-full">{stats.scheduled}</span>
            </div>
            <h3 className="text-2xl font-bold mb-1">{stats.scheduled}</h3>
            <p className="text-white/90 text-sm">Scheduled</p>
          </div>
          
          <div className="bg-gradient-to-br from-emerald-500 to-green-500 rounded-xl p-5 text-white shadow-lg">
            <div className="flex items-start justify-between mb-4">
              <div className="p-2.5 bg-white/20 rounded-xl">
                <FaCheckCircle />
              </div>
              <span className="text-xs font-medium bg-white/20 px-2 py-1 rounded-full">{stats.completed}</span>
            </div>
            <h3 className="text-2xl font-bold mb-1">{stats.completed}</h3>
            <p className="text-white/90 text-sm">Completed</p>
          </div>
          
          <div className="bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl p-5 text-white shadow-lg">
            <div className="flex items-start justify-between mb-4">
              <div className="p-2.5 bg-white/20 rounded-xl">
                <FaClipboardCheck />
              </div>
              <span className="text-xs font-medium bg-white/20 px-2 py-1 rounded-full">{stats.avgScore}</span>
            </div>
            <h3 className="text-2xl font-bold mb-1">{stats.avgScore}</h3>
            <p className="text-white/90 text-sm">Avg. Score</p>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-1 mb-6 shadow">
          <div className="flex space-x-1">
            <button 
              onClick={() => setFilter('all')}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === 'all' 
                  ? 'bg-emerald-500 text-white' 
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              All Inspections
            </button>
            <button 
              onClick={() => setFilter('scheduled')}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === 'scheduled' 
                  ? 'bg-blue-500 text-white' 
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              Scheduled
            </button>
            <button 
              onClick={() => setFilter('completed')}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === 'completed' 
                  ? 'bg-green-500 text-white' 
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              Completed
            </button>
            <button 
              onClick={() => setFilter('cancelled')}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === 'cancelled' 
                  ? 'bg-red-500 text-white' 
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              Cancelled
            </button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 mb-6 shadow">
          <div className="flex flex-col md:flex-row md:items-center justify-between space-y-4 md:space-y-0">
            <div className="relative flex-1">
              <FaSearch className="absolute left-3 top-3 text-gray-400" />
              <input
                type="text"
                placeholder="Search inspections by number, property, or inspector..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-transparent dark:text-white"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="flex space-x-3">
              <select className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-transparent dark:text-white">
                <option>All Types</option>
                <option>Routine</option>
                <option>Move-in</option>
                <option>Move-out</option>
                <option>Safety</option>
                <option>Emergency</option>
              </select>
              <select className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-transparent dark:text-white">
                <option>All Properties</option>
                <option>Milik Towers</option>
                <option>Westgate Apartments</option>
                <option>Garden Villas</option>
              </select>
              <select className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-transparent dark:text-white">
                <option>Sort by: Date</option>
                <option>Sort by: Score</option>
                <option>Sort by: Status</option>
              </select>
            </div>
          </div>
        </div>

        {/* Inspections Table */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Inspection Details
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Property & Unit
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Schedule
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Results
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filteredInspections.map((inspection) => (
                  <tr key={inspection.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-4">
                      <div>
                        <div className="font-medium dark:text-white">{inspection.inspectionNumber}</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${typeColors[inspection.type]}`}>
                            {inspection.type.toUpperCase()}
                          </span>
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                          Inspector: {inspection.inspector}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <div className="font-medium dark:text-white flex items-center">
                          <FaHome className="mr-2 text-gray-400" />
                          {inspection.property}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                          Unit: {inspection.unit}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm">
                        <div className="flex items-center mb-1">
                          <FaCalendarAlt className="mr-2 text-gray-400" />
                          <span className="dark:text-white">Scheduled: {inspection.scheduledDate}</span>
                        </div>
                        {inspection.completedDate && (
                          <div className="flex items-center">
                            <FaCheckCircle className="mr-2 text-gray-400" />
                            <span className="dark:text-white">Completed: {inspection.completedDate}</span>
                          </div>
                        )}
                        {inspection.tenantPresent !== null && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            Tenant {inspection.tenantPresent ? 'was' : 'was not'} present
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {inspection.score ? (
                        <div>
                          <div className="flex items-center">
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getScoreColor(inspection.score)}`}>
                              Score: {inspection.score}/100
                            </span>
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                            <div>Issues: {inspection.issuesFound}</div>
                            <div>Photos: {inspection.photos}</div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          Scheduled for {inspection.scheduledDate}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${statusColors[inspection.status]}`}>
                          {inspection.status.toUpperCase()}
                        </span>
                        {inspection.nextInspection && inspection.nextInspection !== 'N/A' && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            Next: {inspection.nextInspection}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex space-x-2">
                        <Link to={`/inspections/${inspection.id}`}>
                          <button className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg" title="View Details">
                            <FaEye />
                          </button>
                        </Link>
                        {inspection.status === 'scheduled' && (
                          <>
                            <Link to={`/inspections/${inspection.id}/edit`}>
                              <button className="p-2 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-lg" title="Edit">
                                <FaEdit />
                              </button>
                            </Link>
                            <button className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg" title="Complete">
                              <FaCheckCircle />
                            </button>
                          </>
                        )}
                        <button className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg" title="Delete">
                          <FaTrash />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Upcoming Inspections */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow">
            <h3 className="font-bold dark:text-white mb-4">Upcoming Inspections</h3>
            <div className="space-y-4">
              {inspections
                .filter(insp => insp.status === 'scheduled')
                .slice(0, 3)
                .map((inspection) => (
                  <div key={inspection.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                    <div>
                      <div className="font-medium dark:text-white">{inspection.inspectionNumber}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {inspection.property} • {inspection.unit}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                        {inspection.scheduledDate}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {inspection.type}
                      </div>
                    </div>
                  </div>
                ))}
              <button className="w-full py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700">
                View All Upcoming Inspections
              </button>
            </div>
          </div>
          
          <div className="bg-gradient-to-br from-emerald-500 to-green-500 rounded-xl p-6 text-white">
            <h3 className="font-bold mb-4">Inspection Management</h3>
            <div className="space-y-3">
              <button className="w-full py-3 bg-white/20 rounded-lg hover:bg-white/30 transition flex items-center justify-center space-x-2">
                <FaCalendarPlus />
                <span>Schedule Bulk Inspections</span>
              </button>
              <button className="w-full py-3 bg-white/20 rounded-lg hover:bg-white/30 transition flex items-center justify-center space-x-2">
                <FaClipboardCheck />
                <span>Generate Inspection Reports</span>
              </button>
              <button className="w-full py-3 bg-white/20 rounded-lg hover:bg-white/30 transition flex items-center justify-center space-x-2">
                <FaExclamationTriangle />
                <span>Review Failed Inspections</span>
              </button>
              <button className="w-full py-3 bg-white/20 rounded-lg hover:bg-white/30 transition flex items-center justify-center space-x-2">
                <FaDownload />
                <span>Download Inspection Templates</span>
              </button>
            </div>
          </div>
        </div>

        {/* Inspection Performance */}
        <div className="mt-8 bg-white dark:bg-gray-800 rounded-xl p-6 shadow">
          <h3 className="font-bold dark:text-white mb-4">Inspection Performance</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">88%</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">On-time Completion Rate</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">94%</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Tenant Satisfaction</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-purple-600 dark:text-purple-400">76</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Avg. Issues Found</div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Inspections;