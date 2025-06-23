# Improved LLM Prompts for Degree Audit Parsing

## Overview
The degree audit parsing system has been upgraded from a single complex prompt to a **3-step pipeline** for more reliable and accurate course data extraction from UC San Diego degree audit PDFs.

## 3-Step Pipeline Design

### STEP 1: Document Analysis and Course Identification
**Purpose**: Systematically identify ALL course records in the PDF
**Prompt**: `document_analysis_prompt`

Key features:
- Clear identification criteria for course codes, terms, units, titles, and grades
- Explicit classification rules for completed vs. current courses
- Source identification (UCSD, AP, Transfer)
- Raw text output format for easy parsing in next step

### STEP 2: Classification and Structured Extraction  
**Purpose**: Convert identified courses into strictly separated completed/current lists
**Prompt**: `classification_prompt`

Key features:
- Strict validation rules for completed courses (must have final grades)
- Clear rules for current courses (WIP, NR, IP, or no grade)
- Prevents misclassification through explicit requirements
- Structured text output ready for JSON conversion

### STEP 3: JSON Formatting and Validation
**Purpose**: Convert classified data into exact JSON structure with validation
**Prompt**: `json_formatting_prompt`

Key features:
- Exact JSON schema with validation rules
- Field-level requirements (grade field presence/absence)
- Data type enforcement (numbers vs strings)
- Clean JSON output with no markdown formatting

### STEP 4: Requirements Extraction (Parallel)
**Purpose**: Extract degree requirements separately from course history
**Prompt**: `audit_prompt`

Key features:
- Hierarchical category/subcategory structure
- Flexible handling of course lists and text notes
- In-progress course tracking within requirements

## Best Practices Implemented

### 1. **Model Chaining Strategy**
- Each step builds on the previous step's output
- Clear handoff between prompts with explicit context
- Focused tasks reduce cognitive load per API call
- Increased token limits (2048) for complex steps

### 2. **Error Recovery and Validation**
- JSON cleaning to handle markdown formatting
- Graceful fallback to empty structures on parse errors
- Detailed error logging at each step
- Step-by-step debugging information

### 3. **Prompt Design Principles**
- **Specificity**: Exact criteria and examples
- **Clarity**: Simple, direct instructions
- **Validation**: Built-in quality checks
- **Consistency**: Standardized field names and types

## Key Improvements Over Single-Prompt Approach

### ✅ **Reliability**
- Reduced complexity per API call
- Better error isolation and recovery
- More predictable output format

### ✅ **Accuracy** 
- Focused classification logic
- Explicit validation rules
- Reduced ambiguity in course status determination

### ✅ **Maintainability**
- Modular prompt design
- Easy to debug specific steps
- Simple to update individual components

### ✅ **Debugging**
- Step-by-step output logging
- Clear error messages per stage
- Detailed API call tracking

## Technical Implementation

```python
# Step 1: Document Analysis
step1_message = client.messages.create(
    model="claude-3-5-sonnet-20241022",
    max_tokens=2048,
    messages=[{
        "role": "user",
        "content": [
            {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": pdf_data}},
            {"type": "text", "text": document_analysis_prompt}
        ]
    }]
)

# Step 2: Classification  
step2_message = client.messages.create(
    model="claude-3-5-sonnet-20241022",
    max_tokens=2048,
    messages=[{
        "role": "user", 
        "content": [{"type": "text", "text": f"{classification_prompt}\n\nHere is the course data to classify:\n\n{step1_message.content[0].text}"}]
    }]
)

# Step 3: JSON Formatting
step3_message = client.messages.create(
    model="claude-3-5-sonnet-20241022", 
    max_tokens=2048,
    messages=[{
        "role": "user",
        "content": [{"type": "text", "text": f"{json_formatting_prompt}\n\nHere is the classified course data to convert to JSON:\n\n{step2_message.content[0].text}"}]
    }]
)
```

## Expected Output Format

### Completed Courses
```json
{
  "completed_courses": [
    {
      "term": "FA24",
      "course": "DSC 10", 
      "title": "Principles of Data Science",
      "units": 4.0,
      "grade": "A",
      "source": "ucsd"
    }
  ]
}
```

### Current Courses  
```json
{
  "current_courses": [
    {
      "term": "WI25",
      "course": "MATH 18",
      "title": "Linear Algebra", 
      "units": 4.0,
      "source": "ucsd"
    }
  ]
}
```

## Fallback and Error Handling

- **JSON Parse Errors**: Automatic fallback to empty arrays
- **API Failures**: Per-step error isolation with detailed logging  
- **Format Issues**: Markdown cleaning and validation
- **Missing Data**: Graceful handling of incomplete course records

This improved pipeline provides significantly more reliable course data extraction while maintaining compatibility with the existing frontend integration.