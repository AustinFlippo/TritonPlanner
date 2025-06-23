import React from "react";

const LoadingSpinner = ({ size = "6", color = "blue-500", className = "" }) => {
  return (
    <div className={`animate-spin rounded-full h-${size} w-${size} border-t-2 border-b-2 border-${color} ${className}`} />
  );
};

export default LoadingSpinner;