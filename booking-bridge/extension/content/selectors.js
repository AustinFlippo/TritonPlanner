/**
 * All TSS DOM knowledge lives in this one file.
 *
 * Two reasons it is isolated:
 *  1. TSS is behind SSO + Duo, so these selectors can only be authored from a
 *     capture taken by a signed-in student. Keeping them in one file means
 *     filling them in never touches working logic.
 *  2. Fiori ships UI changes that break CSS selectors. When that happens this
 *     is the only file that needs editing.
 *
 * STATUS: placeholders. Nothing here is confirmed against the live app yet —
 * run a capture (see README) and replace the `candidates` arrays.
 *
 * Each target lists candidate strategies tried in order. A target that
 * resolves to nothing is reported as a named, visible failure rather than a
 * silent no-op, because a booking tool that quietly does nothing during a
 * two-day enrollment window is worse than one that says it is broken.
 */

/**
 * Confirmed from a live capture (2026-08-09, UI5 1.120.46):
 *
 *   App id      customer.schedule.soc.yucsdsoc
 *   Entity      YUCSD_CON_MODULE
 *   Route       #YSchedule-view&/
 *   Pattern     SAP Fiori Elements List Report — ids look like
 *               <appId>::<entity>List--fe::table::<entity>::LineItem-innerTable-*
 *
 * The results grid is a RESPONSIVE table (sap.m.Table), not sap.ui.table.Table.
 * Critically, the page also contains ~12 other sap.m.Table controls — one
 * value-help popup per filter field — and they render inside `sap-ui-static`
 * BEFORE the results table. A bare `sap.m.Table` selector reliably grabs the
 * wrong one, so every candidate below is anchored on the `fe::table::` id.
 */
const TPBB_SELECTORS = {
  // Still false: the capture caught an empty grid, so the column header row
  // has not been seen yet. Scraping stays unverified until it has.
  verified: false,
  capturedAgainst: "TSS 2026-08-09, UI5 1.120.46, app customer.schedule.soc.yucsdsoc",

  targets: {

    /** The button that opens the booking screen for a selected section. */
    goToBookingButton: {
      description: "'Go To Booking' action on a course/section detail panel",
      candidates: [
        { kind: "ui5Text", type: "sap.m.Button", text: "Go To Booking" },
        { kind: "text", tag: "button", text: "Go To Booking" },
        { kind: "text", tag: "a", text: "Go To Booking" },
      ],
    },

    /** The final confirm control on the booking screen. */
    bookSaveButton: {
      description: "'Book/Save' submit button — the actual enrollment action",
      candidates: [
        { kind: "ui5Text", type: "sap.m.Button", text: "Book/Save" },
        { kind: "text", tag: "button", text: "Book/Save" },
        { kind: "text", tag: "button", text: "Book / Save" },
      ],
    },

    /** Grading option control (letter vs P/NP). */
    gradingOptionControl: {
      description: "Grading option selector on the booking screen",
      candidates: [
        { kind: "ui5", type: "sap.m.Select" },
        { kind: "ui5", type: "sap.m.ComboBox" },
        { kind: "css", value: "select[id*='grad' i]" },
      ],
    },

    /** Credit-hours input, shown only for variable-unit courses. */
    creditHoursInput: {
      description: "Credit hours input for variable-unit modules",
      candidates: [
        { kind: "css", value: "input[id*='credit' i]" },
        { kind: "ui5", type: "sap.m.StepInput" },
      ],
    },

    /** Confirmation / error banner after a booking attempt. */
    resultMessage: {
      description: "Message strip or dialog reporting booking success or failure",
      candidates: [
        { kind: "ui5", type: "sap.m.MessageStrip" },
        { kind: "ui5", type: "sap.m.MessageBox" },
        { kind: "css", value: ".sapMMessageStrip" },
        { kind: "role", value: "alert" },
      ],
    },

  },

  /**
   * Filter field names confirmed from the live app. Useful both for driving
   * the filter bar and as a hint to what the result columns are called, since
   * Fiori Elements derives both from the same OData entity.
   *
   *   BasicSearchField           free text ("E.g. BILD, BILD-001")
   *   AcademicYear               e.g. 2026/2027
   *   AcademicPeriod             labelled "Term"
   *   AcademicLevel2             labelled "Academic Level"
   *   DepartmentText             labelled "Department"
   *   Building / Location
   *   DeliveryMode               labelled "Modality"
   *   Instructor
   *   DoW                        labelled "Day of the Week"
   *   EventID                    labelled "Section ID"
   *   seatsAvailable             labelled "Seats Available"
   *   wishlisted                 labelled "Wishlisted"  <- TSS has a wish list
   *   Credits                    custom RangeSlider
   */
  filterFields: [
    "BasicSearchField", "AcademicYear", "AcademicPeriod", "AcademicLevel2",
    "DepartmentText", "Building", "Location", "DeliveryMode", "Instructor",
    "DoW", "EventID", "seatsAvailable", "wishlisted", "Credits",
  ],

  /**
   * Known TSS Fiori apps, from live captures (2026-08-09):
   *
   *   #YSchedule-view      Schedule of Classes (app customer.schedule.soc.yucsdsoc,
   *                        entity YUCSD_CON_MODULE, Fiori Elements List Report)
   *   #ZUSModule-display   My Courses module detail (component
   *                        application-ZUSModule-display-component; ObjectPage
   *                        with sections Classes / Instructor / Information and
   *                        labels: Course, Credits, Grading Option,
   *                        "Academic year & session", "Event package name",
   *                        "Open Seats"). This is a read-only display page —
   *                        grading option renders as a status, not a control.
   *
   * The actual booking form (Book/Save) is a third screen, not yet captured.
   */
  knownApps: {
    scheduleOfClasses: "#YSchedule-view",
    myCoursesDetail: "#ZUSModule-display",
  },

  /**
   * Text TSS uses for booking states, mapped to our normalized vocabulary.
   * Sourced from the published TSS help pages; verify against a live capture.
   */
  statusText: {
    open: ["available", "open", "seats available"],
    "waitlist-active": ["waitlist active", "waitlist"],
    "waitlist-inactive": ["waitlist inactive", "waitlist closed"],
    full: ["full", "closed", "no seats"],
    booked: ["booked", "enrolled"],
    "booked-waitlist": ["booked on wait list", "waitlisted"],
    "conditionally-booked": ["conditionally booked"],
  },
};

if (typeof window !== "undefined") window.TPBB_SELECTORS = TPBB_SELECTORS;
if (typeof module !== "undefined") module.exports = { TPBB_SELECTORS };
