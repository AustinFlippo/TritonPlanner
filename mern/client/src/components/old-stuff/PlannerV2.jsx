import React, { useState, useEffect, useRef } from "react";


const FourYearCoursePlannerV2 = () => {
  // Sample course data - in a real app this would come from an API
  const allCourses = [
    {
      id: "cs101",
      name: "Introduction to Computer Science",
      units: 4.0,
      department: "CS",
      prerequisites: [],
      offeredIn: ["fall", "winter", "spring"],
    },
    {
      id: "cs201",
      name: "Data Structures",
      units: 4.0,
      department: "CS",
      prerequisites: ["cs101"],
      offeredIn: ["winter", "spring"],
    },
    {
      id: "cs301",
      name: "Algorithms",
      units: 4.0,
      department: "CS",
      prerequisites: ["cs201", "math201"],
      offeredIn: ["fall", "spring"],
    },
    {
      id: "math101",
      name: "Calculus I",
      units: 4.0,
      department: "MATH",
      prerequisites: [],
      offeredIn: ["fall", "winter", "spring"],
    },
    {
      id: "math201",
      name: "Linear Algebra",
      units: 4.0,
      department: "MATH",
      prerequisites: ["math101"],
      offeredIn: ["winter"],
    },
    {
      id: "eng101",
      name: "Composition",
      units: 4.0,
      department: "ENG",
      prerequisites: [],
      offeredIn: ["fall", "winter", "spring"],
    },
    {
      id: "hist101",
      name: "World History",
      units: 4.0,
      department: "HIST",
      prerequisites: [],
      offeredIn: ["fall", "spring"],
    },
    {
      id: "phys101",
      name: "Physics I",
      units: 4.0,
      department: "PHYS",
      prerequisites: ["math101"],
      offeredIn: ["fall", "winter"],
    },
    {
      id: "chem101",
      name: "Chemistry I",
      units: 4.0,
      department: "CHEM",
      prerequisites: [],
      offeredIn: ["fall", "spring"],
    },
    {
      id: "bio101",
      name: "Biology I",
      units: 4.0,
      department: "BIO",
      prerequisites: [],
      offeredIn: ["winter", "spring"],
    },
    {
      id: "ld-bdaas",
      name: "LD BDAAS CORE",
      units: 4.0,
      department: "CORE",
      prerequisites: [],
      offeredIn: ["fall"],
    },
    {
      id: "breadth-ge",
      name: "Breadth GE",
      units: 4.0,
      department: "GE",
      prerequisites: [],
      offeredIn: ["fall", "winter", "spring"],
    },
    {
      id: "dei",
      name: "DEI",
      units: 4.0,
      department: "DEI",
      prerequisites: [],
      offeredIn: ["fall", "winter", "spring"],
    },
    {
      id: "cce1",
      name: "CCE 1",
      units: 4.0,
      department: "CCE",
      prerequisites: [],
      offeredIn: ["spring"],
    },
    {
      id: "elective",
      name: "Elective",
      units: 4.0,
      department: "ELEC",
      prerequisites: [],
      offeredIn: ["fall", "winter", "spring"],
    },
  ];

  // Define these ChatBox features here, that way other components can dynamically change accordingly
  const [chatHeight, setChatHeight] = useState(300); // Default height in pixels
  const [isChatMinimized, setIsChatMinimized] = useState(false);

  // Initialize 4 years, each with 3 terms (Fall, Winter, Spring), with variable course slots
  const initialSchedule = Array(4)
    .fill()
    .map(() => ({
      fall: Array(3).fill(null),
      winter: Array(3).fill(null),
      spring: Array(3).fill(null),
    }));

  // Application state
  const [schedule, setSchedule] = useState(initialSchedule);
  
  const [yearLabels] = useState([
    "2024-2025",
    "2025-2026",
    "2026-2027",
    "2027-2028",
  ]);
  const [collapsedYears, setCollapsedYears] = useState([
    false,
    false,
    false,
    false,
  ]);


  // Chat feature state
  const [chatMessages, setChatMessages] = useState([]);
  const [currentMessage, setCurrentMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [chatWidth, setChatWidth] = useState(250); // Default width in pixels
  const [isResizing, setIsResizing] = useState(false);
  const chatEndRef = useRef(null);
  const dragHandleRef = useRef(null);


  // Drag and drop state
  const [dragTarget, setDragTarget] = useState({
    yearIndex: null,
    term: null,
    courseIndex: null,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragSource, setDragSource] = useState({
    yearIndex: null,
    term: null,
    courseIndex: null,
    isFromSidebar: true,
  });
  const [previewState, setPreviewState] = useState(null);
  const [invalidDrop, setInvalidDrop] = useState(false);

  // Calculate units for a term
  const calculateTermUnits = (courses) => {
    return courses.reduce((total, course) => {
      return total + (course ? course.units : 0);
    }, 0);
  };

  // Calculate annual units
  const calculateAnnualUnits = (yearIndex) => {
    const year = schedule[yearIndex];
    return (
      calculateTermUnits(year.fall) +
      calculateTermUnits(year.winter) +
      calculateTermUnits(year.spring)
    );
  };

  // Check if a term has at least one empty slot
  const hasEmptySlot = (termCourses) => {
    return termCourses.some((course) => course === null);
  };

  // Check if course is offered in the specified term
  const isCourseOfferedInTerm = (course, term) => {
    if (!course || !course.offeredIn) return true; // If course data is missing, assume it's offered
    return course.offeredIn.includes(term);
  };

  // Find the first empty slot for a displaced course
  const findEmptySlot = (
    currentSchedule,
    skipYearIndex,
    skipTerm,
    skipCourseIndex
  ) => {
    // Try to find an empty slot in the same term first
    const yearIndex = skipYearIndex;
    const term = skipTerm;

    for (let i = 0; i < currentSchedule[yearIndex][term].length; i++) {
      if (
        i !== skipCourseIndex &&
        currentSchedule[yearIndex][term][i] === null
      ) {
        return { yearIndex, term, courseIndex: i };
      }
    }

    // If no empty slot in the same term, try other terms in the same year
    const otherTerms = ["fall", "winter", "spring"].filter((t) => t !== term);
    for (const otherTerm of otherTerms) {
      for (let i = 0; i < currentSchedule[yearIndex][otherTerm].length; i++) {
        if (currentSchedule[yearIndex][otherTerm][i] === null) {
          return { yearIndex, term: otherTerm, courseIndex: i };
        }
      }
    }

    // If still no empty slot, try other years
    for (let yr = 0; yr < 4; yr++) {
      if (yr === yearIndex) continue;

      for (const otherTerm of ["fall", "winter", "spring"]) {
        for (let i = 0; i < currentSchedule[yr][otherTerm].length; i++) {
          if (currentSchedule[yr][otherTerm][i] === null) {
            return { yearIndex: yr, term: otherTerm, courseIndex: i };
          }
        }
      }
    }

    // If all slots are filled (highly unlikely), return null
    return null;
  };

  // Check if a course already exists in the term
  const isCourseInTerm = (courseId, yearIndex, term) => {
    if (!courseId) return false;
    return schedule[yearIndex][term].some(
      (course) => course && course.id === courseId
    );
  };

  // Toggle year collapse
  const toggleYearCollapse = (yearIndex) => {
    const newCollapsedYears = [...collapsedYears];
    newCollapsedYears[yearIndex] = !newCollapsedYears[yearIndex];
    setCollapsedYears(newCollapsedYears);
  };

  // Handle drag start for a course from the sidebar or within planner
  const handleDragStart = (
    event,
    course,
    isFromSidebar = true,
    yearIndex = null,
    term = null,
    courseIndex = null
  ) => {
    event.dataTransfer.setData("course", JSON.stringify(course));
    event.dataTransfer.setData("isFromSidebar", isFromSidebar.toString());

    if (!isFromSidebar) {
      event.dataTransfer.setData("sourceYearIndex", yearIndex.toString());
      event.dataTransfer.setData("sourceTerm", term);
      event.dataTransfer.setData("sourceCourseIndex", courseIndex.toString());
    }

    setIsDragging(true);
    setInvalidDrop(false);
    setDragSource({ yearIndex, term, courseIndex, isFromSidebar, course });
  };

  // Handle drag over for a course slot
  const handleDragOver = (event, yearIndex, term, courseIndex) => {
    event.preventDefault();

    if (isDragging) {
      // Update the current drag target
      if (
        dragTarget.yearIndex !== yearIndex ||
        dragTarget.term !== term ||
        dragTarget.courseIndex !== courseIndex
      ) {
        setDragTarget({ yearIndex, term, courseIndex });

        // Check if the course is offered in this term
        const draggedCourse =
          dragSource.course ||
          (dragSource.yearIndex !== null
            ? schedule[dragSource.yearIndex][dragSource.term][
                dragSource.courseIndex
              ]
            : null);

        const isOfferedInTerm = draggedCourse
          ? isCourseOfferedInTerm(draggedCourse, term)
          : true;
        setInvalidDrop(!isOfferedInTerm);

        // Check if the target slot already has a course
        const existingCourse = schedule[yearIndex][term][courseIndex];

        if (existingCourse && isOfferedInTerm) {
          // Clear any previous preview
          setPreviewState(null);

          // Create a preview of what will happen
          const isFromSidebar = dragSource.isFromSidebar;

          if (!isFromSidebar) {
            // If moving within planner, preview a swap
            setPreviewState({
              sourceYearIndex: dragSource.yearIndex,
              sourceTerm: dragSource.term,
              sourceCourseIndex: dragSource.courseIndex,
              targetYearIndex: yearIndex,
              targetTerm: term,
              targetCourseIndex: courseIndex,
              action: "swap",
              course: existingCourse,
            });
          } else {
            // If dragging from sidebar, find where the displaced course would go
            const newSlot = findEmptySlot(
              schedule,
              yearIndex,
              term,
              courseIndex
            );

            if (newSlot) {
              setPreviewState({
                sourceYearIndex: yearIndex,
                sourceTerm: term,
                sourceCourseIndex: courseIndex,
                targetYearIndex: newSlot.yearIndex,
                targetTerm: newSlot.term,
                targetCourseIndex: newSlot.courseIndex,
                action: "displace",
                course: existingCourse,
              });
            }
          }
        } else {
          // Clear any preview if targeting an empty slot
          setPreviewState(null);
        }
      }
    }
  };

  // Handle drag end
  const handleDragEnd = () => {
    // Reset all drag-related states
    setDragTarget({ yearIndex: null, term: null, courseIndex: null });
    setPreviewState(null);
    setIsDragging(false);
    setInvalidDrop(false);
  };

  // Handle drop into a course slot
  const handleDrop = (event, yearIndex, term, courseIndex) => {
    event.preventDefault();

    // Get course data and source information
    const courseData = event.dataTransfer.getData("course");
    const isFromSidebar =
      event.dataTransfer.getData("isFromSidebar") === "true";

    if (courseData) {
      const course = JSON.parse(courseData);

      // Check if the course is offered in this term
      if (!isCourseOfferedInTerm(course, term)) {
        // Reset drag states but don't perform the drop
        setDragTarget({ yearIndex: null, term: null, courseIndex: null });
        setPreviewState(null);
        setIsDragging(false);
        setInvalidDrop(false);
        return;
      }

      const newSchedule = [...schedule];

      // Check if the drop target already has a course
      const existingCourse = newSchedule[yearIndex][term][courseIndex];

      // If course is coming from another slot in the schedule
      if (!isFromSidebar) {
        const sourceYearIndex = parseInt(
          event.dataTransfer.getData("sourceYearIndex")
        );
        const sourceTerm = event.dataTransfer.getData("sourceTerm");
        const sourceCourseIndex = parseInt(
          event.dataTransfer.getData("sourceCourseIndex")
        );

        // Don't do anything if dropping on the same slot
        if (
          sourceYearIndex === yearIndex &&
          sourceTerm === term &&
          sourceCourseIndex === courseIndex
        ) {
          setDragTarget({ yearIndex: null, term: null, courseIndex: null });
          setIsDragging(false);
          setInvalidDrop(false);
          return;
        }

        // If target has a course, swap the courses instead of replacing
        if (existingCourse) {
          // Swap the courses: move existing course to source location
          newSchedule[sourceYearIndex][sourceTerm][sourceCourseIndex] =
            existingCourse;
        } else {
          // Clear the source position (no swap needed)
          newSchedule[sourceYearIndex][sourceTerm][sourceCourseIndex] = null;
        }
      } else if (existingCourse) {
        // If dragging from sidebar to an occupied slot, find the first empty slot
        const emptySlot = findEmptySlot(
          newSchedule,
          yearIndex,
          term,
          courseIndex
        );

        if (emptySlot) {
          // Move the existing course to the empty slot
          newSchedule[emptySlot.yearIndex][emptySlot.term][
            emptySlot.courseIndex
          ] = existingCourse;
        }
      }

      // Add new course to target position
      newSchedule[yearIndex][term][courseIndex] = course;

      // Check if we need to add a new empty slot
      if (!hasEmptySlot(newSchedule[yearIndex][term])) {
        newSchedule[yearIndex][term].push(null);
      }

      setSchedule(newSchedule);
    }

    // Reset drag states
    setDragTarget({ yearIndex: null, term: null, courseIndex: null });
    setPreviewState(null);
    setIsDragging(false);
    setInvalidDrop(false);
  };

  // Handle removing a course
  const handleRemoveCourse = (yearIndex, term, courseIndex) => {
    const newSchedule = [...schedule];
    newSchedule[yearIndex][term][courseIndex] = null;

    // Check if we need to reduce the number of empty slots
    const termCourses = newSchedule[yearIndex][term];

    // Count empty slots
    const emptySlots = termCourses.filter((course) => course === null).length;

    // If we have more than one empty slot and total slots > 3, remove excess empty slots
    if (emptySlots > 1 && termCourses.length > 3) {
      // Find indices of empty slots
      const emptyIndices = termCourses
        .map((course, index) => (course === null ? index : -1))
        .filter((index) => index !== -1)
        .sort((a, b) => b - a); // Sort in descending order to remove from the end

      // Keep removing empty slots until we have only one empty slot or minimum 3 total slots
      while (emptyIndices.length > 1 && termCourses.length > 3) {
        termCourses.splice(emptyIndices[0], 1);
        emptyIndices.shift();
      }
    }

    setSchedule(newSchedule);
  };

  // Get class for a course slot based on drag state
  const getSlotClassName = (yearIndex, term, courseIndex) => {
    let className = "border rounded mb-2 p-2 ";

    // Check if this is the current drag target
    if (
      dragTarget.yearIndex === yearIndex &&
      dragTarget.term === term &&
      dragTarget.courseIndex === courseIndex
    ) {
      // If invalid drop, show red highlight
      if (invalidDrop) {
        className += "border-red-500 border-2 bg-red-50 ";
      } else {
        className += "border-blue-500 border-2 bg-blue-50 ";
      }
    }

    // Check if this is the destination in a preview
    if (
      previewState &&
      previewState.targetYearIndex === yearIndex &&
      previewState.targetTerm === term &&
      previewState.targetCourseIndex === courseIndex
    ) {
      className += "border-yellow-400 border-2 bg-yellow-50 ";
    }

    return className;
  };

  // Find height of Chat, to adjust the sidebar accordingly
  const effectiveChatHeight = isChatMinimized ? 0 : chatHeight;


  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Main content area - Flexible layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Course Search Sidebar - Left Column */}
        <div className="w-64 p-4 bg-white rounded-lg shadow overflow-y-auto">
          <h2 className="text-xl font-bold mb-4">Course Search</h2>
          <input
            type="text"
            placeholder="Search courses..."
            className="w-full p-2 mb-4 border border-gray-300 rounded"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <div className="space-y-2">
            {filteredCourses.map((course) => (
              <div
                key={course.id}
                className="p-2 bg-gray-50 border border-gray-200 rounded-lg cursor-move hover:bg-gray-100"
                draggable
                onDragStart={(e) => handleDragStart(e, course, true)}
                onDragEnd={handleDragEnd}
              >
                <div className="flex justify-between items-center">
                  <span className="font-bold text-sm">{course.name}</span>
                  <span className="bg-gray-300 text-gray-700 rounded-full px-2 py-1 text-xs">
                    {course.units.toFixed(1)}
                  </span>
                </div>
                <div className="text-xs text-gray-600">
                  <span>
                    {course.id} • {course.department}
                  </span>
                  <span className="ml-2 text-amber-600">
                    Prereq:
                    <span className="text-gray-600 ml-1">
                      {course.prerequisites && course.prerequisites.length > 0
                        ? course.prerequisites.join(", ")
                        : "None"}
                    </span>
                  </span>
                  <span className="ml-2 text-green-600">
                    Offered:
                    {course.offeredIn.includes("fall") && (
                      <span className="ml-1 mr-1">F</span>
                    )}
                    {course.offeredIn.includes("winter") && (
                      <span className="mr-1">W</span>
                    )}
                    {course.offeredIn.includes("spring") && <span>S</span>}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Course Schedule - Middle Column (flexible width) */}
        <div className="flex-1 p-4 bg-white rounded-lg shadow overflow-y-auto mx-2">
          <h2 className="text-xl font-bold mb-4">Four Year Course Schedule</h2>

          {schedule.map((year, yearIndex) => (
            <div
              key={yearIndex}
              className="mb-6 border rounded-lg overflow-hidden"
            >
              {/* Year header with annual units */}
              <div
                className="bg-blue-500 text-white p-3 flex justify-between items-center cursor-pointer"
                onClick={() => toggleYearCollapse(yearIndex)}
              >
                <div className="flex items-center">
                  <span className="mr-2">
                    {collapsedYears[yearIndex] ? "▶" : "▼"}
                  </span>
                  <span className="font-bold">{yearLabels[yearIndex]}</span>
                </div>
                <div className="flex items-center">
                  <span className="mr-2">annual units</span>
                  <span className="bg-white text-blue-500 rounded-full px-3 py-1 font-bold">
                    {calculateAnnualUnits(yearIndex).toFixed(1)}
                  </span>
                </div>
              </div>

              {/* Terms container */}
              {!collapsedYears[yearIndex] && (
                <div className="flex flex-col md:flex-row">
                  {/* Fall Term */}
                  <div className="flex-1 p-2">
                    {/* Term header with units */}
                    <div className="bg-blue-50 p-2 mb-2 flex justify-between items-center rounded">
                      <span className="font-semibold">Fall</span>
                      <div className="flex items-center">
                        <span className="text-sm mr-2">term units</span>
                        <span className="bg-blue-500 text-white rounded-full px-2 py-1 text-sm font-bold">
                          {calculateTermUnits(year.fall).toFixed(1)}
                        </span>
                      </div>
                    </div>

                    {/* Course slots */}
                    {year.fall.map((course, courseIndex) => (
                      <div
                        key={courseIndex}
                        className={getSlotClassName(
                          yearIndex,
                          "fall",
                          courseIndex
                        )}
                        onDragOver={(e) =>
                          handleDragOver(e, yearIndex, "fall", courseIndex)
                        }
                        onDrop={(e) =>
                          handleDrop(e, yearIndex, "fall", courseIndex)
                        }
                      >
                        {course ? (
                          <div
                            className="flex justify-between items-center cursor-move"
                            draggable
                            onDragStart={(e) =>
                              handleDragStart(
                                e,
                                course,
                                false,
                                yearIndex,
                                "fall",
                                courseIndex
                              )
                            }
                            onDragEnd={handleDragEnd}
                          >
                            <span>
                              {course.name}
                              {previewState &&
                                previewState.sourceYearIndex === yearIndex &&
                                previewState.sourceTerm === "fall" &&
                                previewState.sourceCourseIndex ===
                                  courseIndex && (
                                  <span className="ml-2 text-yellow-600 text-xs">
                                    (Moving)
                                  </span>
                                )}
                            </span>
                            <div className="flex items-center">
                              <span className="bg-gray-300 text-gray-700 rounded-full px-2 py-1 text-xs mr-2">
                                {course.units.toFixed(1)}
                              </span>
                              <button
                                onClick={() =>
                                  handleRemoveCourse(
                                    yearIndex,
                                    "fall",
                                    courseIndex
                                  )
                                }
                                className="text-red-500 hover:text-red-700 text-xs"
                              >
                                ×
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="text-gray-400 text-center py-1">
                            {invalidDrop &&
                            dragTarget.yearIndex === yearIndex &&
                            dragTarget.term === "fall" &&
                            dragTarget.courseIndex === courseIndex ? (
                              <div className="text-red-600">
                                Course not offered in Fall
                              </div>
                            ) : previewState &&
                              previewState.targetYearIndex === yearIndex &&
                              previewState.targetTerm === "fall" &&
                              previewState.targetCourseIndex === courseIndex ? (
                              <div className="text-yellow-600">
                                {previewState.course.name} (Preview)
                              </div>
                            ) : (
                              "Drop course here"
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Winter Term */}
                  <div className="flex-1 p-2">
                    <div className="bg-blue-50 p-2 mb-2 flex justify-between items-center rounded">
                      <span className="font-semibold">Winter</span>
                      <div className="flex items-center">
                        <span className="text-sm mr-2">term units</span>
                        <span className="bg-blue-500 text-white rounded-full px-2 py-1 text-sm font-bold">
                          {calculateTermUnits(year.winter).toFixed(1)}
                        </span>
                      </div>
                    </div>

                    {year.winter.map((course, courseIndex) => (
                      <div
                        key={courseIndex}
                        className={getSlotClassName(
                          yearIndex,
                          "winter",
                          courseIndex
                        )}
                        onDragOver={(e) =>
                          handleDragOver(e, yearIndex, "winter", courseIndex)
                        }
                        onDrop={(e) =>
                          handleDrop(e, yearIndex, "winter", courseIndex)
                        }
                      >
                        {course ? (
                          <div
                            className="flex justify-between items-center cursor-move"
                            draggable
                            onDragStart={(e) =>
                              handleDragStart(
                                e,
                                course,
                                false,
                                yearIndex,
                                "winter",
                                courseIndex
                              )
                            }
                            onDragEnd={handleDragEnd}
                          >
                            <span>
                              {course.name}
                              {previewState &&
                                previewState.sourceYearIndex === yearIndex &&
                                previewState.sourceTerm === "winter" &&
                                previewState.sourceCourseIndex ===
                                  courseIndex && (
                                  <span className="ml-2 text-yellow-600 text-xs">
                                    (Moving)
                                  </span>
                                )}
                            </span>
                            <div className="flex items-center">
                              <span className="bg-gray-300 text-gray-700 rounded-full px-2 py-1 text-xs mr-2">
                                {course.units.toFixed(1)}
                              </span>
                              <button
                                onClick={() =>
                                  handleRemoveCourse(
                                    yearIndex,
                                    "winter",
                                    courseIndex
                                  )
                                }
                                className="text-red-500 hover:text-red-700 text-xs"
                              >
                                ×
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="text-gray-400 text-center py-1">
                            {invalidDrop &&
                            dragTarget.yearIndex === yearIndex &&
                            dragTarget.term === "winter" &&
                            dragTarget.courseIndex === courseIndex ? (
                              <div className="text-red-600">
                                Course not offered in Winter
                              </div>
                            ) : previewState &&
                              previewState.targetYearIndex === yearIndex &&
                              previewState.targetTerm === "winter" &&
                              previewState.targetCourseIndex === courseIndex ? (
                              <div className="text-yellow-600">
                                {previewState.course.name} (Preview)
                              </div>
                            ) : (
                              "Drop course here"
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Spring Term */}
                  <div className="flex-1 p-2">
                    <div className="bg-blue-50 p-2 mb-2 flex justify-between items-center rounded">
                      <span className="font-semibold">Spring</span>
                      <div className="flex items-center">
                        <span className="text-sm mr-2">term units</span>
                        <span className="bg-blue-500 text-white rounded-full px-2 py-1 text-sm font-bold">
                          {calculateTermUnits(year.spring).toFixed(1)}
                        </span>
                      </div>
                    </div>

                    {year.spring.map((course, courseIndex) => (
                      <div
                        key={courseIndex}
                        className={getSlotClassName(
                          yearIndex,
                          "spring",
                          courseIndex
                        )}
                        onDragOver={(e) =>
                          handleDragOver(e, yearIndex, "spring", courseIndex)
                        }
                        onDrop={(e) =>
                          handleDrop(e, yearIndex, "spring", courseIndex)
                        }
                      >
                        {course ? (
                          <div
                            className="flex justify-between items-center cursor-move"
                            draggable
                            onDragStart={(e) =>
                              handleDragStart(
                                e,
                                course,
                                false,
                                yearIndex,
                                "spring",
                                courseIndex
                              )
                            }
                            onDragEnd={handleDragEnd}
                          >
                            <span>
                              {course.name}
                              {previewState &&
                                previewState.sourceYearIndex === yearIndex &&
                                previewState.sourceTerm === "spring" &&
                                previewState.sourceCourseIndex ===
                                  courseIndex && (
                                  <span className="ml-2 text-yellow-600 text-xs">
                                    (Moving)
                                  </span>
                                )}
                            </span>
                            <div className="flex items-center">
                              <span className="bg-gray-300 text-gray-700 rounded-full px-2 py-1 text-xs mr-2">
                                {course.units.toFixed(1)}
                              </span>
                              <button
                                onClick={() =>
                                  handleRemoveCourse(
                                    yearIndex,
                                    "spring",
                                    courseIndex
                                  )
                                }
                                className="text-red-500 hover:text-red-700 text-xs"
                              >
                                ×
                              </button>
                            </div>


                          </div>
                        ) : (
                          <div className="text-gray-400 text-center py-1">
                            {invalidDrop &&
                            dragTarget.yearIndex === yearIndex &&
                            dragTarget.term === "spring" &&
                            dragTarget.courseIndex === courseIndex ? (
                              <div className="text-red-600">
                                Course not offered in Spring
                              </div>
                            ) : previewState &&
                              previewState.targetYearIndex === yearIndex &&
                              previewState.targetTerm === "spring" &&
                              previewState.targetCourseIndex === courseIndex ? (
                              <div className="text-yellow-600">
                                {previewState.course.name} (Preview)
                              </div>
                            ) : (
                              "Drop course here"
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          
          
        </div>


        {/* Chat Panel - Right Column */}
        <div
          className="bg-white rounded-lg shadow overflow-hidden flex flex-col relative"
          style={{ width: `${chatWidth}px` }}
        >
          {/* Resize handle on the left side */}
          <div
            className="absolute top-0 left-0 h-full w-2 bg-gray-300 hover:bg-blue-300 cursor-ew-resize z-10"
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startWidth = chatWidth;

              const handleMouseMove = (moveEvent) => {
                const deltaX = startX - moveEvent.clientX;
                const newWidth = Math.max(
                  40,
                  Math.min(500, startWidth + deltaX)
                );
                setChatWidth(newWidth);
              };

              const handleMouseUp = () => {
                document.removeEventListener("mousemove", handleMouseMove);
                document.removeEventListener("mouseup", handleMouseUp);
                setIsResizing(false);
              };

              setIsResizing(true);
              document.addEventListener("mousemove", handleMouseMove);
              document.addEventListener("mouseup", handleMouseUp);
            }}
          ></div>

          {/* Chat header - Removed minimize button */}
          <div className="bg-blue-500 text-white p-2">
            <h3 className="font-bold ml-2">Course Assistant</h3>
          </div>

          {/* Chat content area */}
          <div className="flex flex-col flex-grow">
            <div className="flex-grow p-3 overflow-y-auto bg-gray-50">
              {chatMessages.length === 0 ? (
                <div className="text-center text-gray-500 mt-4">
                  <p>Ask me anything about courses!</p>
                  <p className="text-sm mt-2">For example:</p>
                  <ul className="text-sm mt-1 text-blue-500">
                    <li
                      className="cursor-pointer hover:underline"
                      onClick={() =>
                        setCurrentMessage(
                          "What prerequisites do I need for CS301?"
                        )
                      }
                    >
                      What prerequisites do I need for CS301?
                    </li>
                    <li
                      className="cursor-pointer hover:underline mt-1"
                      onClick={() =>
                        setCurrentMessage("Which terms is Math 201 offered in?")
                      }
                    >
                      Which terms is Math 201 offered in?
                    </li>
                    <li
                      className="cursor-pointer hover:underline mt-1"
                      onClick={() =>
                        setCurrentMessage(
                          "Suggest courses for data science as a first year"
                        )
                      }
                    >
                      Suggest courses for data science as a first year
                    </li>
                  </ul>
                </div>
              ) : (
                <div className="space-y-3">
                  {chatMessages.map((msg, index) => (
                    <div
                      key={index}
                      className={`p-2 rounded-lg max-w-[85%] ${
                        msg.role === "user"
                          ? "ml-auto bg-blue-100 text-blue-800"
                          : "bg-gray-200 text-gray-800"
                      }`}
                    >
                      {msg.content}
                    </div>
                  ))}
                  {isLoading && (
                    <div className="bg-gray-200 text-gray-800 p-2 rounded-lg max-w-[85%]">
                      <div className="flex space-x-2">
                        <div className="h-2 w-2 bg-gray-500 rounded-full animate-bounce"></div>
                        <div className="h-2 w-2 bg-gray-500 rounded-full animate-bounce delay-75"></div>
                        <div className="h-2 w-2 bg-gray-500 rounded-full animate-bounce delay-150"></div>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>

            <div className="p-2 border-t">
              <div className="flex">
                <input
                  type="text"
                  placeholder="Type your question here..."
                  className="flex-grow p-2 border rounded-l focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={currentMessage}
                  onChange={(e) => setCurrentMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  disabled={isLoading}
                />
                <button
                  className={`px-4 py-2 rounded-r ${
                    isLoading || !currentMessage.trim()
                      ? "bg-gray-300 cursor-not-allowed"
                      : "bg-blue-500 hover:bg-blue-600 text-white"
                  }`}
                  onClick={sendMessage}
                  disabled={isLoading || !currentMessage.trim()}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>


    </div>
  );
};

export default FourYearCoursePlannerV2;
