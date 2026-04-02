// pages/Maintenances.js
import React, { useState } from 'react';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { 
  FaTools, FaPlus, FaFilter, FaDownload, FaSearch, FaEdit, FaTrash, FaEye,
  FaHome, FaUser, FaCalendarAlt, FaExclamationTriangle, FaCheckCircle, FaClock
} from 'react-icons/fa';
import { Link } from 'react-router-dom';

const Maintenances = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState('all');

  // Sample maintenance requests data
  const maintenanceRequests = [
    {
      id: 1,
      ticketNumber: 'MT-2024-001',
      unit: 'A101 - Milik Towers',
      tenant: 'Michael Otieno',
      issueType: 'Plumbing',
      description: 'Leaking kitchen faucet',
      priority: 'high',
      status: 'in-progress',
      reportedDate: '2024-01-15',
      assignedTo: 'John Technician',
      estimatedCost: 'KSh 3,500',
      estimatedCompletion: '2024-01-20',
      actualCompletion: null,
      notes: 'Need to replace faucet cartridge'
    },
    {
      id: 2,
      ticketNumber: 'MT-2024-002',
      unit: 'B201 - Westgate Apartments',
      tenant: 'Grace Wanjiru',
      issueType: 'Electrical',
      description: 'Bedroom lights not working',
      priority: 'medium',
      status: 'pending',
      reportedDate: '2024-01-18',
      assignedTo: null,
      estimatedCost: 'KSh 2,000',
      estimatedCompletion: '2024-01-25',
      actualCompletion: null,
      notes: 'Circuit breaker issue suspected'
    },
    {
      id: 3,
      ticketNumber: 'MT-2024-003',
      unit: 'E201 - Riverside Suites',
      tenant: 'James Wangari',
      issueType: 'HVAC',
      description: 'AC not cooling properly',
      priority: 'high',
      status: 'completed',
      reportedDate: '2024-01-10',
      assignedTo: 'Peter HVAC Specialist',
      estimatedCost: 'KSh 12,000',
      estimatedCompletion: '2024-01-12',
      actualCompletion: '2024-01-11',
      notes: 'Replaced compressor, system working normally'
    },
    {
      id: 4,
      ticketNumber: 'MT-2024-004',
      unit: 'D101 - CBD Business Center',
      tenant: 'Tech Solutions Ltd',
      issueType: 'General',
      description: 'Broken office door lock',
      priority: 'medium',
      status: 'in-progress',
      reportedDate: '2024-01-17',
      assignedTo: 'Security Team',
      estimatedCost: 'KSh 4,500',
      estimatedCompletion: '2024-01-19',
      actualCompletion: null,
      notes: 'Waiting for new lock delivery'
    },
    {
      id: 5,
      ticketNumber: 'MT-2024-005',
      unit: 'C102 - Milik Towers',
      tenant: 'Sarah Mohamed',
      issueType: 'Appliances',
      description: 'Refrigerator not cooling',
      priority: 'high',
      status: 'pending',
      reportedDate: '2024-01-19',
      assignedTo: null,
      estimatedCost: 'KSh 8,000',
      estimatedCompletion: '2024-01-22',
      actualCompletion: null,
      notes: 'Possible compressor failure'
    },
    {
      id: 6,
      ticketNumber: 'MT-2024-006',
      unit: 'F301 - Garden Villas',
      tenant: 'David Kimani',
      issueType: 'Structural',
      description: 'Crack in bathroom wall',
      priority: 'low',
      status: 'scheduled',
      reportedDate: '2024-01-14',
      assignedTo: 'Construction Team',
      estimatedCost: 'KSh 6,500',
      estimatedCompletion: '2024-01-28',
      actualCompletion: null,
      notes: 'Non-urgent cosmetic repair'
    },
    {
      id: 7,
      ticketNumber: 'MT-2024-007',
      unit: 'Common Area',
      tenant: 'N/A',
      issueType: 'Landscaping',
      description: 'Garden irrigation system broken',
      priority: 'medium',
      status: 'completed',
      reportedDate: '2024-01-05',
      assignedTo: 'Garden Maintenance',
      estimatedCost: 'KSh 15,000',
      estimatedCompletion: '2024-01-08',
      actualCompletion: '2024-01-07',
      notes: 'Replaced pipes and sprinkler heads'
    },
    {
      id: 8,
      ticketNumber: 'MT-2024-008',
      unit: 'Parking Lot',
      tenant: 'N/A',
      issueType: 'Security',
      description: 'Broken parking gate',
      priority: 'high',
      status: 'in-progress',
      reportedDate: '2024-01-20',
      assignedTo: 'Security Team',
      estimatedCost: 'KSh 25,000',
      estimatedCompletion: '2024-01-22',
      actualCompletion: null,
      notes: 'Emergency repair - gate motor failure'
    }
  ];

  const priorityColors = {
    high: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    low: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
  };

  const statusColors = {
    pending: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
    'in-progress': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    scheduled: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
  };

  const getStatusIcon = (status) => {
    switch(status) {
      case 'pending': return <FaClock className="text-gray-500" />;
      case 'in-progress': return <FaTools className="text-blue-500" />;
      case 'completed': return <FaCheckCircle className="text-green-500" />;
      case 'scheduled': return <FaCalendarAlt className="text-purple-500" />;
      default: return <FaClock className="text-gray-500" />;
    }
  };

  const filteredRequests = filter === 'all' 
    ? maintenanceRequests 
    : maintenanceRequests.filter(req => req.status === filter);

  const calculateStats = () => {
    const total = maintenanceRequests.length;
    const pending = maintenanceRequests.filter(req => req.status === 'pending').length;
    const inProgress = maintenanceRequests.filter(req => req.status === 'in-progress').length;
    const completed = maintenanceRequests.filter(req => req.status === 'completed').length;
    
    return { total, pending, inProgress, completed };
  };

  const stats = calculateStats();

  return (
    <DashboardLayout>
      <div className="p-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold dark:text-white">Maintenance Management</h1>
            <p className="text-gray-600 dark:text-gray-400">Track and manage all maintenance requests</p>
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
            <Link to="/maintenances/create">
              <button className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-green-500 text-white rounded-lg flex items-center space-x-2 hover:shadow-lg">
                <FaPlus />
                <span>New Request</span>
              </button>
            </Link>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl p-5 text-white shadow-lg">
            <div className="flex items-start justify-between mb-4">
              <div className="p-2.5 bg-white/20 rounded-xl">
                <FaTools />
              </div>
              <span className="text-xs font-medium bg-white/20 px-2 py-1 rounded-full">+3 new</span>
            </div>
            <h3 className="text-2xl font-bold mb-1">{stats.total}</h3>
            <p className="text-white/90 text-sm">Total Requests</p>
          </div>
          
          <div className="bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl p-5 text-white shadow-lg">
            <div className="flex items-start justify-between mb-4">
              <div className="p-2.5 bg-white/20 rounded-xl">
                <FaClock />
              </div>
              <span className="text-xs font-medium bg-white/20 px-2 py-1 rounded-full">{stats.pending}</span>
            </div>
            <h3 className="text-2xl font-bold mb-1">{stats.pending}</h3>
            <p className="text-white/90 text-sm">Pending</p>
          </div>
          
          <div className="bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl p-5 text-white shadow-lg">
            <div className="flex items-start justify-between mb-4">
              <div className="p-2.5 bg-white/20 rounded-xl">
                <FaTools />
              </div>
              <span className="text-xs font-medium bg-white/20 px-2 py-1 rounded-full">{stats.inProgress}</span>
            </div>
            <h3 className="text-2xl font-bold mb-1">{stats.inProgress}</h3>
            <p className="text-white/90 text-sm">In Progress</p>
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
              All Requests
            </button>
            <button 
              onClick={() => setFilter('pending')}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === 'pending' 
                  ? 'bg-gray-500 text-white' 
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              Pending
            </button>
            <button 
              onClick={() => setFilter('in-progress')}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === 'in-progress' 
                  ? 'bg-blue-500 text-white' 
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              In Progress
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
          </div>
        </div>

        {/* Search and Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 mb-6 shadow">
          <div className="flex flex-col md:flex-row md:items-center justify-between space-y-4 md:space-y-0">
            <div className="relative flex-1">
              <FaSearch className="absolute left-3 top-3 text-gray-400" />
              <input
                type="text"
                placeholder="Search maintenance requests by ticket number, unit, or issue..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-transparent dark:text-white"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="flex space-x-3">
              <select className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-transparent dark:text-white">
                <option>All Priorities</option>
                <option>High</option>
                <option>Medium</option>
                <option>Low</option>
              </select>
              <select className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-transparent dark:text-white">
                <option>All Issue Types</option>
                <option>Plumbing</option>
                <option>Electrical</option>
                <option>HVAC</option>
                <option>Structural</option>
              </select>
              <select className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-transparent dark:text-white">
                <option>Sort by: Recent</option>
                <option>Sort by: Priority</option>
                <option>Sort by: Status</option>
              </select>
            </div>
          </div>
        </div>

        {/* Maintenance Requests Table */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Ticket Details
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Unit & Tenant
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Issue Details
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Assignment & Cost
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
                {filteredRequests.map((request) => (
                  <tr key={request.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-4">
                      <div>
                        <div className="font-medium dark:text-white">{request.ticketNumber}</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          Reported: {request.reportedDate}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <div className="font-medium dark:text-white flex items-center">
                          <FaHome className="mr-2 text-gray-400" />
                          {request.unit}
                        </div>
                        {request.tenant !== 'N/A' && (
                          <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center mt-1">
                            <FaUser className="mr-2" />
                            {request.tenant}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <div className="font-medium dark:text-white">{request.issueType}</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                          {request.description}
                        </div>
                        <div className="mt-2">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${priorityColors[request.priority]}`}>
                            {request.priority.toUpperCase()} PRIORITY
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <div className="text-sm">
                          <div className="font-medium dark:text-white mb-1">
                            {request.assignedTo || 'Unassigned'}
                          </div>
                          <div className="text-gray-500 dark:text-gray-400">
                            Est. Cost: {request.estimatedCost}
                          </div>
                          <div className="text-gray-500 dark:text-gray-400 mt-1">
                            Est. Complete: {request.estimatedCompletion}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <div className="mr-3">
                          {getStatusIcon(request.status)}
                        </div>
                        <div>
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${statusColors[request.status]}`}>
                            {request.status.replace('-', ' ').toUpperCase()}
                          </span>
                          {request.actualCompletion && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              Completed: {request.actualCompletion}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex space-x-2">
                        <Link to={`/maintenances/${request.id}`}>
                          <button className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg" title="View Details">
                            <FaEye />
                          </button>
                        </Link>
                        <Link to={`/maintenances/${request.id}/edit`}>
                          <button className="p-2 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-lg" title="Edit">
                            <FaEdit />
                          </button>
                        </Link>
                        {request.status !== 'completed' && (
                          <button className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg" title="Mark Complete">
                            <FaCheckCircle />
                          </button>
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

        {/* Maintenance Summary */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow">
            <h3 className="font-bold dark:text-white mb-4">Maintenance Statistics</h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Average Response Time</span>
                  <span className="text-sm font-semibold">2.3 days</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div className="bg-emerald-500 h-2 rounded-full" style={{ width: '60%' }}></div>
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Average Completion Time</span>
                  <span className="text-sm font-semibold">4.7 days</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div className="bg-blue-500 h-2 rounded-full" style={{ width: '70%' }}></div>
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Customer Satisfaction</span>
                  <span className="text-sm font-semibold">92%</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div className="bg-green-500 h-2 rounded-full" style={{ width: '92%' }}></div>
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Monthly Maintenance Cost</span>
                  <span className="text-sm font-semibold">KSh 85,000</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div className="bg-purple-500 h-2 rounded-full" style={{ width: '85%' }}></div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="bg-gradient-to-br from-emerald-500 to-green-500 rounded-xl p-6 text-white">
            <h3 className="font-bold mb-4">Quick Maintenance Actions</h3>
            <div className="space-y-3">
              <button className="w-full py-3 bg-white/20 rounded-lg hover:bg-white/30 transition flex items-center justify-center space-x-2">
                <FaPlus />
                <span>Create Maintenance Schedule</span>
              </button>
              <button className="w-full py-3 bg-white/20 rounded-lg hover:bg-white/30 transition flex items-center justify-center space-x-2">
                <FaTools />
                <span>Assign Pending Requests</span>
              </button>
              <button className="w-full py-3 bg-white/20 rounded-lg hover:bg-white/30 transition flex items-center justify-center space-x-2">
                <FaExclamationTriangle />
                <span>View High Priority Issues</span>
              </button>
              <button className="w-full py-3 bg-white/20 rounded-lg hover:bg-white/30 transition flex items-center justify-center space-x-2">
                <FaDownload />
                <span>Generate Maintenance Report</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Maintenances;