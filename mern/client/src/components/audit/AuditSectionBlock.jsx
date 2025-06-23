// Component for displaying audit sections in block format

const AuditSectionBlock = ({ title, status, items }) => {
  // Define colors based on status
  const getStatusColors = (status) => {
    switch (status) {
      case 'fulfilled':
        return {
          bg: 'bg-gray-200',
          text: 'text-gray-800',
          border: 'border-gray-300'
        };
      case 'not_fulfilled':
        return {
          bg: 'bg-red-100',
          text: 'text-red-800',
          border: 'border-red-300'
        };
      case 'in_progress':
        return {
          bg: 'bg-blue-100',
          text: 'text-blue-800',
          border: 'border-blue-300'
        };
      default:
        return {
          bg: 'bg-gray-100',
          text: 'text-gray-700',
          border: 'border-gray-200'
        };
    }
  };

  const colors = getStatusColors(status);

  return (
    <div className={`rounded-lg border-2 ${colors.border} ${colors.bg} p-6 mb-4 shadow-sm`}>
      {/* Section Header */}
      <div className="mb-4">
        <h3 className={`text-xl font-bold ${colors.text}`}>
          {title}
        </h3>
        <div className="text-sm text-gray-600 mt-1">
          Status: {status.replace('_', ' ').toUpperCase()}
        </div>
      </div>

      {/* Course List */}
      <div className="space-y-2">
        {items.map((item, index) => (
          <div 
            key={index}
            className={`p-3 rounded ${colors.bg} ${colors.text} border ${colors.border} text-sm`}
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
};

export default AuditSectionBlock;