# 🔹 4. LocalStorageSync Documentation

## Overview
**Note**: This documentation describes the local storage functionality that was implemented and then removed from the system per user request. The implementation details are preserved here for reference, but this feature is **not currently active** in the codebase.

## Previous Implementation (Removed)

### Core Files (Previously Modified)
- **Main Container**: `/mern/client/src/components/planner/CoursePlannerContainer.jsx`
- **Storage Key**: `"userSchedule"` in browser localStorage

## Architecture That Was Implemented

### State Initialization with Storage
**Previously in CoursePlannerContainer.jsx:**
```javascript
// Helper function to create default empty schedule
const createDefaultSchedule = () => Array(4).fill().map(() => ({
  fall: Array(3).fill(null),
  winter: Array(3).fill(null),
  spring: Array(3).fill(null),
}));

// Helper function to load schedule from localStorage
const loadScheduleFromStorage = () => {
  try {
    const savedSchedule = localStorage.getItem('userSchedule');
    if (savedSchedule) {
      return JSON.parse(savedSchedule);
    }
  } catch (error) {
    console.error('Error loading schedule from localStorage:', error);
  }
  return createDefaultSchedule();
};

const [schedule, setSchedule] = useState(loadScheduleFromStorage);
```

### Automatic Save Functionality
**Previously implemented auto-save useEffect:**
```javascript
// Effect to save schedule to localStorage whenever it changes
useEffect(() => {
  try {
    localStorage.setItem('userSchedule', JSON.stringify(schedule));
  } catch (error) {
    console.error('Error saving schedule to localStorage:', error);
  }
}, [schedule]);
```

### Clear Schedule Implementation
**Previously implemented clear function:**
```javascript
const handleClearSchedule = () => {
  // Show confirmation dialog
  if (window.confirm('Are you sure you want to clear your entire schedule? This action cannot be undone.')) {
    try {
      // Reset schedule to default empty state
      const emptySchedule = createDefaultSchedule();
      setSchedule(emptySchedule);
      
      // Clear from localStorage
      localStorage.removeItem('userSchedule');
      
      alert('Schedule cleared successfully!');
    } catch (error) {
      console.error('Error clearing schedule:', error);
      alert('Failed to clear schedule. Please try again.');
    }
  }
};
```

### Clear Schedule Button UI
**Previously implemented UI component:**
```javascript
{/* Header with Clear Schedule Button */}
<div className="flex justify-end p-4 mb-2">
  <button
    onClick={handleClearSchedule}
    className="bg-red-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-600 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 flex items-center gap-2"
  >
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
    Clear Schedule
  </button>
</div>
```

## Storage Schema Design

### Data Structure Stored
```javascript
// localStorage key: "userSchedule"
const storedSchedule = {
  // 4-year schedule array
  schedule: [
    {
      fall: [
        {
          course_id: "DSC 100",
          course_name: "Intro to Data Science",
          credits: 4,
          status: "completed",
          grade: "A",
          term: "FA24",
          yearIndex: 0,
          quarter: "fall"
        },
        null, // Empty slot
        null
      ],
      winter: [...],
      spring: [...]
    },
    // ... years 1-3
  ]
};
```

### Serialization Handling
```javascript
// Save process
const scheduleToStore = JSON.stringify(schedule);
localStorage.setItem('userSchedule', scheduleToStore);

// Load process  
const savedSchedule = localStorage.getItem('userSchedule');
const parsedSchedule = JSON.parse(savedSchedule);
```

### Error Handling Approach
```javascript
// Robust save with error handling
try {
  localStorage.setItem('userSchedule', JSON.stringify(schedule));
} catch (error) {
  // Handle quota exceeded, privacy mode, etc.
  console.error('Error saving schedule to localStorage:', error);
  
  if (error.name === 'QuotaExceededError') {
    alert('Storage quota exceeded. Please clear some browser data.');
  }
}

// Robust load with fallback
try {
  const savedSchedule = localStorage.getItem('userSchedule');
  if (savedSchedule) {
    return JSON.parse(savedSchedule);
  }
} catch (error) {
  console.error('Error loading schedule from localStorage:', error);
  // Fall back to empty schedule
  return createDefaultSchedule();
}
```

## Integration Points

### Audit Data Interaction
**Smart audit processing to respect existing data:**
```javascript
// Effect to populate courses from audit data (only if no saved schedule exists)
useEffect(() => {
  if (!parsedCourseData.sections || parsedCourseData.sections.length === 0) {
    return;
  }

  // Check if user has saved data in localStorage
  const hasExistingData = localStorage.getItem('userSchedule');
  if (hasExistingData) {
    console.log('User has saved schedule data, skipping audit auto-population');
    return;
  }

  // Only populate from audit if no saved data exists
  const updatedSchedule = processAuditForPlanner(parsedCourseData.sections, emptySchedule);
  setSchedule(updatedSchedule);
}, [parsedCourseData]);
```

### State Synchronization
**All schedule modifications automatically triggered saves:**
- Drag-and-drop course moves
- Course additions from search
- Course removals
- Audit data population
- Manual schedule edits

### Cross-Session Persistence
```javascript
// User workflow with persistence:
// 1. Upload audit → Schedule populates → Auto-saves
// 2. Close browser → Data persists in localStorage  
// 3. Return later → Schedule loads from localStorage
// 4. Make changes → Auto-saves on each change
// 5. Clear schedule → Removes from localStorage
```

## Clear Schedule Functionality

### Reset Behavior
**Complete state reset included:**
```javascript
const handleClearSchedule = () => {
  if (window.confirm('Are you sure you want to clear your entire schedule?')) {
    // 1. Reset React state to empty
    const emptySchedule = createDefaultSchedule();
    setSchedule(emptySchedule);
    
    // 2. Remove from localStorage
    localStorage.removeItem('userSchedule');
    
    // 3. User feedback
    alert('Schedule cleared successfully!');
  }
};
```

### User Experience Flow
1. **Confirmation Dialog**: Prevents accidental data loss
2. **State Reset**: Returns to fresh, empty 4×3 grid
3. **Storage Cleanup**: Removes saved data completely
4. **Fresh Start**: Next audit upload will populate as if first time

## Current State (Post-Removal)

### What Was Removed
- All localStorage read/write functionality
- Auto-save useEffect hook
- Clear schedule button and handler
- Storage-aware audit processing
- Helper functions for storage management

### Current Behavior
- Schedule state resets on page reload
- No persistence across browser sessions
- Audit data always populates when uploaded
- No clear schedule functionality

### Files Affected by Removal
**CoursePlannerContainer.jsx changes:**
- Removed `createDefaultSchedule()` helper
- Removed `loadScheduleFromStorage()` helper  
- Reverted to simple state initialization
- Removed auto-save useEffect
- Removed clear schedule function
- Removed clear schedule UI
- Restored original audit processing logic

## Technical Considerations

### Browser Compatibility
**localStorage support considerations:**
- Available in all modern browsers
- ~5-10MB storage limit per domain
- Synchronous API (blocking)
- Survives browser restarts but not incognito mode

### Storage Limitations
```javascript
// Typical localStorage constraints:
const STORAGE_LIMIT = 5 * 1024 * 1024; // ~5MB
const SCHEDULE_SIZE = JSON.stringify(schedule).length;

if (SCHEDULE_SIZE > STORAGE_LIMIT * 0.8) {
  console.warn('Schedule approaching storage limit');
}
```

### Privacy Considerations
- Data stored locally in user's browser
- Not transmitted to servers
- Cleared when user clears browser data
- Respects browser privacy settings

### Performance Impact
- **Save Operations**: O(1) for JSON serialization
- **Load Operations**: O(1) for JSON parsing  
- **Memory Usage**: Minimal overhead for schedule data
- **Blocking**: Synchronous operations could block UI

## Alternative Implementations

### AsyncStorage Approach
```javascript
// For React Native or async requirements
const saveScheduleAsync = async (schedule) => {
  try {
    await AsyncStorage.setItem('userSchedule', JSON.stringify(schedule));
  } catch (error) {
    console.error('Async save failed:', error);
  }
};
```

### Server-Side Storage
```javascript
// Alternative: Save to backend database
const saveScheduleToServer = async (schedule) => {
  try {
    await fetch('/api/save-schedule', {
      method: 'POST',
      body: JSON.stringify({ schedule }),
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Server save failed:', error);
  }
};
```

### Hybrid Approach
```javascript
// Combine localStorage with periodic server sync
const hybridSave = async (schedule) => {
  // 1. Immediate local save
  localStorage.setItem('userSchedule', JSON.stringify(schedule));
  
  // 2. Debounced server sync
  debouncedServerSync(schedule);
};
```

## Why It Was Removed

The localStorage functionality was removed because:
1. **User Request**: Explicit request to remove all traces
2. **Complexity**: Added unnecessary state management complexity
3. **Simplicity**: Application works better with fresh state on each session
4. **Audit Focus**: Primary use case is audit upload and planning, not long-term storage