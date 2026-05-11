import { useState } from 'react';

const AuditAccordionSection = ({ title, status, items }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const isCourseCompleted = (item) => {
    if (!item || typeof item !== 'string') return false;
    if (item.includes('NEEDS:') || item.includes('Available:')) return false;
    const gradeMatch = item.match(/\([^,)]+,\s*([^)]+)\)$/);
    if (!gradeMatch) return false;
    const grade = gradeMatch[1].trim().toLowerCase();
    if (!grade || grade === 'nr' || grade === 'wip' || grade.includes('wip') || grade.includes('progress')) {
      return false;
    }
    return true;
  };

  const statusConfig = {
    fulfilled: {
      border: 'border-l-green-500',
      badge: 'bg-green-100 text-green-800',
      label: 'Done',
    },
    in_progress: {
      border: 'border-l-yellow-500',
      badge: 'bg-yellow-50 text-yellow-800',
      label: 'In Progress',
    },
    not_fulfilled: {
      border: 'border-l-red-500',
      badge: 'bg-red-100 text-red-800',
      label: 'Remaining',
    },
  }[status] ?? {
    border: 'border-l-gray-300',
    badge: 'bg-gray-100 text-gray-700',
    label: 'Unknown',
  };

  return (
    <div className={`border border-gray-200 border-l-[3px] ${statusConfig.border} rounded-lg overflow-hidden`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2.5 text-left hover:bg-gray-50 transition-colors duration-200 focus:outline-none"
      >
        <div className="flex items-center gap-2.5">
          <svg
            className={`w-3 h-3 text-gray-400 flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <polyline points="6 9 12 15 18 9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h3 className="text-sm font-medium text-gray-900 truncate flex-1">{title}</h3>
          <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0 ${statusConfig.badge}`}>
            {statusConfig.label}
          </span>
        </div>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 bg-gray-50 border-t border-gray-200">
          <div className="space-y-1.5 pt-2.5">
            {items.length > 0 ? (
              items.map((item, index) => {
                const isCompleted = isCourseCompleted(item);
                return (
                  <div
                    key={index}
                    className={`rounded border px-3 py-2 ${
                      isCompleted ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'
                    }`}
                  >
                    <p className={`text-xs leading-relaxed ${isCompleted ? 'text-green-800' : 'text-gray-700'}`}>
                      {isCompleted && <span className="mr-1.5 text-green-600 font-bold">✓</span>}
                      {item}
                    </p>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-4">
                <p className="text-xs text-gray-500">No courses found</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditAccordionSection;
