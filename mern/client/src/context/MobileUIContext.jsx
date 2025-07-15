import React, { createContext, useContext, useState } from 'react';

const MobileUIContext = createContext();

export const useMobileUI = () => {
  const context = useContext(MobileUIContext);
  if (!context) {
    throw new Error('useMobileUI must be used within a MobileUIProvider');
  }
  return context;
};

export const MobileUIProvider = ({ children }) => {
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(false);
  const [isActionDrawerOpen, setIsActionDrawerOpen] = useState(false);

  const toggleLeftSidebar = () => {
    setIsLeftSidebarOpen(!isLeftSidebarOpen);
    // Close action drawer if it's open (only one overlay at a time)
    if (isActionDrawerOpen) {
      setIsActionDrawerOpen(false);
    }
  };

  const toggleActionDrawer = () => {
    setIsActionDrawerOpen(!isActionDrawerOpen);
    // Close left sidebar if it's open (only one overlay at a time)
    if (isLeftSidebarOpen) {
      setIsLeftSidebarOpen(false);
    }
  };

  const closeAllOverlays = () => {
    setIsLeftSidebarOpen(false);
    setIsActionDrawerOpen(false);
  };

  const value = {
    isLeftSidebarOpen,
    isActionDrawerOpen,
    toggleLeftSidebar,
    toggleActionDrawer,
    closeAllOverlays,
  };

  return (
    <MobileUIContext.Provider value={value}>
      {children}
    </MobileUIContext.Provider>
  );
};