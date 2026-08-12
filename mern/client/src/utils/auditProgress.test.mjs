import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateAuditProgress,
  evaluateRequirement,
} from "./auditProgress.js";

const scheduleWith = (...courses) => [
  { fall: courses, winter: [], spring: [] },
];

test("planner's canonical cross-listed ids credit audit requirements", () => {
  const section = {
    status: "not_fulfilled",
    items: ["NEEDS: 3 more courses | Available: DSC 80, ANSC 185, HIUS 267"],
  };
  // The agent places canonical catalog ids; the audit lists plain codes.
  const result = evaluateRequirement(
    section,
    scheduleWith(
      { course_id: "DSC 80/80R", credits: 4 },
      { course_id: "AAS/ANSC 185", credits: 4 },
      { course_id: "HIUS 167/267/ETHN 180", credits: 4 }
    )
  );
  assert.equal(result.requirementResults[0].progress, 3);
  assert.equal(result.projected, true);
});

test("list-less upper-division unit requirement projects from course levels", () => {
  const section = {
    title: "48 Upper Division Unit Requirement",
    status: "not_fulfilled",
    items: ["NEEDS: 8.00 Units"],
  };
  // Lower-division CSE 21 must not count; two upper-division courses do.
  const short = evaluateRequirement(
    section,
    scheduleWith(
      { course_id: "CSE 21", credits: 4 },
      { course_id: "CSE 101", credits: 4 }
    )
  );
  assert.equal(short.requirementResults[0].progress, 4);
  assert.equal(short.projected, false);

  const covered = evaluateRequirement(
    section,
    scheduleWith(
      { course_id: "CSE 101", credits: 4 },
      { course_id: "DSC 140A", credits: 4 }
    )
  );
  assert.equal(covered.requirementResults[0].progress, 8);
  assert.equal(covered.projected, true);
});

test("unit requirement does not steal courses from list requirements", () => {
  // The same upper-division course credits BOTH its named requirement and
  // the units total — no cross-requirement exclusion for unit rules.
  const sections = [
    {
      title: "ELECTIVES",
      status: "not_fulfilled",
      items: ["NEEDS: 1 more Courses | Available: CSE 101"],
    },
    {
      title: "48 Upper Division Unit Requirement",
      status: "not_fulfilled",
      items: ["NEEDS: 4.00 Units"],
    },
  ];
  const schedule = scheduleWith({ course_id: "CSE 101", credits: 4 });
  const electives = evaluateRequirement(sections[0], schedule);
  const units = evaluateRequirement(sections[1], schedule);
  assert.equal(electives.projected, true);
  assert.equal(units.projected, true);
});

test("legacy split NEEDS and Available items form one requirement", () => {
  const section = {
    status: "not_fulfilled",
    items: ["NEEDS: 2 more courses", "Available: DSC 100, 102, 106"],
  };
  const result = evaluateRequirement(
    section,
    scheduleWith({ course_id: "DSC 100", credits: 4 })
  );

  assert.equal(result.requirementResults.length, 1);
  assert.equal(result.requirementResults[0].needAmount, 2);
  assert.deepEqual(result.requirementResults[0].availableCodes, [
    "DSC 100",
    "DSC 102",
    "DSC 106",
  ]);
  assert.equal(result.requirementResults[0].progress, 1);
  assert.equal(result.projected, false);
});

test("partial and full plan coverage update course-slot and category progress", () => {
  const sections = [
    { title: "Completed", status: "fulfilled", items: ["DSC 10 - Intro (FA24, A)"] },
    {
      title: "Electives",
      status: "not_fulfilled",
      items: [
        "NEEDS: 7 Courses | Available: DSC 100, 102, 106, 140A, 140B, 160, 180",
      ],
    },
  ];
  const partial = calculateAuditProgress(
    sections,
    scheduleWith(
      { course_id: "DSC 100", credits: 4 },
      { course_id: "DSC 102", credits: 4 },
      { course_id: "DSC 106", credits: 4 }
    )
  );

  assert.equal(partial.coveredCourseSlots, 3);
  assert.equal(partial.openCourseSlots, 7);
  assert.equal(partial.courseSlotPercent, 43);
  assert.equal(partial.verifiedPercent, 50);
  assert.equal(partial.withPlanPercent, 71);
  assert.equal(partial.projected, 1);
  assert.equal(partial.projectedPercent, 50);

  const full = calculateAuditProgress(
    sections,
    scheduleWith(
      ...["100", "102", "106", "140A", "140B", "160", "180"].map((number) => ({
        course_id: `DSC ${number}`,
        credits: 4,
      }))
    )
  );

  assert.equal(full.coveredCourseSlots, 7);
  assert.equal(full.courseSlotPercent, 100);
  assert.equal(full.withPlanPercent, 100);
  assert.equal(full.projected, 2);
  assert.equal(full.projectedPercent, 100);
});

test("multiple NEEDS rows allocate a planned course only once", () => {
  const section = {
    status: "not_fulfilled",
    items: [
      "NEEDS: 1 Course | Available: DSC 100, DSC 102",
      "NEEDS: 1 Course | Available: DSC 102, DSC 106",
    ],
  };
  const result = evaluateRequirement(
    section,
    scheduleWith(
      { course_id: "DSC 100", credits: 4 },
      { course_id: "DSC 102", credits: 4 }
    )
  );

  assert.deepEqual(
    result.requirementResults.map((requirement) =>
      requirement.matchedCourses.map((course) => course.course_id)
    ),
    [["DSC 100"], ["DSC 102"]]
  );
  assert.equal(result.projected, true);
});

test("a satisfiable plan is not reported short because of row order", () => {
  // The reason cross-row assignment has to be one matching, not first-come.
  // Electives can take any of three courses; Core can only ever take DSC 100.
  // Letting Electives (listed first) consume DSC 100 left Core reporting
  // "still needed: DSC 100" — a course already sitting on the student's grid.
  const section = {
    title: "Data Science Upper Division",
    status: "not_fulfilled",
    subrequirements: [
      {
        title: "Electives",
        status: "not_fulfilled",
        needType: "courses",
        needAmount: 1,
        groups: [["DSC 100"], ["DSC 102"], ["DSC 106"]],
        availableCodes: ["DSC 100", "DSC 102", "DSC 106"],
      },
      {
        title: "Core",
        status: "not_fulfilled",
        needType: "courses",
        needAmount: 1,
        groups: [["DSC 100"]],
        availableCodes: ["DSC 100"],
      },
    ],
  };
  const result = evaluateRequirement(
    section,
    scheduleWith(
      { course_id: "DSC 100", credits: 4, status: "planned" },
      { course_id: "DSC 102", credits: 4, status: "planned" }
    )
  );

  assert.deepEqual(
    result.requirementResults.map((requirement) => [
      requirement.title,
      requirement.projected,
      requirement.matchedCourses.map((course) => course.course_id),
    ]),
    [
      ["Electives", true, ["DSC 102"]],
      ["Core", true, ["DSC 100"]],
    ]
  );
  assert.equal(result.projected, true);
});

test("a subrequirement with options but no parsed NEEDS does not freeze its category", () => {
  // No needType means the parser read no requirement off the row. It used to
  // fall through, inherit a default "needs 1", fail, and hold the category at
  // 0% forever with nothing on screen to explain it.
  const section = {
    title: "MAJOR REQUIREMENTS",
    status: "not_fulfilled",
    subrequirements: [
      {
        title: "Row the parser could not read",
        status: "not_fulfilled",
        needType: null,
        needAmount: null,
        groups: [["DSC 106"]],
        availableCodes: ["DSC 106"],
      },
      {
        title: "Core",
        status: "not_fulfilled",
        needType: "courses",
        needAmount: 1,
        groups: [["DSC 100"]],
        availableCodes: ["DSC 100"],
      },
    ],
  };
  const progress = calculateAuditProgress(
    [section],
    scheduleWith({ course_id: "DSC 100", credits: 4, status: "planned" })
  );

  assert.equal(progress.sectionProgress[0].projected, true);
  assert.equal(progress.withPlanPercent, 100);
  // The unreadable row is not an open slot either — it asks for nothing.
  assert.equal(progress.openCourseSlots, 1);
});

test("a section whose rows are all in progress is covered, not stuck at 0%", () => {
  // The audit closes an in-progress row when grades post. A category made
  // only of those scored 0%, and bolting on one unmet row the plan covered
  // took the same category to 100% — the section contradicting its own rows.
  const rows = [
    {
      title: "Row already under way",
      status: "in_progress",
      needType: null,
      needAmount: null,
      groups: [],
      availableCodes: [],
    },
    {
      title: "Second row already under way",
      status: "in_progress",
      needType: null,
      needAmount: null,
      groups: [],
      availableCodes: [],
    },
  ];
  const schedule = scheduleWith({
    course_id: "DSC 100",
    credits: 4,
    status: "planned",
  });

  const allInProgress = calculateAuditProgress(
    [{ title: "Major", status: "not_fulfilled", subrequirements: rows }],
    schedule
  );
  assert.equal(allInProgress.sectionProgress[0].projected, true);
  assert.equal(allInProgress.withPlanPercent, 100);

  // Adding a row the plan covers must not be what makes the section count.
  const plusCoveredRow = calculateAuditProgress(
    [
      {
        title: "Major",
        status: "not_fulfilled",
        subrequirements: [
          ...rows,
          {
            title: "Row the plan covers",
            status: "not_fulfilled",
            needType: "courses",
            needAmount: 1,
            groups: [["DSC 100"]],
            availableCodes: ["DSC 100"],
          },
        ],
      },
    ],
    schedule
  );
  assert.equal(plusCoveredRow.withPlanPercent, 100);
});

test("fully projected unit-only categories count toward with-plan percent", () => {
  const sections = [
    { title: "Core", status: "fulfilled", items: ["DSC 10 - Intro (FA24, A)"] },
    {
      title: "48 Upper Division Unit Requirement",
      status: "not_fulfilled",
      items: ["NEEDS: 8.00 Units"],
      subrequirements: [
        {
          status: "not_fulfilled",
          needType: "units",
          needAmount: 8,
          availableCodes: [],
        },
      ],
    },
  ];
  const progress = calculateAuditProgress(
    sections,
    scheduleWith(
      { course_id: "DSC 100", credits: 4, status: "planned" },
      { course_id: "DSC 102", credits: 4, status: "planned" }
    )
  );

  assert.equal(progress.verifiedPercent, 50);
  assert.equal(progress.projected, 2);
  assert.equal(progress.withPlanPercent, 100);
});

test("graded grid courses without status are not treated as planned", () => {
  const sections = [
    { title: "Done", status: "fulfilled", items: ["DSC 10 - Intro (FA24, A)"] },
    {
      title: "Electives",
      status: "not_fulfilled",
      items: ["NEEDS: 2 Courses | Available: DSC 100, DSC 102"],
    },
  ];
  // Audit-restored card: grade present, status missing — must not boost "with plan"
  const progress = calculateAuditProgress(
    sections,
    scheduleWith(
      { course_id: "DSC 100", credits: 4, grade: "A" },
      { course_id: "DSC 10", credits: 4, grade: "A" }
    )
  );

  assert.equal(progress.verifiedPercent, 50);
  assert.equal(progress.withPlanPercent, 50);
  assert.equal(progress.plannedUnits, 0);
  assert.equal(progress.coveredCourseSlots, 0);
});

test("empty plan keeps with-plan percent equal to completed percent", () => {
  const sections = Array.from({ length: 10 }, (_, i) => ({
    title: `Req ${i}`,
    status: i < 3 ? "fulfilled" : "not_fulfilled",
    items:
      i < 3
        ? [`CSE ${i} - Done (FA24, A)`]
        : [`NEEDS: 1 Course | Available: CSE ${100 + i}`],
  }));
  const progress = calculateAuditProgress(sections, scheduleWith());
  assert.equal(progress.verifiedPercent, 30);
  assert.equal(progress.withPlanPercent, 30);
});

test("unknown elective dumps are excluded from the progress denominator", () => {
  const sections = [
    { title: "Core", status: "fulfilled", items: ["DSC 10 - Intro (FA24, A)"] },
    {
      title: "Electives",
      status: "not_fulfilled",
      items: ["NEEDS: 1 Course | Available: DSC 100"],
    },
    {
      title: "Elective Courses",
      status: "unknown",
      items: ["CHEM 6A - General Chemistry I (SP23, TP)"],
    },
  ];
  const progress = calculateAuditProgress(
    sections,
    scheduleWith({ course_id: "DSC 100", credits: 4, status: "planned" })
  );

  assert.equal(progress.total, 2);
  assert.equal(progress.verifiedPercent, 50);
  assert.equal(progress.withPlanPercent, 100);
});

test("cross-listed audit tokens match undefined-status dragged courses", () => {
  const section = {
    status: "not_fulfilled",
    subrequirements: [
      {
        status: "not_fulfilled",
        needType: "courses",
        needAmount: 1,
        availableCodes: ["DSC 80/80R"],
      },
    ],
  };
  const result = evaluateRequirement(
    section,
    scheduleWith({ course_id: "DSC80R", credits: 4 })
  );

  assert.equal(result.projected, true);
  assert.equal(result.matchedCourses[0].status, "planned");
});

test("plain cross-listing aliases match without a slash on either side", () => {
  // Python _codes_match resolves both through the catalog. JS must too —
  // aliasesFor alone only expands slashes present in the string it is handed.
  const section = {
    status: "not_fulfilled",
    subrequirements: [
      {
        status: "not_fulfilled",
        needType: "courses",
        needAmount: 2,
        availableCodes: ["DSC 80", "ANSC 185"],
      },
    ],
  };
  const result = evaluateRequirement(
    section,
    scheduleWith(
      { course_id: "DSC 80R", credits: 4 },
      { course_id: "AAS 185", credits: 4 }
    )
  );
  assert.equal(result.requirementResults[0].progress, 2);
  assert.equal(result.projected, true);
});

test("audit section variants (R / GS) match the base catalog course", () => {
  // The audit lists whichever section variant it knows ("MUS 20R" for the
  // remote offering, "MUS 8GS" for the global seminar); the catalog — and so
  // the planner grid — usually carries only the base course. Mirrors
  // get_course's fallback in app/catalog.py.
  const section = {
    status: "not_fulfilled",
    subrequirements: [
      {
        status: "not_fulfilled",
        needType: "courses",
        needAmount: 2,
        availableCodes: ["MUS 20R", "MUS 8GS"],
      },
    ],
  };
  const result = evaluateRequirement(
    section,
    scheduleWith(
      { course_id: "MUS 20", credits: 4 },
      { course_id: "MUS 8", credits: 4 }
    )
  );
  assert.equal(result.requirementResults[0].progress, 2);
  assert.equal(result.projected, true);
});

test("a trailing letter that is part of the number is not a section variant", () => {
  // Stripping the "A" would let DSC 140A satisfy a slot asking for DSC 140.
  const section = {
    status: "not_fulfilled",
    subrequirements: [
      {
        status: "not_fulfilled",
        needType: "courses",
        needAmount: 1,
        availableCodes: ["DSC 140"],
      },
    ],
  };
  const result = evaluateRequirement(
    section,
    scheduleWith({ course_id: "DSC 140A", credits: 4 })
  );
  assert.equal(result.requirementResults[0].progress, 0);
  assert.equal(result.projected, false);
});

test("unverified courses are counted, not silently worth zero units", () => {
  // A course the audit vouches for that the catalog never published arrives
  // with credits null. Summing it as 0 understates the plan and overstates
  // what is left to graduate, so the count has to surface.
  const progress = calculateAuditProgress(
    [
      {
        title: "MAJOR ELECTIVES",
        status: "not_fulfilled",
        items: ["NEEDS: 2 more courses | Available: DSC 100, XYZ 152"],
      },
    ],
    scheduleWith(
      { course_id: "DSC 100", credits: 4, status: "planned" },
      { course_id: "XYZ 152", credits: null, status: "planned", unverified: true }
    ),
    { unitsCompleted: 130, unitsRequired: 180 }
  );
  assert.equal(progress.unknownUnitCourses, 1);
  assert.equal(progress.plannedUnits, 4); // only the known one counts
  // 180 - 130 - 4 = 46, an upper bound because XYZ 152's units are unknown.
  assert.equal(progress.unitsRemaining, 46);
});

test("sequence-course credits count as one quarter in the unit totals", () => {
  // Raw "4-4-4" reaching the grid used to sum as 0 via Number(...) || 0.
  const progress = calculateAuditProgress(
    [{ title: "BREADTH", status: "not_fulfilled", items: [] }],
    scheduleWith({ course_id: "HILD 2A", credits: "4-4-4", status: "planned" }),
    { unitsCompleted: 0, unitsRequired: 180 }
  );
  assert.equal(progress.plannedUnits, 4);
  assert.equal(progress.unknownUnitCourses, 0);
});

test("subrequirement titles are preserved on open requirement results", () => {
  const section = {
    title: "GENERAL EDUCATION",
    status: "not_fulfilled",
    subrequirements: [
      {
        title: "Arts",
        status: "not_fulfilled",
        needType: "courses",
        needAmount: 1,
        availableCodes: ["VIS 1", "MUS 4"],
      },
      {
        title: "Formal Skills",
        status: "fulfilled",
        needType: "courses",
        needAmount: 1,
        availableCodes: ["MATH 10A"],
      },
    ],
  };
  const result = evaluateRequirement(section, []);
  const open = result.requirementResults.filter(
    (requirement) => requirement.status !== "fulfilled"
  );

  assert.equal(open.length, 1);
  assert.equal(open[0].title, "Arts");
  assert.equal(open[0].availableCodes.length, 2);
});

test("JTCCER climate section with no Available list projects from the approved list", () => {
  const section = {
    title: "JANE TERANES CLIMATE CHANGE EDUCATION REQUIREMENT",
    status: "not_fulfilled",
    subrequirements: [
      { status: "not_fulfilled", needType: "courses", needAmount: 1, availableCodes: [] },
    ],
  };
  // Without a planned climate course: not projected (and not crashed).
  const short = evaluateRequirement(
    section,
    scheduleWith({ course_id: "CSE 100", credits: 4 })
  );
  assert.equal(short.projected, false);

  // A planned approved course (SIO 30) fulfills it.
  const done = evaluateRequirement(
    section,
    scheduleWith({ course_id: "SIO 30", credits: 4 })
  );
  assert.equal(done.projected, true);
  assert.equal(done.matchedCourses[0].course_id, "SIO 30");
});

test("JTCCER attribute slot counts toward courseSlotPercent", () => {
  // availableCodes stay empty on the raw subrequirement; after attribute
  // substitution the effective list must surface so open/covered slots include it.
  const sections = [
    {
      title: "Core",
      status: "not_fulfilled",
      subrequirements: [
        {
          status: "not_fulfilled",
          needType: "courses",
          needAmount: 1,
          availableCodes: ["CSE 100"],
        },
      ],
    },
    {
      title: "JANE TERANES CLIMATE CHANGE EDUCATION REQUIREMENT",
      status: "not_fulfilled",
      subrequirements: [
        {
          status: "not_fulfilled",
          needType: "courses",
          needAmount: 1,
          availableCodes: [],
        },
      ],
    },
  ];
  const open = calculateAuditProgress(sections, []);
  assert.equal(open.openCourseSlots, 2);
  assert.equal(open.coveredCourseSlots, 0);

  const covered = calculateAuditProgress(
    sections,
    scheduleWith({ course_id: "SIO 30", credits: 4 })
  );
  assert.equal(covered.openCourseSlots, 2);
  assert.equal(covered.coveredCourseSlots, 1);
  assert.equal(covered.courseSlotPercent, 50);
  assert.ok(
    covered.sectionProgress[1].requirementResults[0].availableCodes.length > 0
  );
});

test("non-climate list-less course requirement still cannot project", () => {
  const section = {
    title: "SOME OTHER REQUIREMENT",
    status: "not_fulfilled",
    subrequirements: [
      { status: "not_fulfilled", needType: "courses", needAmount: 1, availableCodes: [] },
    ],
  };
  const result = evaluateRequirement(
    section,
    scheduleWith({ course_id: "SIO 30", credits: 4 })
  );
  assert.equal(result.projected, false);
});

test("Eighth College GE section (mashed title, junk codes) projects via CCE list", () => {
  const section = {
    // Exact mashed-title shape the audit parser produces.
    title:
      "Eighth College General Education RequirementsFor a list of courses, please go tohttp://eighth.ucsd.edu/academics/degree-requirements/first-year.html",
    status: "not_fulfilled",
    subrequirements: [
      { status: "not_fulfilled", needType: "courses", needAmount: 1, availableCodes: ["GO TOHTTP"] },
    ],
  };
  const done = evaluateRequirement(
    section,
    scheduleWith({ course_id: "CCE 2", credits: 4 })
  );
  assert.equal(done.projected, true);
  assert.equal(done.matchedCourses[0].course_id, "CCE 2");
});

test("Eighth College sibling CCE rows keep audit lists (do not demand whole sequence)", () => {
  // Exact shape from a real saved audit: CCE 1/2 already fulfilled; open
  // rows name CCE 3 and CCE 120 specifically. The attribute fallback must
  // NOT widen either row to the whole CCE sequence — that was the bug that
  // made CCE 3 steal the planned CCE 120 and leave "CC 120" unfulfilled.
  const section = {
    title:
      "Eighth College General Education RequirementsFor a list of courses, please go tohttp://eighth.ucsd.edu/academics/degree-requirements/first-year.html",
    status: "not_fulfilled",
    subrequirements: [
      {
        mode: "any",
        title: "Critical Community Engagement 1",
        groups: [],
        status: "fulfilled",
        needType: null,
        needAmount: null,
        availableCodes: [],
      },
      {
        mode: "any",
        title: "Critical Community Engagement 2",
        groups: [],
        status: "fulfilled",
        needType: null,
        needAmount: null,
        availableCodes: [],
      },
      {
        mode: "all",
        title: "Critical Community Engagement 3",
        groups: [["CCE 3"]],
        status: "not_fulfilled",
        needType: "courses",
        needAmount: 1,
        availableCodes: ["CCE 3"],
      },
      {
        mode: "all",
        title: "Critical Community Engagement 120",
        groups: [["CCE 120"]],
        status: "not_fulfilled",
        needType: "courses",
        needAmount: 1,
        availableCodes: ["CCE 120"],
      },
    ],
  };

  const onlyCapstone = evaluateRequirement(
    section,
    scheduleWith({ course_id: "CCE 120", credits: 4, status: "planned" })
  );
  assert.equal(onlyCapstone.projected, false);
  assert.deepEqual(
    onlyCapstone.requirementResults
      .filter((r) => r.status !== "fulfilled")
      .map((r) => [r.title, r.projected, r.matchedCourses.map((c) => c.course_id)]),
    [
      ["Critical Community Engagement 3", false, []],
      ["Critical Community Engagement 120", true, ["CCE 120"]],
    ]
  );

  const both = evaluateRequirement(
    section,
    scheduleWith(
      { course_id: "CCE 3", credits: 4, status: "planned" },
      { course_id: "CCE 120", credits: 4, status: "planned" }
    )
  );
  assert.equal(both.projected, true);
  assert.deepEqual(
    both.requirementResults
      .filter((r) => r.status !== "fulfilled")
      .map((r) => [r.title, r.projected, r.matchedCourses.map((c) => c.course_id)]),
    [
      ["Critical Community Engagement 3", true, ["CCE 3"]],
      ["Critical Community Engagement 120", true, ["CCE 120"]],
    ]
  );
});

test("one planned course can credit separate audit sections", () => {
  // Attribute / GE overlap is real: ENVR 30 can be JTCCER and also count
  // toward another category. Exclusivity is within a section, not global.
  const jtccer = {
    title: "Jane Teranes Climate Change Education (JTCCER)One course required",
    status: "not_fulfilled",
    subrequirements: [
      {
        status: "not_fulfilled",
        needType: "courses",
        needAmount: 1,
        availableCodes: [],
      },
    ],
  };
  const elective = {
    title: "ELECTIVES",
    status: "not_fulfilled",
    items: ["NEEDS: 1 more Courses | Available: ENVR 30"],
  };
  const schedule = scheduleWith({
    course_id: "ENVR 30",
    credits: 4,
    status: "planned",
  });
  assert.equal(evaluateRequirement(jtccer, schedule).projected, true);
  assert.equal(evaluateRequirement(elective, schedule).projected, true);
});

test("flat completed items are re-homed onto matching open subrequirements", () => {
  // Pre-fix saved audits put every taken course on section.items. MUS 20R
  // must land on Arts (via Available match), not stay as an uncategorized
  // Breadth leftover while only planned MUS 11 appears in the Arts block.
  const section = {
    title: "Breadth Requirements",
    status: "not_fulfilled",
    items: [
      "MUS 20R - Exploring the Musical Mind (WI26, A)",
      "PHIL 35 - Philosophy in the Americas (WI25, A)",
      "BILD 1 - The Cell (SP22, TP)",
      "NEEDS: 1 Courses | Available: MUS 11, MUS 20R, VIS 1",
      "NEEDS: 1 Courses | Available: PHIL 35, AAS 10",
    ],
    subrequirements: [
      {
        title: "ARTS - TWO 4 UNIT COURSES",
        status: "not_fulfilled",
        needType: "courses",
        needAmount: 1,
        availableCodes: ["MUS 11", "MUS 20R", "VIS 1"],
      },
      {
        title: "HUMANITIES - TWO 4 UNIT COURSES",
        status: "not_fulfilled",
        needType: "courses",
        needAmount: 1,
        availableCodes: ["PHIL 35", "AAS 10"],
      },
    ],
  };
  const result = evaluateRequirement(
    section,
    scheduleWith({ course_id: "MUS 11", credits: 4, status: "planned" })
  );
  const arts = result.requirementResults[0];
  const humanities = result.requirementResults[1];

  assert.deepEqual(
    arts.completedCourses.map((c) => c.course_id),
    ["MUS 20R"]
  );
  assert.deepEqual(
    humanities.completedCourses.map((c) => c.course_id),
    ["PHIL 35"]
  );
  assert.equal(arts.matchedCourses[0].course_id, "MUS 11");
});

test("parsed completedCourses on a subrequirement are preserved", () => {
  const section = {
    title: "Breadth Requirements",
    status: "not_fulfilled",
    items: ["MUS 20R - Exploring the Musical Mind (WI26, A)"],
    subrequirements: [
      {
        title: "ARTS - TWO 4 UNIT COURSES",
        status: "not_fulfilled",
        needType: "courses",
        needAmount: 1,
        availableCodes: ["MUS 11", "MUS 20R"],
        completedCourses: [
          {
            course_id: "MUS 20R",
            display: "MUS 20R - Exploring the Musical Mind (WI26, A)",
          },
        ],
      },
    ],
  };
  const result = evaluateRequirement(section, []);
  assert.equal(result.requirementResults[0].completedCourses.length, 1);
  assert.equal(
    result.requirementResults[0].completedCourses[0].course_id,
    "MUS 20R"
  );
});

// "Minimum of 48 upper division units in the major" names no courses of its
// own, so a level-only filter let any upper-division course count and a plan
// padded with unrelated electives projected the major requirement satisfied.
// The audit's own major rows are the authority on what counts.
const majorSections = (unitsNeeded) => [
  {
    title: "Data Science BS Upper Division Requirements and Major GPA",
    status: "not_fulfilled",
    items: ["NEEDS: 2 Courses | Available: DSC 100, DSC 102"],
    subrequirements: [
      {
        title: "Core",
        status: "not_fulfilled",
        needType: "courses",
        needAmount: 2,
        groups: [["DSC 100"], ["DSC 102"]],
        availableCodes: ["DSC 100", "DSC 102"],
      },
    ],
  },
  {
    title: "48 Upper Division Unit Requirement",
    status: "not_fulfilled",
    items: [`NEEDS: ${unitsNeeded} Units`],
    subrequirements: [
      {
        title: "Minimum of 48 upper division units in the major",
        status: "not_fulfilled",
        needType: "units",
        needAmount: unitsNeeded,
        groups: [],
        availableCodes: [],
      },
    ],
  },
];

test("'in the major' unit rows ignore upper-division courses outside the major", () => {
  const offMajor = calculateAuditProgress(
    majorSections(8),
    scheduleWith(
      { course_id: "SOCI 188", credits: 4, status: "planned" },
      { course_id: "PHIL 170", credits: 4, status: "planned" }
    )
  );
  assert.equal(offMajor.sectionProgress[1].requirementResults[0].progress, 0);
  assert.equal(offMajor.sectionProgress[1].projected, false);

  const inMajor = calculateAuditProgress(
    majorSections(8),
    scheduleWith(
      { course_id: "DSC 100", credits: 4, status: "planned" },
      { course_id: "DSC 102", credits: 4, status: "planned" }
    )
  );
  assert.equal(inMajor.sectionProgress[1].requirementResults[0].progress, 8);
  assert.equal(inMajor.sectionProgress[1].projected, true);
});

test("a level-scoped unit row with no major list still counts any course at that level", () => {
  // "Take at Least 60 Units" is the university-wide upper-division rule, not a
  // major rule — narrowing it would understate every student's progress.
  const sections = [
    {
      title: "Minimum Upper Division Units",
      status: "not_fulfilled",
      items: ["NEEDS: 4 Units"],
      subrequirements: [
        {
          title: "Take at Least 60 Units",
          status: "not_fulfilled",
          needType: "units",
          needAmount: 4,
          groups: [],
          availableCodes: [],
        },
      ],
    },
  ];
  const progress = calculateAuditProgress(
    sections,
    scheduleWith({ course_id: "SOCI 188", credits: 4, status: "planned" })
  );
  assert.equal(progress.sectionProgress[0].requirementResults[0].progress, 4);
});
