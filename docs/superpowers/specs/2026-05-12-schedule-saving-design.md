# Schedule Saving Design

## Goal

Allow authenticated users to save, load, rename, and delete multiple named course schedules, persisted across sessions and devices.

## Architecture

Firebase is used for both authentication and data storage. The React client communicates directly with Firebase — no new Express endpoints are needed. Express continues to handle course search and RAG chat proxy only.

- **Auth:** Firebase Auth with Google OAuth (popup flow)
- **Storage:** Firestore (client SDK with security rules)
- **No backend changes** — Express is untouched

## Data Model

### `users/{userId}`
Created on first sign-in. Stores basic profile info from Google.

```json
{
  "email": "student@ucsd.edu",
  "name": "David Li",
  "photoURL": "https://..."
}
```

### `users/{userId}/schedules/{scheduleId}`
Each user has a subcollection of schedule documents.

```json
{
  "id": "abc123",
  "name": "Plan A",
  "schedule": [ ...4-element array of { fall, winter, spring } objects... ],
  "createdAt": "2026-05-12T00:00:00Z",
  "updatedAt": "2026-05-12T00:00:00Z"
}
```

**Firestore security rules:** Each user can only read and write their own documents.
```
match /users/{userId}/{document=**} {
  allow read, write: if request.auth.uid == userId;
}
```

## New Files

| File | Responsibility |
|------|---------------|
| `mern/client/src/firebase.js` | Initialize Firebase app, export `auth` and `db` |
| `mern/client/src/context/AuthContext.jsx` | Auth state provider, exposes `currentUser` |
| `mern/client/src/hooks/useSchedules.js` | CRUD operations against Firestore |
| `mern/client/src/components/auth/SignInButton.jsx` | Google sign-in/out button with profile photo |
| `mern/client/src/components/schedules/ScheduleManager.jsx` | Modal listing all saved schedules |

## Modified Files

| File | Change |
|------|--------|
| `mern/client/src/main.jsx` | Wrap app in `AuthProvider` |
| `mern/client/src/components/Header.jsx` | Add schedule name, Save button, My Schedules button, SignInButton |
| `mern/client/src/components/planner/CoursePlannerContainer.jsx` | Accept `onSave`/`onLoad` props, track `hasUnsavedChanges` |
| `mern/client/src/components/MainLayout.jsx` | Thread schedule state and save/load callbacks |

## Auth Flow

1. User clicks "Sign in with Google" in the header
2. Firebase opens a Google OAuth popup
3. On success, `onAuthStateChanged` fires and sets `currentUser` in `AuthContext`
4. If no `users/{userId}` document exists, create one with name/email/photo from Google profile
5. Sign-out clears `currentUser` and disables save

Auth state persists across page refreshes via Firebase's built-in token storage.

## `useSchedules` Hook

Exposed interface:

```js
const {
  schedules,              // list of { id, name, updatedAt }
  loadSchedule,           // (id) => sets planner grid to that schedule's data
  saveSchedule,           // (name, grid) => upserts to Firestore
  renameSchedule,         // (id, newName) => updates name field
  deleteSchedule,         // (id) => removes document
} = useSchedules();
```

- Only active when `currentUser` is non-null
- `schedules` list is ordered by `updatedAt` descending
- The hook tracks `currentScheduleId` internally (set when a schedule is loaded or first saved). `saveSchedule` creates a new document if `currentScheduleId` is null, updates existing otherwise.

## Header Changes

**Left/center:** Current schedule name (inline-editable text field) + Save button. Save is disabled when logged out or `hasUnsavedChanges` is false.

**Right:** "My Schedules" button (opens `ScheduleManager` modal) + `SignInButton` (shows Google profile photo + name when logged in, "Sign in with Google" when logged out).

## ScheduleManager Modal

- Lists all saved schedules ordered by last updated
- Each row: schedule name, last updated date, Load button, Rename button, Delete button
- Delete requires a confirmation click ("Click again to confirm")
- "New Schedule" button clears the planner and starts fresh (prompts to save unsaved changes first)
- Closes on Escape or clicking outside

## Unsaved Changes Tracking

`CoursePlannerContainer` compares the current grid to the last-saved snapshot. If they differ, `hasUnsavedChanges` is true. The header Save button reflects this state. On loading a different schedule or navigating away, if `hasUnsavedChanges` is true, a browser `confirm()` dialog warns the user.

## Environment Variables

Add to `mern/client/.env` and `.env.example`:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...
```

## Out of Scope

- Schedule sharing / public URLs
- Email/password auth
- Server-side schedule validation
- Collaborative editing
