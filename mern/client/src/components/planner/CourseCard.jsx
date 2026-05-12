const CourseCard = ({ course, onRemove, onDragStart, onDragEnd, isPreviewing = false, onCourseClick }) => {
  if (!course) return null;

  const statusStyles = {
    completed: { bg: '#dcfce7', border: '#16a34a', text: '#166534' },
    current:   { bg: '#fef9c3', border: '#ca8a04', text: '#854d0e' },
    planned:   { bg: '#e0f0ff', border: '#0066cc', text: '#003366' },
  };

  const style = statusStyles[course.status] || { bg: '#f1f5f9', border: '#cbd5e1', text: '#475569' };

  return (
    <div
      className="flex justify-between items-center cursor-move rounded"
      style={{
        padding: '5px 8px',
        background: style.bg,
        border: `1px solid ${style.border}`,
        borderLeft: `3px solid ${style.border}`,
        opacity: isPreviewing ? 0.55 : 1,
        borderRadius: '6px',
      }}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        e.stopPropagation();
        if (onCourseClick) onCourseClick(course);
      }}
    >
      <div>
        <div style={{ fontSize: '12px', fontWeight: 600, color: style.text }}>
          {course.course_id}
          {isPreviewing && <span style={{ marginLeft: '6px', fontSize: '10px', color: '#ca8a04' }}>(Moving)</span>}
        </div>
        {course.grade && course.status === 'completed' && (
          <div style={{ fontSize: '10px', color: style.text, opacity: 0.7 }}>Grade: {course.grade}</div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <span style={{ background: style.border, color: 'white', borderRadius: '999px', padding: '1px 7px', fontSize: '10px', fontWeight: 600 }}>
          {course.credits.toFixed(1)}u
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{ color: '#94a3b8', fontSize: '14px', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}
          title="Remove"
        >
          ×
        </button>
      </div>
    </div>
  );
};

export default CourseCard;
