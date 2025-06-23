// Course card component for displaying individual courses in the planner

const CourseCard = ({
  course,
  onRemove,
  onDragStart,
  onDragEnd,
  isPreviewing = false,
}) => {
  if (!course) return null;

  // Determine styling based on course status
  const getStatusStyling = (status) => {
    switch (status) {
      case 'completed':
        return {
          container: 'bg-green-100 border-green-300 text-green-800',
          badge: 'bg-green-200 text-green-800',
          statusIndicator: '✓'
        };
      case 'current':
        return {
          container: 'bg-yellow-100 border-yellow-300 text-yellow-800',
          badge: 'bg-yellow-200 text-yellow-800',
          statusIndicator: '⟳'
        };
      case 'planned':
        return {
          container: 'bg-blue-100 border-blue-300 text-blue-800',
          badge: 'bg-blue-200 text-blue-800',
          statusIndicator: '📅'
        };
      default:
        return {
          container: 'bg-gray-100 border-gray-300 text-gray-800',
          badge: 'bg-gray-200 text-gray-700',
          statusIndicator: ''
        };
    }
  };

  const styling = getStatusStyling(course.status);

  return (
    <div
      className={`flex justify-between items-center cursor-move p-2 rounded border ${styling.container} ${
        isPreviewing ? 'opacity-60' : ''
      }`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="flex items-center">
        {course.status && (
          <span className="mr-2 text-xs font-bold">
            {styling.statusIndicator}
          </span>
        )}
        <div>
          <div className="font-medium text-sm">
            {course.course_id}
            {isPreviewing && (
              <span className="ml-2 text-yellow-600 text-xs">(Moving)</span>
            )}
          </div>
          {course.grade && course.status === 'completed' && (
            <div className="text-xs opacity-75">Grade: {course.grade}</div>
          )}
        </div>
      </div>
      <div className="flex items-center">
        <span className={`${styling.badge} rounded-full px-2 py-1 text-xs mr-2 font-medium`}>
          {course.credits.toFixed(1)}u
        </span>
        <button
          onClick={onRemove}
          className="text-red-500 hover:text-red-700 text-xs font-bold"
          title="Remove course"
        >
          ×
        </button>
      </div>
    </div>
  );
};

export default CourseCard;
