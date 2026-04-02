import React, { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  FaCog,
  FaPlus,
  FaEdit,
  FaTrash,
  FaCheck,
  FaTimes,
  FaSave,
  FaSpinner,
  FaExclamationCircle,
  FaFilter,
  FaLightbulb,
  FaClock,
  FaMoneyBillWave,
  FaReceipt,
} from "react-icons/fa";
import { toast } from "react-toastify";
import * as companySettingsAPI from "../../redux/companySettingsAPI";

const MILIK_GREEN = "#0B3B2E";
const MILIK_ORANGE = "#FF8C00";

const CompanySettings = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { currentCompany } = useSelector((state) => state.company);
  const { companySettings, isFetching } = useSelector((state) => state.companySettings);

  const [activeTab, setActiveTab] = useState("utilities");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({});

  useEffect(() => {
    if (currentCompany?._id) {
      companySettingsAPI.getCompanySettings(dispatch, currentCompany._id);
    }
  }, [currentCompany?._id, dispatch]);

  const handleOpenAddModal = (tab) => {
    setActiveTab(tab);
    setShowAddModal(true);
    setEditingId(null);
    resetForm(tab);
  };

  const resetForm = (tab) => {
    switch (tab) {
      case "utilities":
        setFormData({ name: "", description: "", category: "utility" });
        break;
      case "periods":
        setFormData({ name: "", durationInMonths: "", durationInDays: "" });
        break;
      case "commissions":
        setFormData({ name: "", percentage: "", applicableTo: "rent", description: "" });
        break;
      case "expenses":
        setFormData({ name: "", description: "", code: "", category: "other", defaultAmount: 0 });
        break;
      default:
        setFormData({});
    }
  };

  const handleAddItem = async () => {
    if (!currentCompany?._id) return;

    try {
      switch (activeTab) {
        case "utilities":
          if (!formData.name) {
            toast.error("Utility name is required");
            return;
          }
          if (editingId) {
            await companySettingsAPI.updateUtilityType(
              dispatch,
              currentCompany._id,
              editingId,
              formData
            );
            toast.success("Utility updated successfully");
          } else {
            await companySettingsAPI.addUtilityType(dispatch, currentCompany._id, formData);
            toast.success("Utility added successfully");
          }
          break;

        case "periods":
          if (!formData.name || !formData.durationInMonths) {
            toast.error("Name and duration are required");
            return;
          }
          if (editingId) {
            await companySettingsAPI.updateBillingPeriod(
              dispatch,
              currentCompany._id,
              editingId,
              formData
            );
            toast.success("Billing period updated successfully");
          } else {
            await companySettingsAPI.addBillingPeriod(dispatch, currentCompany._id, formData);
            toast.success("Billing period added successfully");
          }
          break;

        case "commissions":
          if (!formData.name || formData.percentage === "") {
            toast.error("Name and percentage are required");
            return;
          }
          if (editingId) {
            await companySettingsAPI.updateCommission(
              dispatch,
              currentCompany._id,
              editingId,
              formData
            );
            toast.success("Commission updated successfully");
          } else {
            await companySettingsAPI.addCommission(dispatch, currentCompany._id, formData);
            toast.success("Commission added successfully");
          }
          break;

        case "expenses":
          if (!formData.name) {
            toast.error("Expense item name is required");
            return;
          }
          if (editingId) {
            await companySettingsAPI.updateExpenseItem(
              dispatch,
              currentCompany._id,
              editingId,
              formData
            );
            toast.success("Expense item updated successfully");
          } else {
            await companySettingsAPI.addExpenseItem(dispatch, currentCompany._id, formData);
            toast.success("Expense item added successfully");
          }
          break;

        default:
          break;
      }

      setShowAddModal(false);
      resetForm(activeTab);
    } catch (error) {
      toast.error(error.message || "Failed to save item");
    }
  };

  const handleEdit = (item, tab) => {
    setActiveTab(tab);
    setEditingId(item._id);
    setFormData(item);
    setShowAddModal(true);
  };

  const handleDelete = async (id, tab) => {
    if (!currentCompany?._id) return;

    if (!window.confirm("Are you sure you want to delete this item?")) return;

    try {
      switch (tab) {
        case "utilities":
          await companySettingsAPI.deleteUtilityType(dispatch, currentCompany._id, id);
          toast.success("Utility deleted successfully");
          break;
        case "periods":
          await companySettingsAPI.deleteBillingPeriod(dispatch, currentCompany._id, id);
          toast.success("Billing period deleted successfully");
          break;
        case "commissions":
          await companySettingsAPI.deleteCommission(dispatch, currentCompany._id, id);
          toast.success("Commission deleted successfully");
          break;
        case "expenses":
          await companySettingsAPI.deleteExpenseItem(dispatch, currentCompany._id, id);
          toast.success("Expense item deleted successfully");
          break;
        default:
          break;
      }
    } catch (error) {
      toast.error(error.message || "Failed to delete item");
    }
  };

  return (
    <DashboardLayout>
      <div className="p-6 bg-white min-h-screen">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <FaCog className="text-3xl" style={{ color: MILIK_GREEN }} />
            <h1 className="text-4xl font-bold text-slate-900">Company Settings</h1>
          </div>
          <p className="text-slate-600">
            Manage your company's utilities, billing periods, commissions, and expense items
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-slate-200 flex-wrap">
          {[
            { id: "utilities", label: "Utility Types", icon: FaLightbulb },
            { id: "periods", label: "Billing Periods", icon: FaClock },
            { id: "commissions", label: "Commissions", icon: FaMoneyBillWave },
            { id: "expenses", label: "Expense Items", icon: FaReceipt },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-6 py-3 font-medium flex items-center gap-2 border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? `border-${MILIK_ORANGE} text-orange-600`
                    : "border-transparent text-slate-600 hover:text-slate-900"
                }`}
                style={
                  activeTab === tab.id ? { borderBottomColor: MILIK_ORANGE, color: MILIK_ORANGE } : {}
                }
              >
                <Icon className="text-lg" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="mb-6">
          {activeTab === "utilities" && (
            <UtilitiesTab
              data={companySettings?.utilityTypes || []}
              onAdd={() => handleOpenAddModal("utilities")}
              onEdit={(item) => handleEdit(item, "utilities")}
              onDelete={(id) => handleDelete(id, "utilities")}
              loading={isFetching}
            />
          )}
          {activeTab === "periods" && (
            <PeriodsTab
              data={companySettings?.billingPeriods || []}
              onAdd={() => handleOpenAddModal("periods")}
              onEdit={(item) => handleEdit(item, "periods")}
              onDelete={(id) => handleDelete(id, "periods")}
              loading={isFetching}
            />
          )}
          {activeTab === "commissions" && (
            <CommissionsTab
              data={companySettings?.commissions || []}
              onAdd={() => handleOpenAddModal("commissions")}
              onEdit={(item) => handleEdit(item, "commissions")}
              onDelete={(id) => handleDelete(id, "commissions")}
              onManagePropertySettings={() => navigate("/properties/commission-settings")}
              loading={isFetching}
            />
          )}
          {activeTab === "expenses" && (
            <ExpensesTab
              data={companySettings?.expenseItems || []}
              onAdd={() => handleOpenAddModal("expenses")}
              onEdit={(item) => handleEdit(item, "expenses")}
              onDelete={(id) => handleDelete(id, "expenses")}
              loading={isFetching}
            />
          )}
        </div>

        {/* Add/Edit Modal */}
        {showAddModal && (
          <AddItemModal
            visible={showAddModal}
            onClose={() => setShowAddModal(false)}
            onSave={handleAddItem}
            formData={formData}
            setFormData={setFormData}
            tab={activeTab}
            editing={!!editingId}
            loading={isFetching}
          />
        )}
      </div>
    </DashboardLayout>
  );
};

// Utilities Tab Component
const UtilitiesTab = ({ data, onAdd, onEdit, onDelete, loading }) => (
  <div>
    <div className="flex justify-between items-center mb-4">
      <h2 className="text-xl font-bold text-slate-900">Utility Types</h2>
      <button
        onClick={onAdd}
        className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
        style={{ backgroundColor: "#FF8C00" }}
      >
        <FaPlus /> Add Utility
      </button>
    </div>

    {data.length === 0 ? (
      <div className="bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
        <FaLightbulb className="text-4xl text-slate-300 mx-auto mb-3" />
        <p className="text-slate-600">No utility types added yet</p>
      </div>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.map((utility) => (
          <div key={utility._id} className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-lg transition-shadow">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="font-bold text-slate-900">{utility.name}</h3>
                <p className="text-xs text-slate-500 mt-1">{utility.category}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onEdit(utility)}
                  className="text-blue-600 hover:text-blue-800 p-2"
                  title="Edit"
                >
                  <FaEdit />
                </button>
                <button
                  onClick={() => onDelete(utility._id)}
                  className="text-red-600 hover:text-red-800 p-2"
                  title="Delete"
                >
                  <FaTrash />
                </button>
              </div>
            </div>
            {utility.description && (
              <p className="text-sm text-slate-600">{utility.description}</p>
            )}
            <div className="mt-3 pt-3 border-t border-slate-200">
              <span
                className={`px-2 py-1 rounded text-xs font-medium ${
                  utility.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
                }`}
              >
                {utility.isActive ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

// Billing Periods Tab Component
const PeriodsTab = ({ data, onAdd, onEdit, onDelete, loading }) => (
  <div>
    <div className="flex justify-between items-center mb-4">
      <h2 className="text-xl font-bold text-slate-900">Billing Periods</h2>
      <button
        onClick={onAdd}
        className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
        style={{ backgroundColor: "#FF8C00" }}
      >
        <FaPlus /> Add Period
      </button>
    </div>

    {data.length === 0 ? (
      <div className="bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
        <FaClock className="text-4xl text-slate-300 mx-auto mb-3" />
        <p className="text-slate-600">No billing periods added yet</p>
      </div>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left font-bold text-slate-900">Period Name</th>
              <th className="px-4 py-3 text-left font-bold text-slate-900">Duration (Months)</th>
              <th className="px-4 py-3 text-left font-bold text-slate-900">Duration (Days)</th>
              <th className="px-4 py-3 text-left font-bold text-slate-900">Status</th>
              <th className="px-4 py-3 text-center font-bold text-slate-900">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.map((period) => (
              <tr key={period._id} className="border-b border-slate-200 hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-900 font-medium">{period.name}</td>
                <td className="px-4 py-3 text-slate-600">{period.durationInMonths}</td>
                <td className="px-4 py-3 text-slate-600">{period.durationInDays}</td>
                <td className="px-4 py-3">
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      period.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {period.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3 text-center flex justify-center gap-2">
                  <button
                    onClick={() => onEdit(period)}
                    className="text-blue-600 hover:text-blue-800 p-2"
                    title="Edit"
                  >
                    <FaEdit />
                  </button>
                  <button
                    onClick={() => onDelete(period._id)}
                    className="text-red-600 hover:text-red-800 p-2"
                    title="Delete"
                  >
                    <FaTrash />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

// Commissions Tab Component
const CommissionsTab = ({ data, onAdd, onEdit, onDelete, onManagePropertySettings, loading }) => (
  <div>
    <div className="flex justify-between items-center mb-4">
      <h2 className="text-xl font-bold text-slate-900">Commission Structures</h2>
      <div className="flex items-center gap-2">
        <button
          onClick={onManagePropertySettings}
          className="bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
        >
          <FaCog /> Per Property Commission
        </button>
        <button
          onClick={onAdd}
          className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
          style={{ backgroundColor: "#FF8C00" }}
        >
          <FaPlus /> Add Commission
        </button>
      </div>
    </div>

    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
      Property commission values are managed per property under <span className="font-semibold">Per Property Commission</span>.
      Global commission structures below remain available for reusable templates and defaults.
    </div>

    {data.length === 0 ? (
      <div className="bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
        <FaMoneyBillWave className="text-4xl text-slate-300 mx-auto mb-3" />
        <p className="text-slate-600">No commissions added yet</p>
      </div>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.map((commission) => (
          <div key={commission._id} className="bg-gradient-to-br from-orange-50 to-yellow-50 border-2 border-orange-200 rounded-lg p-4 hover:shadow-lg transition-shadow">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="font-bold text-slate-900">{commission.name}</h3>
                <p className="text-2xl font-bold text-orange-600 mt-2">{commission.percentage}%</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onEdit(commission)}
                  className="text-blue-600 hover:text-blue-800 p-2"
                  title="Edit"
                >
                  <FaEdit />
                </button>
                <button
                  onClick={() => onDelete(commission._id)}
                  className="text-red-600 hover:text-red-800 p-2"
                  title="Delete"
                >
                  <FaTrash />
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-slate-600">
                <span className="font-medium">Applies to:</span> {commission.applicableTo}
              </p>
              {commission.description && (
                <p className="text-sm text-slate-600">{commission.description}</p>
              )}
              <div className="mt-3 pt-3 border-t border-orange-200">
                <span
                  className={`px-2 py-1 rounded text-xs font-medium ${
                    commission.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {commission.isActive ? "Active" : "Inactive"}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

// Expenses Tab Component
const ExpensesTab = ({ data, onAdd, onEdit, onDelete, loading }) => (
  <div>
    <div className="flex justify-between items-center mb-4">
      <h2 className="text-xl font-bold text-slate-900">Expense Items</h2>
      <button
        onClick={onAdd}
        className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
        style={{ backgroundColor: "#FF8C00" }}
      >
        <FaPlus /> Add Expense
      </button>
    </div>

    {data.length === 0 ? (
      <div className="bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
        <FaReceipt className="text-4xl text-slate-300 mx-auto mb-3" />
        <p className="text-slate-600">No expense items added yet</p>
      </div>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left font-bold text-slate-900">Item Name</th>
              <th className="px-4 py-3 text-left font-bold text-slate-900">Category</th>
              <th className="px-4 py-3 text-left font-bold text-slate-900">Default Amount</th>
              <th className="px-4 py-3 text-left font-bold text-slate-900">Status</th>
              <th className="px-4 py-3 text-center font-bold text-slate-900">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.map((expense) => (
              <tr key={expense._id} className="border-b border-slate-200 hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-900 font-medium">{expense.name}</td>
                <td className="px-4 py-3 text-slate-600 capitalize">{expense.category}</td>
                <td className="px-4 py-3 text-slate-600">Ksh {(expense.defaultAmount || 0).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      expense.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {expense.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3 text-center flex justify-center gap-2">
                  <button
                    onClick={() => onEdit(expense)}
                    className="text-blue-600 hover:text-blue-800 p-2"
                    title="Edit"
                  >
                    <FaEdit />
                  </button>
                  <button
                    onClick={() => onDelete(expense._id)}
                    className="text-red-600 hover:text-red-800 p-2"
                    title="Delete"
                  >
                    <FaTrash />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

// Add/Edit Modal Component
const AddItemModal = ({ visible, onClose, onSave, formData, setFormData, tab, editing, loading }) => {
  if (!visible) return null;

  const getTitle = () => {
    if (editing) {
      return `Edit ${tab === "utilities" ? "Utility" : tab === "periods" ? "Period" : tab === "commissions" ? "Commission" : "Expense"}`;
    }
    return `Add New ${tab === "utilities" ? "Utility" : tab === "periods" ? "Period" : tab === "commissions" ? "Commission" : "Expense"}`;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-2xl max-w-md w-full mx-4 p-6">
        <h2 className="text-2xl font-bold text-slate-900 mb-4">{getTitle()}</h2>

        {tab === "utilities" && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">
                Utility Name *
              </label>
              <input
                type="text"
                value={formData.name || ""}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Electricity, Water"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Description</label>
              <textarea
                value={formData.description || ""}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional description"
                rows="3"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Category</label>
              <select
                value={formData.category || "utility"}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="utility">Utility</option>
                <option value="service_charge">Service Charge</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>
          </div>
        )}

        {tab === "periods" && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">
                Period Name *
              </label>
              <input
                type="text"
                value={formData.name || ""}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Monthly, Quarterly"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">
                Duration (Months) *
              </label>
              <input
                type="number"
                value={formData.durationInMonths || ""}
                onChange={(e) => setFormData({ ...formData, durationInMonths: parseInt(e.target.value) || "" })}
                placeholder="e.g., 1, 3, 12"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">
                Duration (Days)
              </label>
              <input
                type="number"
                value={formData.durationInDays || ""}
                onChange={(e) => setFormData({ ...formData, durationInDays: parseInt(e.target.value) || "" })}
                placeholder="e.g., 30, 90, 365"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
          </div>
        )}

        {tab === "commissions" && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">
                Commission Name *
              </label>
              <input
                type="text"
                value={formData.name || ""}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Default, Premium"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">
                Percentage (%) *
              </label>
              <input
                type="number"
                value={formData.percentage || ""}
                onChange={(e) => setFormData({ ...formData, percentage: parseFloat(e.target.value) || "" })}
                placeholder="e.g., 5, 10, 15"
                min="0"
                max="100"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Applies To</label>
              <select
                value={formData.applicableTo || "rent"}
                onChange={(e) => setFormData({ ...formData, applicableTo: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="rent">Rent Only</option>
                <option value="utilities">Utilities Only</option>
                <option value="all">All Income</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Description</label>
              <textarea
                value={formData.description || ""}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional description"
                rows="2"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
          </div>
        )}

        {tab === "expenses" && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">
                Expense Name *
              </label>
              <input
                type="text"
                value={formData.name || ""}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Repairs, Cleaning"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Category</label>
              <select
                value={formData.category || "other"}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="maintenance">Maintenance</option>
                <option value="utilities">Utilities</option>
                <option value="staffing">Staffing</option>
                <option value="supplies">Supplies</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Default Amount</label>
              <input
                type="number"
                value={formData.defaultAmount || 0}
                onChange={(e) => setFormData({ ...formData, defaultAmount: parseFloat(e.target.value) || 0 })}
                placeholder="0.00"
                min="0"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Description</label>
              <textarea
                value={formData.description || ""}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional description"
                rows="2"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
          </div>
        )}

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors font-medium flex items-center justify-center gap-2"
          >
            <FaTimes /> Cancel
          </button>
          <button
            onClick={onSave}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ backgroundColor: "#FF8C00" }}
          >
            {loading ? <FaSpinner className="animate-spin" /> : <FaSave />}
            {loading ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CompanySettings;
