import { ChevronDown, ChevronRight, Check, CheckCircle2 } from 'lucide-react';

// Expansion state lives in the parent so "Expand all / Collapse all" works
const AuditAccordionSection = ({
  title,
  status,
  items,
  projection,
  isExpanded,
  onToggle,
}) => {

  // Helper function to determine if a course item is completed based on grade
  const isCourseCompleted = (item) => {
    if (!item || typeof item !== 'string') return false;
    
    // Skip non-course items
    if (item.includes('NEEDS:') || item.includes('Available:')) return false;
    
    // Look for grade pattern in parentheses: (TERM, GRADE)
    const gradeMatch = item.match(/\([^,)]+,\s*([^)]+)\)$/);
    if (!gradeMatch) return false;
    
    const grade = gradeMatch[1].trim().toLowerCase();
    
    // Course is NOT completed if grade is NR, WIP, or contains "progress"
    if (!grade || 
        grade === '' || 
        grade === 'nr' || 
        grade === 'wip' ||
        grade.includes('wip') ||
        grade.includes('progress')) {
      return false;
    }
    
    // Course is completed if it has any other non-empty grade (A, B+, C, etc.)
    return true;
  };

  const getStatusConfig = (status) => {
    switch (status) {
      case 'fulfilled':
        return {
          badge: 'FULFILLED',
          badgeStyle: 'bg-green-100 text-green-800 border border-green-200',
          icon: '✅'
        };
      case 'in_progress':
        return {
          badge: 'IN PROGRESS',
          badgeStyle: 'bg-yellow-100 text-yellow-800 border border-yellow-200',
          icon: '🟨'
        };
      case 'not_fulfilled':
        return {
          badge: 'NOT FULFILLED',
          badgeStyle: 'bg-red-100 text-red-800 border border-red-200',
          icon: '❌'
        };
      default:
        return {
          badge: 'UNKNOWN',
          badgeStyle: 'bg-gray-100 text-gray-800 border border-gray-200',
          icon: '❓'
        };
    }
  };

  const statusConfig = getStatusConfig(status);
  const requirementResults = (projection?.requirementResults || []).filter(
    (requirement) =>
      requirement.status !== 'fulfilled' &&
      requirement.needType &&
      Number(requirement.needAmount) > 0
  );
  const detailItems = items.filter(
    (item) =>
      typeof item !== 'string' ||
      (!item.includes('NEEDS:') && !item.includes('Available:'))
  );
  const hasPlanCoverage = requirementResults.some(
    (requirement) => requirement.matchedCourses?.length > 0
  );
  const newlyProjected = projection?.projected && !projection?.verified;

  const coverageText = (requirement) => {
    const needed = Number(requirement.needAmount) || 1;
    const covered = Math.min(needed, Number(requirement.progress) || 0);
    const unit = requirement.needType === 'units' ? 'unit' : 'course';
    const format = (amount) =>
      `${amount} ${unit}${amount === 1 ? '' : 's'}`;

    if (covered >= needed) {
      return `Covered by your plan · ${format(covered)} planned, not completed`;
    }
    if (covered > 0) {
      return `${format(needed - covered)} still needed · ${format(covered)} covered by your plan`;
    }
    return `${format(needed)} still needed`;
  };

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
      {/* Header - Always Visible */}
      <button
        onClick={onToggle}
        className="w-full px-3 py-2.5 text-left hover:bg-slate-50 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* Toggle Icon */}
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            )}

            {/* Section Title */}
            <h3 className="text-[13px] font-medium text-slate-800 truncate">
              {title}
            </h3>
          </div>

          {/* Done = solid green check; covered by the plan = lighter green
              check; otherwise the usual amber/red dots. */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {status === 'fulfilled' ? (
              <CheckCircle2
                className="w-4 h-4 text-emerald-500 fill-emerald-100"
                title="Done"
              />
            ) : hasPlanCoverage ? (
              <CheckCircle2
                className="w-4 h-4 text-emerald-300 fill-emerald-50"
                title={
                  newlyProjected
                    ? 'Covered by your plan'
                    : 'Partly covered by your plan'
                }
              />
            ) : status === 'in_progress' ? (
              <div className="w-2 h-2 bg-amber-400 rounded-full" title="In progress"></div>
            ) : status === 'not_fulfilled' ? (
              <div className="w-2 h-2 bg-red-400 rounded-full" title="Not fulfilled"></div>
            ) : null}
          </div>
        </div>
      </button>

      {/* Expandable Content */}
      {isExpanded && (
        <div className="px-3 pb-3 bg-slate-50 border-t border-slate-200">
          <div className="space-y-1.5 pt-3">
            {requirementResults.map((requirement, index) => (
              <div
                key={`requirement-${index}`}
                className={`rounded-md border px-2.5 py-2 ${
                  requirement.matchedCourses?.length
                    ? 'border-emerald-200 bg-emerald-50/70'
                    : 'border-red-100 bg-white'
                }`}
              >
                <p
                  className={`text-xs font-medium leading-relaxed ${
                    requirement.matchedCourses?.length
                      ? 'text-emerald-700'
                      : 'text-slate-700'
                  }`}
                >
                  {coverageText(requirement)}
                </p>
                {requirement.matchedCourses?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {requirement.matchedCourses.map((course) => (
                      <span
                        key={course.course_id}
                        className="inline-flex items-center gap-1 rounded bg-white/80 border border-emerald-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-700"
                      >
                        <Check className="w-3 h-3 text-emerald-400" />
                        {course.course_id}
                        <span className="font-normal text-emerald-600">
                          planned
                        </span>
                      </span>
                    ))}
                  </div>
                )}
                {requirement.availableCodes?.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[10px] text-slate-500 hover:text-slate-700">
                      {requirement.availableCodes.length} audit-listed option
                      {requirement.availableCodes.length === 1 ? '' : 's'}
                    </summary>
                    <p className="mt-1 text-[10px] leading-relaxed text-slate-500 break-words">
                      {requirement.availableCodes.join(', ')}
                    </p>
                  </details>
                )}
              </div>
            ))}

            {detailItems.length > 0 ? (
              detailItems.map((item, index) => {
                const isCompleted = isCourseCompleted(item);
                return (
                  <div
                    key={index}
                    className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5"
                  >
                    <p className="text-xs leading-relaxed text-slate-600 flex items-start gap-1.5">
                      {isCompleted && (
                        <Check className="w-3 h-3 mt-0.5 text-emerald-500 flex-shrink-0" />
                      )}
                      <span>{item}</span>
                    </p>
                  </div>
                );
              })
            ) : requirementResults.length === 0 ? (
              <div className="text-center py-4 text-slate-400">
                <p className="text-xs">No courses found</p>
              </div>
            ) : null}
          </div>

          {/* Status Details */}
          <div className="mt-3 pt-2.5 border-t border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-500">Status</span>
              {hasPlanCoverage ? (
                <span className="text-[11px] font-semibold tracking-wide text-emerald-500">
                  {newlyProjected ? 'COVERED BY PLAN' : 'PARTLY COVERED BY PLAN'}
                </span>
              ) : (
                <span className={`text-[11px] font-semibold tracking-wide ${
                  status === 'fulfilled' ? 'text-emerald-600' :
                  status === 'in_progress' ? 'text-amber-600' :
                  'text-red-500'
                }`}>
                  {statusConfig.badge}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditAccordionSection;