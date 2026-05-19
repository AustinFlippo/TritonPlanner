import { useState } from 'react';

const STATUS_CONFIG = {
  fulfilled:     { accent: '#16a34a', badge: { background: '#dcfce7', color: '#16a34a' }, label: 'Done' },
  in_progress:   { accent: '#ca8a04', badge: { background: '#fef9c3', color: '#ca8a04' }, label: 'In Progress' },
  not_fulfilled: { accent: '#dc2626', badge: { background: '#fee2e2', color: '#dc2626' }, label: 'Remaining' },
};

const isCourseCompleted = (item) => {
  if (!item || typeof item !== 'string') return false;
  if (item.includes('NEEDS:') || item.includes('Available:')) return false;
  const gradeMatch = item.match(/\([^,)]+,\s*([^)]+)\)$/);
  if (!gradeMatch) return false;
  const grade = gradeMatch[1].trim().toLowerCase();
  return grade && grade !== 'nr' && grade !== 'wip' && !grade.includes('wip') && !grade.includes('progress');
};

const AuditAccordionSection = ({ title, status, items }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const cfg = STATUS_CONFIG[status] ?? { accent: '#cbd5e1', badge: { background: '#f1f5f9', color: '#64748b' }, label: 'Unknown' };

  return (
    <div style={{ border: '1px solid #e2e8f0', borderLeft: `3px solid ${cfg.accent}`, borderRadius: '7px', overflow: 'hidden' }}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ width: '100%', padding: '8px 10px', background: 'white', border: 'none', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
      >
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transition: 'transform 0.15s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span style={{ flex: 1, fontSize: '11px', fontWeight: 600, color: '#003366', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        <span style={{ ...cfg.badge, fontSize: '9px', fontWeight: 700, padding: '2px 7px', borderRadius: '999px', flexShrink: 0 }}>
          {cfg.label}
        </span>
      </button>

      {isExpanded && (
        <div style={{ background: '#f8fafc', borderTop: '1px solid #e2e8f0', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {items.length > 0 ? items.map((item, i) => {
            const completed = isCourseCompleted(item);
            return (
              <div
                key={i}
                style={{
                  background: completed ? '#f0fdf4' : 'white',
                  border: `1px solid ${completed ? '#bbf7d0' : '#e2e8f0'}`,
                  borderRadius: '5px',
                  padding: '5px 8px',
                  fontSize: '11px',
                  color: completed ? '#166534' : '#475569',
                  lineHeight: 1.4,
                }}
              >
                {completed && <span style={{ marginRight: '5px', color: '#16a34a', fontWeight: 700 }}>✓</span>}
                {item}
              </div>
            );
          }) : (
            <div style={{ textAlign: 'center', fontSize: '11px', color: '#94a3b8', padding: '8px 0' }}>No courses</div>
          )}
        </div>
      )}
    </div>
  );
};

export default AuditAccordionSection;
