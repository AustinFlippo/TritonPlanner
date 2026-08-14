function courseDisplay(course) {
  if (!course) return "";
  return course.course_id || course.code || course.title || "";
}

function termUnits(courses) {
  if (!courses || courses.length === 0) return "";
  const total = courses.reduce((sum, course) => {
    if (!course) return sum;
    const units = course.credits || course.units || course.credit || 0;
    const parsed = parseFloat(units);
    return sum + (Number.isNaN(parsed) ? 0 : parsed);
  }, 0);
  return total > 0 ? String(total) : "";
}

function csvCell(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function scheduleToCsv(schedule, yearLabels) {
  const rows = [
    [
      "Year",
      "Quarter",
      "Course Slot 1",
      "Course Slot 2",
      "Course Slot 3",
      "Term Units",
      "Notes",
    ],
  ];

  (schedule || []).forEach((year, yearIndex) => {
    const yearLabel = yearLabels?.[yearIndex] ?? "";
    for (const quarter of ["Fall", "Winter", "Spring"]) {
      const key = quarter.toLowerCase();
      const courses = year?.[key] || [];
      rows.push([
        yearLabel,
        quarter,
        courseDisplay(courses[0]),
        courseDisplay(courses[1]),
        courseDisplay(courses[2]),
        termUnits(courses),
        "",
      ]);
    }
  });

  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function downloadCsv(filename, csv) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
