const ProgressSummary = ({ fulfilled, inProgress, notFulfilled, unitsCompleted, completionPercentage }) => {
  return (
    <div>
      {/* Progress bar */}
      <div style={{ background: '#e2e8f0', borderRadius: '999px', height: '6px', marginBottom: '10px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${completionPercentage}%`, background: 'linear-gradient(90deg, #0066cc, #7db8e8)', borderRadius: '999px', transition: 'width 0.3s' }} />
      </div>

      {/* Stat pills */}
      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '10px', background: '#dcfce7', color: '#16a34a', borderRadius: '999px', padding: '2px 8px', fontWeight: 600 }}>
          {fulfilled} done
        </span>
        <span style={{ fontSize: '10px', background: '#fef9c3', color: '#ca8a04', borderRadius: '999px', padding: '2px 8px', fontWeight: 600 }}>
          {inProgress} in progress
        </span>
        <span style={{ fontSize: '10px', background: '#fee2e2', color: '#dc2626', borderRadius: '999px', padding: '2px 8px', fontWeight: 600 }}>
          {notFulfilled} remaining
        </span>
        {unitsCompleted !== undefined && (
          <span style={{ fontSize: '10px', background: '#e0f0ff', color: '#0066cc', borderRadius: '999px', padding: '2px 8px', fontWeight: 600 }}>
            {unitsCompleted} units
          </span>
        )}
      </div>
    </div>
  );
};

export default ProgressSummary;
