// Device detection utility for mobile vs desktop drag functionality

export const isMobileDevice = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
         (window.innerWidth <= 768);
};

export const isTouchDevice = () => {
  return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
};

export const shouldUseDndKit = () => {
  // Use Dnd Kit only for mobile devices, not just touch devices
  // This ensures desktop computers with touch screens still use HTML5 drag
  const useDndKit = isMobileDevice();
  
  // Debug logging
  console.log('Device detection:', {
    isMobile: isMobileDevice(),
    isTouch: isTouchDevice(),
    windowWidth: window.innerWidth,
    userAgent: navigator.userAgent,
    useDndKit
  });
  
  return useDndKit;
};