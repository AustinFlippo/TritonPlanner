import React from "react";

const QUARTER_LABELS = { FA: "Fall", WI: "Win", SP: "Spr" };
const QUARTER_STYLE = { fontSize: '9px', padding: '1px 5px', borderRadius: '999px', fontWeight: 600, background: '#e0f0ff', color: '#0066cc' };

const CourseItem = ({ course, onDragStart, onDragEnd, onDoubleClick }) => {
  const prereq = Array.isArray(course.prerequisites)
    ? course.prerequisites.length > 0 ? course.prerequisites.join(", ") : "None"
    : typeof course.prerequisites === "string" && course.prerequisites.trim()
      ? course.prerequisites
      : "None";

  const offerings = Array.isArray(course.offerings) ? course.offerings : [];

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, course)}
      onDragEnd={onDragEnd}
      onDoubleClick={() => onDoubleClick?.(course)}
      style={{
        background: 'white',
        border: '1px solid #e2e8f0',
        borderLeft: '3px solid #0066cc',
        borderRadius: '7px',
        padding: '8px 10px',
        cursor: 'grab',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '6px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#003366', marginBottom: '1px' }}>
            {course.course_id}
          </div>
          <div style={{ fontSize: '11px', color: '#475569', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {course.course_name}
          </div>
        </div>
        <span style={{ background: '#e0f0ff', color: '#0066cc', fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '999px', flexShrink: 0 }}>
          {course.credits ? Number(course.credits).toFixed(1) : "0.0"}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
        {offerings.length > 0 && (
          <div style={{ display: 'flex', gap: '3px' }}>
            {["FA", "WI", "SP"].filter(q => offerings.includes(q)).map(q => (
              <span key={q} style={QUARTER_STYLE}>{QUARTER_LABELS[q]}</span>
            ))}
          </div>
        )}
        {prereq !== "None" && (
          <span style={{ fontSize: '10px', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>
            Pre: {prereq}
          </span>
        )}
      </div>
    </div>
  );
};

export default CourseItem;
