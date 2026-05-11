const ProgressSummary = ({ fulfilled, inProgress, notFulfilled, unitsCompleted, completionPercentage }) => {
  return (
    <div>
      <div className="bg-gray-200 rounded-full h-[7px] mb-2.5 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-green-500 to-green-600 rounded-full transition-all duration-300"
          style={{ width: `${completionPercentage}%` }}
        />
      </div>
      <div className="flex gap-1.5 flex-wrap">
        <span className="text-[10px] bg-green-100 text-green-800 rounded-full px-2 py-0.5 font-semibold">
          ✓ {fulfilled} done
        </span>
        <span className="text-[10px] bg-yellow-50 text-yellow-800 rounded-full px-2 py-0.5 font-semibold">
          ⏳ {inProgress} in progress
        </span>
        <span className="text-[10px] bg-red-100 text-red-800 rounded-full px-2 py-0.5 font-semibold">
          ✗ {notFulfilled} remaining
        </span>
        {unitsCompleted !== undefined && (
          <span className="text-[10px] bg-violet-100 text-violet-800 rounded-full px-2 py-0.5 font-semibold">
            📚 {unitsCompleted} units
          </span>
        )}
      </div>
    </div>
  );
};

export default ProgressSummary;
