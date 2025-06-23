// Test script to verify WORK IN PROGRESS logic
import { parseTermToCoordinates, parseCourseFromAuditItem, convertAuditToPlanner } from './utils/auditCoursePlanner.js';

console.log('🧪 Testing WORK IN PROGRESS course logic...\n');

// Test 1: Summer session filtering (should be filtered out)
console.log('1. Testing summer session filtering (should be FILTERED OUT):');
const summerTerms = ['S325', 'S123', 'SU24', 'S1', 'S2', 'SM25'];
summerTerms.forEach(term => {
  const result = parseTermToCoordinates(term);
  console.log(`   ${term}: ${result ? '❌ ALLOWED (ERROR!)' : '✅ FILTERED OUT'}`);
});

// Test 2: Valid term parsing (should be allowed)
console.log('\n2. Testing valid term parsing (should be ALLOWED):');
const validTerms = ['FA24', 'WI25', 'SP25', 'FA25', 'SP24', 'SP26'];
validTerms.forEach(term => {
  const result = parseTermToCoordinates(term);
  console.log(`   ${term}: ${result ? `✅ Year ${result.yearIndex}, ${result.quarter}` : '❌ FAILED'}`);
});

// Test 3: Course item parsing
console.log('\n3. Testing course item parsing:');
const courseItems = [
  'DSC 30 - DataStrc/Algrthms for Data Sc (SP25, NR)',      // Should be placed (Spring)
  'EAP 100 - Education Abroad Program (S325, WIP)',         // Should be filtered (Summer)
  'CCE 2 - Cultivat/CommInformedPractice (FA25, WIP)',      // Should be placed (Fall)
  'DSC 40A - Theor Fndtns of Data Sci I (FA25, WIP)',       // Should be placed (Fall)
  'MATH 20A - Calculus (SP24, B+)'                          // Should be placed (Spring)
];

courseItems.forEach(item => {
  const parsed = parseCourseFromAuditItem(item);
  if (parsed) {
    const coords = parseTermToCoordinates(parsed.term);
    const expected = parsed.term.startsWith('S3') || parsed.term === 'S325' ? 'FILTERED' : 'PLACED';
    const actual = coords ? 'PLACED' : 'FILTERED';
    const status = expected === actual ? '✅' : '❌';
    console.log(`   ${status} ${parsed.course_id} (${parsed.term}): ${actual} (expected: ${expected})`);
  }
});

// Test 4: Full section processing
console.log('\n4. Testing full WORK IN PROGRESS section processing:');
const mockWipSection = {
  title: 'WORK IN PROGRESS',
  status: 'in_progress',
  items: [
    'DSC 30 - DataStrc/Algrthms for Data Sc (SP25, NR)',     // Should be placed (Spring)
    'EAP 100 - Education Abroad Program (S325, WIP)',        // Should be filtered (Summer)
    'CCE 2 - Cultivat/CommInformedPractice (FA25, WIP)',     // Should be placed (Fall)
    'DSC 40A - Theor Fndtns of Data Sci I (FA25, WIP)',      // Should be placed (Fall)
    'MATH 18 - Linear Algebra (SP24, WIP)'                   // Should be placed (Spring)
  ]
};

const plannerCourses = convertAuditToPlanner([mockWipSection]);
console.log(`   Input: ${mockWipSection.items.length} courses`);
console.log(`   Output: ${plannerCourses.length} courses added to planner`);
console.log('   Courses added:');
plannerCourses.forEach(course => {
  console.log(`     - ${course.course_id} (Year ${course.yearIndex}, ${course.quarter}, ${course.status})`);
});

console.log('\n✅ Test complete! Check above results to verify logic is working correctly.');