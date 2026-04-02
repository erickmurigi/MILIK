import React from 'react';
import { FaBell } from 'react-icons/fa';

const AlertBanner = ({ darkMode }) => {
  return (
    <div className="mb-6 p-4 bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20 border border-amber-200 dark:border-amber-800 rounded-xl flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <FaBell className="text-amber-600 dark:text-amber-400" />
        <div>
          <p className="font-medium text-amber-800 dark:text-amber-300">
            You have 43 pending invoices and 1 subscription invoice due.
          </p>
          <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
            Review and take action on overdue payments.
          </p>
        </div>
      </div>
      <button className="px-4 py-2 text-sm font-medium text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-900 hover:bg-amber-200 dark:hover:bg-amber-800 rounded-lg transition-colors">
        View Details
      </button>
    </div>
  );
};

export default AlertBanner;