# Requirements Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the degree audit sidebar to use a compact progress bar + pills stats block, a collapsing upload zone, and a modern left-border + pill-badge accordion style.

**Architecture:** Extract `ProgressSummary` as a pure display component; edit `SidebarAuditTracker` to conditionally show full vs compact upload UI and delegate stats rendering to `ProgressSummary`; restyle `AuditAccordionSection` header and remove its redundant footer. Delete two unused `AuditSectionBlock.jsx` files.

**Tech Stack:** React 18, Tailwind CSS (JIT), Vite dev server. No unit test framework is configured — verification is visual via `npm run dev`.

---

## File Map

| File | Action |
|---|---|
| `mern/client/src/components/audit/ProgressSummary.jsx` | **Create** |
| `mern/client/src/components/audit/SidebarAuditTracker.jsx` | **Modify** — import ProgressSummary, conditional upload zone, swap stats block |
| `mern/client/src/components/audit/AuditAccordionSection.jsx` | **Modify** — new header row, remove footer |
| `mern/client/src/components/audit/AuditSectionBlock.jsx` | **Delete** |
| `mern/client/src/components/AuditSectionBlock.jsx` | **Delete** |

---

## Task 1: Create `ProgressSummary` component

**Files:**
- Create: `mern/client/src/components/audit/ProgressSummary.jsx`

- [ ] **Step 1: Start the dev server** (keep it running for all tasks)

```bash
cd mern/client
npm run dev
```

Open http://localhost:5173 and navigate to the left sidebar. Keep this tab open throughout.

- [ ] **Step 2: Create `ProgressSummary.jsx`**

Create `mern/client/src/components/audit/ProgressSummary.jsx` with this exact content:

```jsx
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
```

- [ ] **Step 3: Commit**

```bash
git add mern/client/src/components/audit/ProgressSummary.jsx
git commit -m "feat: add ProgressSummary component (bar + pill badges)"
```

---

## Task 2: Update `SidebarAuditTracker` — upload zone + stats block

**Files:**
- Modify: `mern/client/src/components/audit/SidebarAuditTracker.jsx`

- [ ] **Step 1: Add the `ProgressSummary` import**

At the top of `mern/client/src/components/audit/SidebarAuditTracker.jsx`, after the existing imports, add:

Find this block (lines 1–3):
```jsx
import { useState, useEffect } from 'react';
import AuditAccordionSection from './AuditAccordionSection';
import { getStatusCounts, calculateCompletionPercentage } from '../../utils/auditParser';
```

Replace with:
```jsx
import { useState, useEffect } from 'react';
import AuditAccordionSection from './AuditAccordionSection';
import ProgressSummary from './ProgressSummary';
import { getStatusCounts, calculateCompletionPercentage } from '../../utils/auditParser';
```

- [ ] **Step 2: Replace the entire fixed header `<div>` in the return statement**

In the `return` block, find the `{/* Header - Fixed */}` div (starts at line 273, ends at line 364). Replace it entirely with:

```jsx
{/* Header - Fixed */}
<div className="p-4 border-b border-gray-200 bg-white flex-shrink-0">
  {/* Title row + compact replace button when audit is loaded */}
  <div className="flex items-center justify-between mb-3">
    <h2 className="text-lg font-semibold text-gray-900">Graduation Progress</h2>
    {auditSections.length > 0 && (
      <label className="cursor-pointer">
        <span className="text-xs text-gray-500 border border-gray-300 rounded px-2 py-1 hover:bg-gray-50 transition-colors">
          ↑ Replace audit
        </span>
        <input
          type="file"
          accept=".html,.htm"
          onChange={handleFileUpload}
          disabled={loading}
          className="hidden"
        />
      </label>
    )}
  </div>

  {/* Full upload zone — only shown when no audit is loaded */}
  {auditSections.length === 0 && (
    <div className="mb-4">
      <label className="text-sm font-medium text-gray-700 mb-2 block">
        Upload Degree Audit (HTML)
      </label>
      <label className="block w-full">
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-3 text-center hover:border-blue-400 hover:bg-gray-50 transition-colors cursor-pointer">
          <svg className="w-6 h-6 mx-auto mb-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <div className="flex items-center justify-center">
            <span className="bg-blue-500 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-blue-600 transition-colors">
              Choose File
            </span>
            <span className="ml-2 text-sm text-blue-500">No file chosen</span>
          </div>
        </div>
        <input
          type="file"
          accept=".html,.htm"
          onChange={handleFileUpload}
          disabled={loading}
          className="hidden"
        />
      </label>
      <p className="text-xs text-gray-500 mt-2 text-center">
        Upload an HTML degree audit to see your graduation progress.
      </p>
    </div>
  )}

  {/* Loading state */}
  {loading && (
    <div className="text-center py-3">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto mb-2"></div>
      <div className="text-sm text-blue-900">{uploadProgress || 'Processing...'}</div>
    </div>
  )}

  {/* Error state */}
  {error && (
    <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
      <div className="text-sm text-red-800">{error}</div>
    </div>
  )}

  {/* Progress summary — only shown when audit is loaded */}
  {auditSections.length > 0 && (
    <ProgressSummary
      fulfilled={statusCounts.fulfilled}
      inProgress={statusCounts.in_progress}
      notFulfilled={statusCounts.not_fulfilled}
      unitsCompleted={auditData?.metadata?.unitsCompleted}
      completionPercentage={completionPercentage}
    />
  )}
</div>
```

- [ ] **Step 3: Verify visually**

In the browser at http://localhost:5173:
1. Before loading an audit: confirm the full dashed upload zone is visible, "Graduation Progress" title has no button beside it, no stats cards shown.
2. Load a degree audit HTML file. Confirm: the upload zone is gone, a small "↑ Replace audit" button appears inline next to the title, and the thin progress bar + pill badges appear in its place.
3. Confirm the "Replace audit" button successfully loads a new file when clicked.

- [ ] **Step 4: Commit**

```bash
git add mern/client/src/components/audit/SidebarAuditTracker.jsx
git commit -m "feat: collapse upload zone and use ProgressSummary for stats"
```

---

## Task 3: Restyle `AuditAccordionSection`

**Files:**
- Modify: `mern/client/src/components/audit/AuditAccordionSection.jsx`

- [ ] **Step 1: Replace the entire file content**

Replace `mern/client/src/components/audit/AuditAccordionSection.jsx` with:

```jsx
import { useState } from 'react';

const AuditAccordionSection = ({ title, status, items }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const isCourseCompleted = (item) => {
    if (!item || typeof item !== 'string') return false;
    if (item.includes('NEEDS:') || item.includes('Available:')) return false;
    const gradeMatch = item.match(/\([^,)]+,\s*([^)]+)\)$/);
    if (!gradeMatch) return false;
    const grade = gradeMatch[1].trim().toLowerCase();
    if (!grade || grade === 'nr' || grade === 'wip' || grade.includes('wip') || grade.includes('progress')) {
      return false;
    }
    return true;
  };

  const statusConfig = {
    fulfilled: {
      border: 'border-l-green-500',
      badge: 'bg-green-100 text-green-800',
      label: 'Done',
    },
    in_progress: {
      border: 'border-l-yellow-500',
      badge: 'bg-yellow-50 text-yellow-800',
      label: 'In Progress',
    },
    not_fulfilled: {
      border: 'border-l-red-500',
      badge: 'bg-red-100 text-red-800',
      label: 'Remaining',
    },
  }[status] ?? {
    border: 'border-l-gray-300',
    badge: 'bg-gray-100 text-gray-700',
    label: 'Unknown',
  };

  return (
    <div className={`border border-gray-200 border-l-[3px] ${statusConfig.border} rounded-lg overflow-hidden`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2.5 text-left hover:bg-gray-50 transition-colors duration-200 focus:outline-none"
      >
        <div className="flex items-center gap-2.5">
          <svg
            className={`w-3 h-3 text-gray-400 flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <polyline points="6 9 12 15 18 9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h3 className="text-sm font-medium text-gray-900 truncate flex-1">{title}</h3>
          <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0 ${statusConfig.badge}`}>
            {statusConfig.label}
          </span>
        </div>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 bg-gray-50 border-t border-gray-200">
          <div className="space-y-1.5 pt-2.5">
            {items.length > 0 ? (
              items.map((item, index) => {
                const isCompleted = isCourseCompleted(item);
                return (
                  <div
                    key={index}
                    className={`rounded border px-3 py-2 ${
                      isCompleted ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'
                    }`}
                  >
                    <p className={`text-xs leading-relaxed ${isCompleted ? 'text-green-800' : 'text-gray-700'}`}>
                      {isCompleted && <span className="mr-1.5 text-green-600 font-bold">✓</span>}
                      {item}
                    </p>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-4">
                <p className="text-xs text-gray-500">No courses found</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditAccordionSection;
```

- [ ] **Step 2: Verify visually**

In the browser at http://localhost:5173 with an audit loaded:
1. Each requirement row has a colored left border (green / yellow / red) matching its status.
2. Each row has a pill badge on the right ("Done" / "In Progress" / "Remaining").
3. The chevron SVG rotates when a row is expanded.
4. No colored dot visible on any row.
5. Expanding a row shows course items. No "Status: FULFILLED" footer inside expanded panels.
6. Completed courses (those with a real grade) still show green background + ✓ checkmark.

- [ ] **Step 3: Commit**

```bash
git add mern/client/src/components/audit/AuditAccordionSection.jsx
git commit -m "feat: restyle accordion with left border, pill badge, SVG chevron"
```

---

## Task 4: Delete unused files + final check

**Files:**
- Delete: `mern/client/src/components/audit/AuditSectionBlock.jsx`
- Delete: `mern/client/src/components/AuditSectionBlock.jsx`

- [ ] **Step 1: Confirm neither file is imported anywhere**

```bash
grep -r "AuditSectionBlock" mern/client/src/
```

Expected output: no results (or only the two file paths themselves — not import statements). If any import is found, track it down and remove it before deleting.

- [ ] **Step 2: Delete both files**

```bash
rm mern/client/src/components/audit/AuditSectionBlock.jsx
rm mern/client/src/components/AuditSectionBlock.jsx
```

- [ ] **Step 3: Verify the dev server still compiles cleanly**

Check the terminal running `npm run dev`. There should be no new errors or warnings after deletion.

- [ ] **Step 4: Final visual smoke test**

In the browser:
1. Before loading: full dashed upload zone visible, no stats.
2. After loading an audit: compact "↑ Replace audit" button, progress bar + pills, all requirements listed with colored-left-border accordions.
3. Expand several requirement rows — green/yellow/red items render correctly, no footer.
4. Click "↑ Replace audit" — file picker opens and successfully reloads.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete unused AuditSectionBlock components"
```
