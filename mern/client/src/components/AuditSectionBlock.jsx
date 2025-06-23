import React, { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon, CheckCircleIcon, ClockIcon, XCircleIcon } from 'lucide-react';

const AuditSectionBlock = ({ title, status, items = [] }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Define colors and icons based on status
  const getStatusConfig = (status) => {
    switch (status) {
      case 'fulfilled':
        return {
          bgColor: 'bg-green-50',
          borderColor: 'border-green-200',
          textColor: 'text-green-800',
          headerBg: 'bg-green-100',
          icon: CheckCircleIcon,
          iconColor: 'text-green-600',
          badgeText: 'Complete',
          badgeBg: 'bg-green-100',
          badgeTextColor: 'text-green-700'
        };
      case 'in_progress':
        return {
          bgColor: 'bg-blue-50',
          borderColor: 'border-blue-200',
          textColor: 'text-blue-800',
          headerBg: 'bg-blue-100',
          icon: ClockIcon,
          iconColor: 'text-blue-600',
          badgeText: 'In Progress',
          badgeBg: 'bg-blue-100',
          badgeTextColor: 'text-blue-700'
        };
      case 'not_fulfilled':
      default:
        return {
          bgColor: 'bg-red-50',
          borderColor: 'border-red-200',
          textColor: 'text-red-800',
          headerBg: 'bg-red-100',
          icon: XCircleIcon,
          iconColor: 'text-red-600',
          badgeText: 'Not Fulfilled',
          badgeBg: 'bg-red-100',
          badgeTextColor: 'text-red-700'
        };
    }
  };

  const config = getStatusConfig(status);
  const StatusIcon = config.icon;

  return (
    <div className={`mb-4 rounded-lg border ${config.borderColor} ${config.bgColor} shadow-sm`}>
      {/* Header */}
      <div 
        className={`${config.headerBg} px-4 py-3 rounded-t-lg cursor-pointer`}
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <StatusIcon className={`h-5 w-5 ${config.iconColor}`} />
            <h3 className={`font-medium ${config.textColor}`}>{title}</h3>
          </div>
          <div className="flex items-center space-x-2">
            <span className={`px-2 py-1 text-xs font-medium rounded-full ${config.badgeBg} ${config.badgeTextColor}`}>
              {config.badgeText}
            </span>
            {isCollapsed ? (
              <ChevronRightIcon className="h-4 w-4 text-gray-500" />
            ) : (
              <ChevronDownIcon className="h-4 w-4 text-gray-500" />
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      {!isCollapsed && (
        <div className="px-4 py-3">
          {items.length > 0 ? (
            <ul className="space-y-2">
              {items.map((item, index) => (
                <li 
                  key={index} 
                  className={`text-sm ${config.textColor} flex items-start`}
                >
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                  <span className="leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={`text-sm ${config.textColor} italic`}>
              No items found for this section.
            </p>
          )}
          
          {/* Item count */}
          <div className="mt-3 pt-2 border-t border-gray-200">
            <p className="text-xs text-gray-600">
              {items.length} {items.length === 1 ? 'item' : 'items'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditSectionBlock;