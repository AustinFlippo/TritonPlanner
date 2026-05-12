import ProfessorInfo from "../right-sidebar/ProfessorInfo";

const CourseDetailOverlay = ({ course, parsedCourseData, onDismiss }) => {
  if (!course) return null;

  const normId = (s) => s?.replace(/\s+/g, ' ').trim().toLowerCase() ?? '';

  const matchedRequirements = (parsedCourseData?.sections || []).filter((section) =>
    (section.items || []).some(
      (item) => normId(item.courseId) === normId(course.course_id)
    )
  );

  const getCleanDescription = (desc) => {
    if (!desc) return null;
    const idx = desc.toLowerCase().indexOf("prerequisites:");
    return (idx !== -1 ? desc.substring(0, idx) : desc).replace(/\.$/, '').trim() || null;
  };

  const description = getCleanDescription(course.description);

  return (
    <div
      className="absolute inset-0 flex flex-col bg-white z-10 overflow-y-auto"
      style={{ borderLeft: '3px solid #0066cc', animation: 'slideInRight 0.18s ease-out' }}
    >
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-start justify-between flex-shrink-0" style={{ padding: '12px 14px 10px', borderBottom: '1px solid #e2e8f0' }}>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 800, color: '#003366' }}>{course.course_id}</div>
          {course.course_name && (
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{course.course_name}</div>
          )}
          <div className="flex flex-wrap gap-1 mt-2">
            {course.credits != null && (
              <span style={{ background: '#e0f0ff', color: '#0066cc', fontSize: '10px', padding: '2px 7px', borderRadius: '999px', fontWeight: 600 }}>
                {course.credits} units
              </span>
            )}
            {Array.isArray(course.offerings) && course.offerings.map((q) => (
              <span key={q} style={{ background: '#e0f0ff', color: '#0066cc', fontSize: '10px', padding: '2px 7px', borderRadius: '999px' }}>
                {q}
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Close"
          style={{ color: '#94a3b8', fontSize: '16px', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', marginLeft: '8px', flexShrink: 0 }}
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Requirements satisfied */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, color: '#003366', marginBottom: '6px', letterSpacing: '0.3px' }}>REQUIREMENTS</div>
        {matchedRequirements.length > 0 ? (
          <div className="flex flex-col gap-1">
            {matchedRequirements.map((section, i) => (
              <div key={i} style={{ background: '#dcfce7', borderRadius: '5px', padding: '5px 8px', fontSize: '11px', color: '#166534', fontWeight: 500 }}>
                ✓ {section.title}
              </div>
            ))}
          </div>
        ) : parsedCourseData?.sections?.length > 0 ? (
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>No requirements matched.</div>
        ) : (
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>Upload an audit to see requirement matches.</div>
        )}
      </div>

      {/* Prerequisites */}
      {course.prerequisites != null && (
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#003366', marginBottom: '6px', letterSpacing: '0.3px' }}>PREREQUISITES</div>
          <div style={{ fontSize: '11px', color: '#475569' }}>
            {course.prerequisites.trim() === '' ? 'None' : course.prerequisites}
          </div>
        </div>
      )}

      {/* Top professors */}
      {course.professors && course.professors.length > 0 && (
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#003366', marginBottom: '6px', letterSpacing: '0.3px' }}>TOP PROFESSORS</div>
          {course.professors.slice(0, 2).map((prof, idx) => (
            <ProfessorInfo key={idx} professor={prof} />
          ))}
        </div>
      )}

      {/* Description */}
      {description && (
        <div style={{ padding: '10px 14px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#003366', marginBottom: '6px', letterSpacing: '0.3px' }}>DESCRIPTION</div>
          <div style={{ fontSize: '11px', color: '#475569', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {description}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: 'auto', padding: '8px 14px', borderTop: '1px solid #e2e8f0', fontSize: '10px', color: '#94a3b8', textAlign: 'center' }}>
        Click planner to dismiss
      </div>
    </div>
  );
};

export default CourseDetailOverlay;
