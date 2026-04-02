// TabContext.jsx (simplified)
import React, { createContext, useContext, useState, useCallback } from 'react';

const TabContext = createContext();

// Unique ID generator to avoid duplicate keys
let tabIdCounter = 0;
const generateUniqueTabId = (prefix) => {
  tabIdCounter += 1;
  return `${prefix}-${Date.now()}-${tabIdCounter}`;
};

export const useTabContext = () => {
  const context = useContext(TabContext);
  if (!context) {
    throw new Error('useTabContext must be used within a TabProvider');
  }
  return context;
};

export const TabProvider = ({ children }) => {
  const [tabs, setTabs] = useState([
    { 
      id: 'dashboard', 
      title: 'Dashboard', 
      route: '/dashboard', 
      closable: false, 
      timestamp: Date.now()
    }
  ]);
  const [activeTab, setActiveTab] = useState('dashboard');

  const addNewTab = useCallback((route, title = null) => {
    const tabTitle = title || route.split('/').pop().charAt(0).toUpperCase() + route.split('/').pop().slice(1);
    const newTabId = generateUniqueTabId(route.replace(/\//g, '-'));
    
    setTabs(prevTabs => {
      // Check if tab with same route already exists
      const existingTabIndex = prevTabs.findIndex(tab => tab.route === route);
      if (existingTabIndex !== -1) {
        // Update existing tab and move it to the end
        const updatedTabs = [...prevTabs];
        updatedTabs[existingTabIndex] = {
          ...updatedTabs[existingTabIndex],
          timestamp: Date.now()
        };
        setActiveTab(updatedTabs[existingTabIndex].id);
        return updatedTabs;
      }
      
      // Add new tab
      const newTab = {
        id: newTabId,
        title: tabTitle,
        route: route,
        closable: route !== '/dashboard',
        timestamp: Date.now()
      };
      
      setActiveTab(newTabId);
      return [...prevTabs, newTab];
    });
  }, []);

  const closeTab = useCallback((tabId) => {
    if (tabs.length <= 1) return;
    
    const tabToClose = tabs.find(tab => tab.id === tabId);
    if (!tabToClose || !tabToClose.closable) return;
    
    setTabs(prevTabs => prevTabs.filter(tab => tab.id !== tabId));
    
    // If we're closing the active tab, switch to dashboard
    if (tabId === activeTab) {
      setActiveTab('dashboard');
    }
  }, [tabs, activeTab]);

  return (
    <TabContext.Provider value={{
      tabs,
      activeTab,
      addNewTab,
      closeTab
    }}>
      {children}
    </TabContext.Provider>
  );
};