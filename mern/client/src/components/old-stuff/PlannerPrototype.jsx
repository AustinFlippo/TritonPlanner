import React, { useState, useEffect, useRef, useCallback } from "react";
import CourseCard from "../planner/CourseCard";
import TermBlock from "../planner/TermBlock";
import CourseItem from "../right-sidebar/CourseItem"; // or wherever your path is
import CourseSearch from "../right-sidebar/CourseSearch";
import CourseAssistant from "../right-sidebar/CourseAssistant";


const FourYearCoursePlannerV3 = () => {
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
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredCourses, setFilteredCourses] = useState(allCourses);
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

  // Right sidebar state
  const [rightSidebarWidth, setRightSidebarWidth] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
  const [searchSectionHeight, setSearchSectionHeight] = useState(50);

  // Chat feature state
  const [chatMessages, setChatMessages] = useState([]);
  const [currentMessage, setCurrentMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef(null);






  
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

  // NEW: Schedule loading state
  const [isScheduleLoading, setIsScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState(null);
  const [scheduleTemplates, setScheduleTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [graduationInfo, setGraduationInfo] = useState(null);

  // NEW: Fetch available schedule templates on component mount
  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        // In production, replace with actual API call
        // const response = await fetch('http://your-backend-url/api/schedule-templates');

        // For now, just use dummy data
        const dummyTemplates = [
          { id: "cs-standard", name: "Computer Science (Standard)" },
          { id: "cs-ai", name: "Computer Science (AI Focus)" },
          { id: "cs-web", name: "Computer Science (Web Development)" },
          { id: "ds-standard", name: "Data Science" },
        ];

        setScheduleTemplates(dummyTemplates);
        if (dummyTemplates.length > 0) {
          setSelectedTemplate(dummyTemplates[0].id);
        }
      } catch (error) {
        console.error("Error fetching schedule templates:", error);
      }
    };

    fetchTemplates();
  }, []);

  // Update filtered courses when search term changes
  useEffect(() => {
    const filtered = allCourses.filter(
      (course) =>
        course.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        course.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        course.department.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredCourses(filtered);
  }, [searchTerm]);

  // Scroll to bottom of chat when new messages arrive
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages]);

  // NEW: Function to get the graduation term with correct sorting
  const getGraduationTerm = (backendSchedule) => {
    // First step: properly sort the term codes
    const termCodeOrder = {
      // 2024-2025
      FA24: 20240,
      WI25: 20241,
      SP25: 20242,

      // 2025-2026
      FA25: 20250,
      WI26: 20251,
      SP26: 20252,

      // 2026-2027
      FA26: 20260,
      WI27: 20261,
      SP27: 20262,

      // 2027-2028
      FA27: 20270,
      WI28: 20271,
      SP28: 20272,
    };

    // Get all term codes and sort them chronologically
    const sortedTerms = Object.keys(backendSchedule).sort((a, b) => {
      const orderA = termCodeOrder[a] || 0;
      const orderB = termCodeOrder[b] || 0;
      return orderB - orderA; // Descending order, most recent first
    });

    // If no terms, return null
    if (sortedTerms.length === 0) return null;

    // The first term in the sorted list is the most recent one
    const lastTermCode = sortedTerms[0];

    // Map to our schedule format
    const termMapping = {
      // Year 0 (2024-2025)
      FA24: { yearIndex: 0, term: "fall", yearName: "2024-2025" },
      WI25: { yearIndex: 0, term: "winter", yearName: "2024-2025" },
      SP25: { yearIndex: 0, term: "spring", yearName: "2024-2025" },

      // Year 1 (2025-2026)
      FA25: { yearIndex: 1, term: "fall", yearName: "2025-2026" },
      WI26: { yearIndex: 1, term: "winter", yearName: "2025-2026" },
      SP26: { yearIndex: 1, term: "spring", yearName: "2025-2026" },

      // Year 2 (2026-2027)
      FA26: { yearIndex: 2, term: "fall", yearName: "2026-2027" },
      WI27: { yearIndex: 2, term: "winter", yearName: "2026-2027" },
      SP27: { yearIndex: 2, term: "spring", yearName: "2026-2027" },

      // Year 3 (2027-2028)
      FA27: { yearIndex: 3, term: "fall", yearName: "2027-2028" },
      WI28: { yearIndex: 3, term: "winter", yearName: "2027-2028" },
      SP28: { yearIndex: 3, term: "spring", yearName: "2027-2028" },
    };

    const mapping = termMapping[lastTermCode];
    if (!mapping) return null;

    return {
      code: lastTermCode,
      yearIndex: mapping.yearIndex,
      term: mapping.term,
      yearName: mapping.yearName,
      displayName: `${
        mapping.term.charAt(0).toUpperCase() + mapping.term.slice(1)
      } ${mapping.yearName}`,
    };
  };

  // NEW: Function to convert backend schedule format to frontend format
  const convertScheduleFormat = (backendSchedule) => {
    // Initialize empty schedule structure (4 years, each with fall, winter, spring terms)
    const frontendSchedule = Array(4)
      .fill()
      .map(() => ({
        fall: Array(3).fill(null),
        winter: Array(3).fill(null),
        spring: Array(3).fill(null),
      }));

    // Define term mapping
    const termMapping = {
      // Year 0 (2024-2025)
      FA24: { yearIndex: 0, term: "fall" },
      WI25: { yearIndex: 0, term: "winter" },
      SP25: { yearIndex: 0, term: "spring" },

      // Year 1 (2025-2026)
      FA25: { yearIndex: 1, term: "fall" },
      WI26: { yearIndex: 1, term: "winter" },
      SP26: { yearIndex: 1, term: "spring" },

      // Year 2 (2026-2027)
      FA26: { yearIndex: 2, term: "fall" },
      WI27: { yearIndex: 2, term: "winter" },
      SP27: { yearIndex: 2, term: "spring" },

      // Year 3 (2027-2028)
      FA27: { yearIndex: 3, term: "fall" },
      WI28: { yearIndex: 3, term: "winter" },
      SP28: { yearIndex: 3, term: "spring" },
    };

    // Process each term in the backend schedule
    Object.entries(backendSchedule).forEach(([termCode, courses]) => {
      // Get the mapping for this term
      const mapping = termMapping[termCode];

      if (!mapping) {
        console.warn(`Unknown term code: ${termCode}`);
        return; // Skip this term
      }

      const { yearIndex, term } = mapping;

      // For each course in this term, create a proper course object
      courses.forEach((courseName, index) => {
        if (index >= 3) {
          console.warn(
            `More than 3 courses in ${termCode}, only first 3 will be displayed`
          );
          return; // Skip courses beyond the first 3
        }

        // Handle empty courses or placeholders
        if (!courseName || courseName === "N/A" || courseName === "-") {
          return; // Skip this course slot
        }

        // Parse course name to extract department and course number
        const parts = courseName.split(" ");
        const department = parts[0];
        const courseNumber = parts.slice(1).join(" ");

        // Create a course object with the required properties
        const courseObject = {
          id: courseName.replace(" ", ""), // Remove space to create id like "MATH20C"
          name: courseName,
          units: 4.0, // Default to 4.0 units since we don't have this info
          department: department,
          prerequisites: [], // We don't have this info, so use empty array
          offeredIn: ["fall", "winter", "spring"], // Assume offered in all terms as we don't have this info
        };

        // Add the course to the appropriate slot in our schedule
        frontendSchedule[yearIndex][term][index] = courseObject;
      });
    });

    return frontendSchedule;
  };

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

  // NEW: Load schedule from backend
  const loadScheduleFromBackend = async () => {
    setIsScheduleLoading(true);
    setScheduleError(null);

    try {
      // In production, make the actual API call
      // const response = await fetch(`http://your-backend-url/api/schedules/${selectedTemplate}`);
      // if (!response.ok) throw new Error(`Failed to load schedule: ${response.statusText}`);
      // const backendData = await response.json();

      // For demo, using sample data with the student graduating in FA27
      const backendData = {
        WI25: ["MATH 20C", "DSC 30", "CCE 1"],
        SP25: ["DSC 40A", "DSC 80", "CCE 2"],
        FA25: ["DSC 40B", "MATH 181A", "CCE 3"],
        WI26: ["DSC 100", "DSC 102", "CCE 120"],
        SP26: ["DSC 106", "MATH 189", "DSC 140A"],
        FA26: ["DSC 140B", "DSC 148", "PHIL 150"],
        WI27: ["DSC 180A", "PHIL 160", "TDGE 11"],
        SP27: ["DSC 180B", "PHIL 170", "MUS 1A"],
        FA27: ["ANTH 101", "PHIL 180", "MUS 4"],
        // Student graduates after FA27
      };

      // Convert the backend data to frontend format
      const convertedSchedule = convertScheduleFormat(backendData);

      // Get graduation information
      const graduation = getGraduationTerm(backendData);
      if (graduation) {
        setGraduationInfo(graduation);

        // Optionally show a notification or message about graduation timeline
        console.log(
          `This schedule shows courses through ${graduation.displayName}`
        );
      } else {
        setGraduationInfo(null);
      }

      // Update the schedule state
      setSchedule(convertedSchedule);
    } catch (error) {
      console.error("Error loading schedule:", error);
      setScheduleError(
        error.message || "Failed to load schedule. Please try again."
      );
    } finally {
      setIsScheduleLoading(false);
    }
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

  // Send message to FastAPI backend
  const sendMessage = async () => {
    if (!currentMessage.trim()) return;

    const userMessage = { role: "user", content: currentMessage };
    setChatMessages((prevMessages) => [...prevMessages, userMessage]);
    setCurrentMessage("");
    setIsLoading(true);

    try {
      // Call the MERN server endpoint
      const response = await fetch("http://localhost:5050/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: currentMessage,
          thread_id: "default-thread",
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to get response from assistant");
      }

      // Parse the response from the API
      const data = await response.json();

      // Process the response based on the structure from your API
      let assistantContent = "";
      let scheduleData = null;

      // If the response is in the format you showed in the example
      if (data.messages && Array.isArray(data.messages)) {
        // Find the last AI message in the messages array
        const aiMessages = data.messages.filter((msg) => msg.type === "ai");
        if (aiMessages.length > 0) {
          // Get the content from the last AI message
          const lastMessage = aiMessages[aiMessages.length - 1];
          assistantContent = lastMessage.content;

          // Check if the message contains schedule data
          if (lastMessage.schedule) {
            scheduleData = lastMessage.schedule;
          }
        }
      } else {
        // Fallback for other response formats
        assistantContent =
          data.content || data.response || JSON.stringify(data);

        // Check if the response contains schedule data
        if (data.schedule) {
          scheduleData = data.schedule;
        }
      }

      const assistantMessage = {
        role: "assistant",
        content: assistantContent,
      };

      setChatMessages((prevMessages) => [...prevMessages, assistantMessage]);

      // If schedule data is present, update the schedule
      if (scheduleData) {
        try {
          // Convert the schedule data to frontend format
          const convertedSchedule = convertScheduleFormat(scheduleData);

          // Get graduation information
          const graduation = getGraduationTerm(scheduleData);
          if (graduation) {
            setGraduationInfo(graduation);
          } else {
            setGraduationInfo(null);
          }

          // Update the schedule state
          setSchedule(convertedSchedule);
        } catch (error) {
          console.error("Error updating schedule from chat response:", error);
          // Add an error message to the chat
          setChatMessages((prevMessages) => [
            ...prevMessages,
            {
              role: "assistant",
              content:
                "I found schedule data but couldn't update the schedule. Please try again.",
            },
          ]);
        }
      }
    } catch (error) {
      console.error("Error communicating with backend:", error);
      setChatMessages((prevMessages) => [
        ...prevMessages,
        {
          role: "assistant",
          content: "Sorry, I encountered an error. Please try again later.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle key press in chat input
  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Main content area - Flexible layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Course Schedule - Left/Main Column (flexible width) */}
        <div className="flex-1 p-4 bg-white rounded-lg shadow overflow-y-auto mx-2">
          {/* NEW: Add the schedule controls and graduation info */}
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">Four Year Course Schedule</h2>

            <div className="flex items-center space-x-2">
              <select
                className="p-2 border rounded text-sm"
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
                disabled={isScheduleLoading || scheduleTemplates.length === 0}
              >
                {scheduleTemplates.length === 0 ? (
                  <option>Loading templates...</option>
                ) : (
                  scheduleTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))
                )}
              </select>

              <button
                className={`px-4 py-2 rounded text-sm ${
                  isScheduleLoading
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-blue-500 hover:bg-blue-600 text-white"
                }`}
                onClick={loadScheduleFromBackend}
                disabled={isScheduleLoading}
              >
                {isScheduleLoading ? (
                  <span className="flex items-center">
                    <svg
                      className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Loading...
                  </span>
                ) : (
                  "Load Recommended Schedule"
                )}
              </button>
            </div>
          </div>

          {/* NEW: Error message display */}
          {scheduleError && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              {scheduleError}
            </div>
          )}

          {/* NEW: Graduation info */}
          {graduationInfo && (
            <div className="mb-4 bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded relative">
              <div className="flex items-center">
                <svg
                  className="w-5 h-5 mr-2"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0zM6 18a1 1 0 001-1v-2.065a8.935 8.935 0 00-2-.712V17a1 1 0 001 1z" />
                </svg>
                <span>
                  This schedule shows completion in {graduationInfo.displayName}
                </span>
              </div>
            </div>
          )}

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
                  <TermBlock
                    termName="Fall"
                    termKey="fall"
                    courses={year.fall}
                    yearIndex={yearIndex}
                    calculateTermUnits={calculateTermUnits}
                    handleDragOver={handleDragOver}
                    handleDrop={handleDrop}
                    handleDragStart={handleDragStart}
                    handleDragEnd={handleDragEnd}
                    handleRemoveCourse={handleRemoveCourse}
                    getSlotClassName={getSlotClassName}
                    previewState={previewState}
                    dragTarget={dragTarget}
                    invalidDrop={invalidDrop}
                  />

                  {/* Winter Term */}
                  <TermBlock
                    termName="Winter"
                    termKey="winter"
                    courses={year.winter}
                    yearIndex={yearIndex}
                    calculateTermUnits={calculateTermUnits}
                    handleDragOver={handleDragOver}
                    handleDrop={handleDrop}
                    handleDragStart={handleDragStart}
                    handleDragEnd={handleDragEnd}
                    handleRemoveCourse={handleRemoveCourse}
                    getSlotClassName={getSlotClassName}
                    previewState={previewState}
                    dragTarget={dragTarget}
                    invalidDrop={invalidDrop}
                  />

                  {/* Spring Term */}
                  <TermBlock
                    termName="Spring"
                    termKey="spring"
                    courses={year.spring}
                    yearIndex={yearIndex}
                    calculateTermUnits={calculateTermUnits}
                    handleDragOver={handleDragOver}
                    handleDrop={handleDrop}
                    handleDragStart={handleDragStart}
                    handleDragEnd={handleDragEnd}
                    handleRemoveCourse={handleRemoveCourse}
                    getSlotClassName={getSlotClassName}
                    previewState={previewState}
                    dragTarget={dragTarget}
                    invalidDrop={invalidDrop}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Right Sidebar - Contains Course Search and Chat */}
        <div
          className="flex flex-col bg-white rounded-lg shadow overflow-hidden relative"
          style={{ width: `${rightSidebarWidth}px` }}
        >
          {/* Resize handle on the left side */}
          <div
            className="absolute top-0 left-0 h-full w-2 bg-gray-300 hover:bg-blue-300 cursor-ew-resize z-10"
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startWidth = rightSidebarWidth;

              const handleMouseMove = (moveEvent) => {
                const deltaX = startX - moveEvent.clientX;
                const newWidth = Math.max(
                  250,
                  Math.min(500, startWidth + deltaX)
                );
                setRightSidebarWidth(newWidth);
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

          {/* Course Search Section - Top of right sidebar */}
          <div className="overflow-y-auto" style={{ height: `${searchSectionHeight}%` }}>
            <CourseSearch
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              filteredCourses={filteredCourses}
              handleDragStart={handleDragStart}
              handleDragEnd={handleDragEnd}
            />
          </div>


          {/* Divider between search and chat */}
          <div
            className="bg-gray-300 h-1 cursor-ns-resize"
            onMouseDown={(e) => {
              e.preventDefault();
              const startY = e.clientY;
              const startHeight = searchSectionHeight;

              const handleMouseMove = (moveEvent) => {
                const deltaY = moveEvent.clientY - startY;
                const containerHeight = e.target.parentElement.offsetHeight;
                const newHeightPercent = Math.max(
                  20,
                  Math.min(80, startHeight + (deltaY / containerHeight) * 100)
                );
                setSearchSectionHeight(newHeightPercent);
              };

              const handleMouseUp = () => {
                document.removeEventListener("mousemove", handleMouseMove);
                document.removeEventListener("mouseup", handleMouseUp);
              };

              document.addEventListener("mousemove", handleMouseMove);
              document.addEventListener("mouseup", handleMouseUp);
            }}
          />

          {/* Chat Section - Bottom of right sidebar */}
          <CourseAssistant
  chatMessages={chatMessages}
  currentMessage={currentMessage}
  setCurrentMessage={setCurrentMessage}
  isLoading={isLoading}
  sendMessage={sendMessage}
  chatEndRef={chatEndRef}
  onKeyPress={handleKeyPress}
  heightPercentage={100 - searchSectionHeight} // ← add this
/>


        </div>
      </div>
    </div>
  );
};

export default FourYearCoursePlannerV3;
