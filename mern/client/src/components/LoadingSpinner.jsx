import React from "react";
import { Loader2 } from "lucide-react";

// Note: Tailwind can't see dynamically-built class names, so the spinner uses
// a fixed style instead of interpolated size/color classes.
const LoadingSpinner = ({ className = "" }) => {
  return (
    <Loader2 className={`w-5 h-5 animate-spin text-navy-500 ${className}`} />
  );
};

export default LoadingSpinner;
