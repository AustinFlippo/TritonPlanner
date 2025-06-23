#!/usr/bin/env python3
"""
Merge v3 and v4 course data files.
Takes v4 as the base (correct data but lacking credits) and adds v3's credit information.
"""

import json
import sys
from pathlib import Path

def load_json_file(filepath):
    """Load JSON file and return data"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading {filepath}: {e}")
        return None

def create_v5_merged_data(v3_data, v4_data):
    """
    Create v5 by taking v4 as base and adding v3's credit information.
    """
    # Create a lookup dictionary for v3 credits based on normalized_course_id
    v3_credits = {}
    for course in v3_data:
        normalized_id = course.get('normalized_course_id', '').lower()
        if normalized_id:
            v3_credits[normalized_id] = course.get('credits', 'N/A')
    
    print(f"Loaded {len(v3_credits)} courses with credit info from v3")
    
    # Use v4 as base and update credits from v3
    v5_data = []
    credits_updated = 0
    credits_missing = 0
    
    for course in v4_data:
        # Start with v4 course data
        v5_course = course.copy()
        
        # Look up credits from v3
        normalized_id = course.get('normalized_course_id', '').lower()
        if normalized_id in v3_credits:
            v5_course['credits'] = v3_credits[normalized_id]
            credits_updated += 1
        else:
            # Keep v4's credit value (likely "N/A")
            credits_missing += 1
        
        v5_data.append(v5_course)
    
    print(f"Updated credits for {credits_updated} courses")
    print(f"Missing credits for {credits_missing} courses")
    
    return v5_data

def main():
    # File paths
    script_dir = Path(__file__).parent
    v3_path = script_dir / 'v3.json'
    v4_path = script_dir / 'v4.json'
    v5_path = script_dir / 'v5.json'
    
    print("=== Merging v3 and v4 Course Data ===")
    print(f"Loading v3 from: {v3_path}")
    print(f"Loading v4 from: {v4_path}")
    
    # Load data files
    v3_data = load_json_file(v3_path)
    v4_data = load_json_file(v4_path)
    
    if v3_data is None or v4_data is None:
        print("Failed to load required data files")
        return 1
    
    print(f"v3 has {len(v3_data)} courses")
    print(f"v4 has {len(v4_data)} courses")
    
    # Create merged v5 data
    v5_data = create_v5_merged_data(v3_data, v4_data)
    
    # Save v5 data
    try:
        with open(v5_path, 'w', encoding='utf-8') as f:
            json.dump(v5_data, f, indent=2, ensure_ascii=False)
        print(f"✅ Successfully created v5.json with {len(v5_data)} courses")
        print(f"Saved to: {v5_path}")
    except Exception as e:
        print(f"❌ Error saving v5.json: {e}")
        return 1
    
    # Create summary note
    note_content = f"""# Course Data v5 - Merge Summary

## What v5 Contains

v5.json is the **definitive course data file** that combines:

- **Base Data**: All course information from v4.json (correct descriptions, prerequisites, offerings, etc.)
- **Credit Information**: Accurate credit/unit values from v3.json

## Merge Statistics

- **Total Courses**: {len(v5_data)}
- **Credits Updated**: {credits_updated} courses got credit info from v3
- **Credits Missing**: {credits_missing} courses kept v4's credit values (likely "N/A")

## Data Quality

✅ **Complete Information**: Correct course descriptions, prerequisites, and offerings from v4
✅ **Accurate Credits**: Proper unit/credit values from v3  
✅ **Consistent Structure**: Maintains v4's improved data structure
✅ **No Data Loss**: All courses from v4 are preserved

## Usage

v5.json should now be used instead of v4.json in all applications requiring course data.

## Files Replaced

- **v4.json**: Had correct data but missing/incorrect credits → Use v5.json instead
- **v3.json**: Had correct credits but lacking other information → Credits merged into v5.json

Generated on: {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
"""
    
    note_path = script_dir / 'v5_merge_notes.md'
    try:
        with open(note_path, 'w', encoding='utf-8') as f:
            f.write(note_content)
        print(f"📝 Created merge notes: {note_path}")
    except Exception as e:
        print(f"Warning: Could not create notes file: {e}")
    
    return 0

if __name__ == "__main__":
    sys.exit(main())