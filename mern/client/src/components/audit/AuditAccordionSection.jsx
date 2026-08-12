import {
  ChevronDown,
  ChevronRight,
  Check,
  CheckCircle2,
  GripVertical,
} from 'lucide-react';
import { AUDIT_REQUIREMENT_DRAG_TYPE } from '../../utils/recommendations';

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

  const getStatusConfig = (status, informational = false) => {
    if (informational) {
      return {
        badge: 'INFO ONLY',
        badgeStyle: 'bg-gray-100 text-gray-800 border border-gray-200',
        icon: 'ℹ️'
      };
    }
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

  const requirementResults = (projection?.requirementResults || []).filter(
    (requirement) => {
      const isOpen =
        requirement.status !== 'fulfilled' &&
        requirement.needType &&
        Number(requirement.needAmount) > 0;
      // Fulfilled / list-less rows still earn a block when the audit already
      // applied courses to them — otherwise Arts completions like MUS 20R
      // fall through to a flat "Breadth" dump under the open NEEDS rows.
      const hasCompleted = (requirement.completedCourses || []).length > 0;
      return isOpen || hasCompleted;
    }
  );
  // Audit "Elective Courses" dumps have no NEEDS — not a requirement to fill.
  const informational =
    status === 'unknown' &&
    !projection?.verified &&
    !projection?.projected &&
    requirementResults.length === 0;
  const statusConfig = getStatusConfig(status, informational);
  // Courses already nested under a subcategory shouldn't also appear in the
  // leftover flat list. Older saved audits without completedCourses keep the
  // previous flat rendering via this fallback.
  const nestedCompletedDisplays = new Set(
    (projection?.requirementResults || []).flatMap((requirement) =>
      (requirement.completedCourses || []).map(
        (course) => course.display || course
      )
    )
  );
  const detailItems = items.filter(
    (item) =>
      typeof item === 'string' &&
      !item.includes('NEEDS:') &&
      !item.includes('Available:') &&
      !nestedCompletedDisplays.has(item)
  );
  const hasPlanCoverage = requirementResults.some(
    (requirement) => requirement.matchedCourses?.length > 0
  );
  const newlyProjected = projection?.projected && !projection?.verified;
  const searchableRequirements = requirementResults.filter(
    (requirement) => requirement.availableCodes?.length > 0
  );
  const canSearchByDrag = searchableRequirements.length > 0;

  const remainingFor = (requirement) =>
    Math.max(
      0,
      (Number(requirement.needAmount) || 1) -
        (Number(requirement.progress) || 0)
    );

  // Prefer the audit's subcategory label; fall back to the parent category.
  const displayTitleFor = (requirement) => {
    const subTitle = requirement.title?.trim();
    if (subTitle && subTitle.toLowerCase() !== title.trim().toLowerCase()) {
      return subTitle;
    }
    return title;
  };

  const setRequirementDragData = (event, payload) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(
      AUDIT_REQUIREMENT_DRAG_TYPE,
      JSON.stringify(payload)
    );
    event.dataTransfer.setData(
      'text/plain',
      `Find courses for ${payload.title}`
    );
  };

  const handleCategoryDragStart = (event) => {
    const remaining = searchableRequirements.reduce(
      (total, requirement) => total + remainingFor(requirement),
      0
    );
    const needType =
      searchableRequirements.length === 1
        ? searchableRequirements[0].needType
        : 'requirements';
    setRequirementDragData(event, {
      title,
      codes: [
        ...new Set(
          searchableRequirements.flatMap(
            (requirement) => requirement.availableCodes || []
          )
        ),
      ],
      needs:
        needType === 'requirements'
          ? `${searchableRequirements.length} requirements`
          : remaining > 0
            ? `${remaining} ${needType === 'units' ? 'units' : 'courses'}`
            : null,
    });
  };

  const handleSubrequirementDragStart = (event, requirement) => {
    event.stopPropagation();
    const remaining = remainingFor(requirement);
    const unit = requirement.needType === 'units' ? 'units' : 'courses';
    setRequirementDragData(event, {
      title: displayTitleFor(requirement),
      codes: [...(requirement.availableCodes || [])],
      needs: remaining > 0 ? `${remaining} ${unit}` : null,
    });
  };

  // Green only when the subcategory is fully done (audit) or the plan covers
  // the full need. Anything short of that → amber/yellow.
  const isFullyCovered = (requirement) =>
    requirement.status === 'fulfilled' || requirement.projected === true;

  const subrequirementTone = (requirement) => {
    if (isFullyCovered(requirement)) {
      return {
        row: 'border-emerald-200 bg-emerald-50/70',
        title: 'text-emerald-600',
        body: 'text-emerald-700',
      };
    }
    return {
      row: 'border-amber-300 bg-amber-50/80',
      title: 'text-amber-700',
      body: 'text-amber-800',
    };
  };

  const coverageText = (requirement) => {
    if (requirement.status === 'fulfilled') {
      return 'Completed';
    }
    const needed = Number(requirement.needAmount) || 1;
    const covered = Math.min(needed, Number(requirement.progress) || 0);
    const unit = requirement.needType === 'units' ? 'unit' : 'course';
    const label = requirement.title?.trim();
    const completedCount = (requirement.completedCourses || []).length;
    // "1 Art course" when the subcategory has its own short title; otherwise
    // stick to plain "1 course" (the parent category already labels the block).
    const labeledUnit = (amount) => {
      const plural = amount === 1 ? unit : `${unit}s`;
      if (!label || label.toLowerCase() === title.trim().toLowerCase()) {
        return `${amount} ${plural}`;
      }
      // Avoid "1 ONE COURSE IN ART course" for long audit headings.
      if (label.length > 40 || /\b(course|unit|need|require)\b/i.test(label)) {
        return `${amount} ${plural}`;
      }
      return `${amount} ${label} ${plural}`;
    };
    const completedNote =
      completedCount > 0
        ? ` · ${completedCount} already completed`
        : '';

    if (covered >= needed) {
      return `Covered by your plan · ${labeledUnit(covered)} planned, not completed${completedNote}`;
    }
    if (covered > 0) {
      return `${labeledUnit(needed - covered)} still needed · ${labeledUnit(covered)} covered by your plan${completedNote}`;
    }
    if (!requirement.needType || !(Number(requirement.needAmount) > 0)) {
      return completedCount > 0 ? 'Completed' : 'No open requirements';
    }
    return `${labeledUnit(needed)} still needed${completedNote}`;
  };

  // "7 required slots" reads very differently from "81 options to choose from",
  // and the old wording ("N audit-listed options") said the same thing for both.
  const optionsSummary = (requirement) => {
    const groups = requirement.groups;
    if (!groups?.length) {
      const n = requirement.availableCodes?.length || 0;
      return n ? `${n} audit-listed option${n === 1 ? '' : 's'}` : null;
    }
    if (requirement.mode === 'all') {
      const withChoice = groups.filter((g) => g.length > 1).length;
      return (
        `${groups.length} required course${groups.length === 1 ? '' : 's'}` +
        (withChoice ? ` · ${withChoice} with a choice` : '')
      );
    }
    const n = groups.flat().length;
    return `choose from ${n} option${n === 1 ? '' : 's'}`;
  };

  // Show the real structure: alternatives joined by "or", slots separated by
  // "+" so an AND-of-ORs never reads as one long flat list.
  const optionsDetail = (requirement) => {
    const groups = requirement.groups;
    if (!groups?.length) return (requirement.availableCodes || []).join(', ');
    return requirement.mode === 'all'
      ? groups.map((g) => g.join(' or ')).join('  +  ')
      : groups.map((g) => g.join(' or ')).join(', ');
  };

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
      {/* Header - Always Visible */}
      <button
        onClick={onToggle}
        draggable={canSearchByDrag}
        onDragStart={handleCategoryDragStart}
        className={`w-full px-3 py-2.5 text-left hover:bg-slate-50 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 ${
          canSearchByDrag ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
        aria-expanded={isExpanded}
        title={
          canSearchByDrag
            ? 'Drag into Course Search to see courses for this category'
            : undefined
        }
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
            {canSearchByDrag && (
              <GripVertical
                className="w-3.5 h-3.5 text-slate-300 flex-shrink-0"
                aria-label="Drag category to Course Search"
              />
            )}
          </div>

          {/* Green check only when the whole category is done (audit) or
              fully covered by the plan. Partial plan coverage → yellow. */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {status === 'fulfilled' ? (
              <CheckCircle2
                className="w-4 h-4 text-emerald-500 fill-emerald-100"
                title="Done"
              />
            ) : newlyProjected ? (
              <CheckCircle2
                className="w-4 h-4 text-emerald-300 fill-emerald-50"
                title="Covered by your plan"
              />
            ) : hasPlanCoverage ? (
              <div
                className="w-2.5 h-2.5 rounded-full bg-amber-400"
                title="Partly covered by your plan — still needs courses"
              />
            ) : informational ? (
              <span
                className="text-[10px] font-medium text-slate-400"
                title="Informational list from the audit — not a graduation requirement"
              >
                info
              </span>
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
            {requirementResults.map((requirement, index) => {
              const canDragRow = requirement.availableCodes?.length > 0;
              const subTitle = requirement.title?.trim();
              const showSubTitle =
                !!subTitle &&
                subTitle.toLowerCase() !== title.trim().toLowerCase();
              const tone = subrequirementTone(requirement);

              return (
                <div
                  key={`requirement-${index}`}
                  draggable={canDragRow}
                  onDragStart={
                    canDragRow
                      ? (event) =>
                          handleSubrequirementDragStart(event, requirement)
                      : undefined
                  }
                  className={`rounded-md border px-2.5 py-2 ${tone.row} ${
                    canDragRow
                      ? 'cursor-grab active:cursor-grabbing hover:border-navy-300'
                      : ''
                  }`}
                  title={
                    canDragRow
                      ? 'Drag into Course Search to see courses for this requirement'
                      : undefined
                  }
                >
                  <div className="flex items-start gap-1.5">
                    {canDragRow && (
                      <GripVertical
                        className="w-3.5 h-3.5 mt-0.5 text-slate-300 flex-shrink-0"
                        aria-label="Drag subcategory to Course Search"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      {showSubTitle && (
                        <p
                          className={`text-[11px] font-semibold uppercase tracking-wide mb-0.5 ${tone.title}`}
                        >
                          {subTitle}
                        </p>
                      )}
                      <p
                        className={`text-xs font-medium leading-relaxed ${tone.body}`}
                      >
                        {coverageText(requirement)}
                      </p>
                    </div>
                  </div>
                  {(requirement.completedCourses?.length > 0 ||
                    requirement.matchedCourses?.length > 0) && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {(requirement.completedCourses || []).map((course) => (
                        <span
                          key={`done-${course.course_id || course.display}`}
                          className="inline-flex items-center gap-1 rounded bg-white/80 border border-emerald-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-700"
                          title={course.display || undefined}
                        >
                          <Check className="w-3 h-3 text-emerald-500" />
                          {course.course_id || course}
                          <span className="font-normal text-emerald-700">
                            completed
                          </span>
                        </span>
                      ))}
                      {(requirement.matchedCourses || []).map((course) => (
                        <span
                          key={`plan-${course.course_id}`}
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
                  {/* "all" mode is a checklist: every slot must be filled, and
                      a slot may offer a choice. Rows show that by layout, which
                      beats a sentence plus a "+ means AND" legend — the student
                      can see at a glance what is done and what can be swapped. */}
                  {requirement.mode === 'all' && requirement.groups?.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {requirement.groups.map((group, gi) => {
                        const done = !(requirement.openGroups || []).some(
                          (open) => open.join('|') === group.join('|')
                        );
                        return (
                          <li
                            key={`slot-${gi}`}
                            className="flex items-start gap-1.5 text-[11px] leading-snug"
                          >
                            {done ? (
                              <Check className="w-3 h-3 mt-0.5 flex-shrink-0 text-emerald-500" />
                            ) : (
                              <span className="mt-1 w-2.5 h-2.5 flex-shrink-0 rounded-[3px] border border-slate-300" />
                            )}
                            <span
                              className={
                                done ? 'text-slate-400 line-through' : 'text-slate-700'
                              }
                            >
                              {group.map((code, ci) => (
                                <span key={code}>
                                  {ci > 0 && (
                                    <span className="mx-1 text-[10px] uppercase tracking-wide text-slate-400">
                                      or
                                    </span>
                                  )}
                                  {code}
                                </span>
                              ))}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    requirement.availableCodes?.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[10px] text-slate-500 hover:text-slate-700">
                          {optionsSummary(requirement)}
                          {canDragRow ? ' · drag to search' : ''}
                        </summary>
                        <p className="mt-1 text-[10px] leading-relaxed text-slate-500 break-words">
                          {optionsDetail(requirement)}
                        </p>
                      </details>
                    )
                  )}
                </div>
              );
            })}

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
              {newlyProjected ? (
                <span className="text-[11px] font-semibold tracking-wide text-emerald-500">
                  COVERED BY PLAN
                </span>
              ) : hasPlanCoverage ? (
                <span className="text-[11px] font-semibold tracking-wide text-amber-600">
                  PARTLY COVERED BY PLAN
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
