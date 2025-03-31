import React, { useState } from "react";

const ProfessorInfo = ({ professor }) => {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="border p-2 rounded-md mb-2 bg-gray-50">
      <div
        onClick={() => setShowDetails(!showDetails)}
        className="cursor-pointer flex justify-between items-center"
      >
        <span className="text-sm font-semibold text-blue-600 hover:underline">
          {professor.name}
        </span>
        <span className="text-sm text-gray-700">⭐ {professor.quality_rating}</span>
      </div>

      {showDetails && (
        <div className="mt-2 text-sm text-gray-600 space-y-1">
          <div><strong>Would take again:</strong> {professor.would_take_again}</div>
          <div><strong>Difficulty:</strong> {professor.difficulty}</div>
          <div><strong>Ratings:</strong> {professor.num_ratings}</div>
          <div><strong>Department:</strong> {professor.department}</div>
          <div>
            <a
              href={professor.profile_link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              View on RateMyProfessors
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProfessorInfo;
