/** Popup: a read-only status view over what the service worker has stored. */

const $ = (id) => document.getElementById(id);

function send(type) {
  return new Promise((resolve) => chrome.runtime.sendMessage({ type }, resolve));
}

function renderPlan(plan) {
  if (!plan) {
    $("plan-status").textContent = "none loaded";
    return;
  }

  $("plan-status").textContent = `${plan.termCode} · pass ${plan.pass}`;
  $("plan-status").classList.add("ok");
  $("plan-detail").classList.remove("hidden");

  const deferred = plan.deferred?.length
    ? ` · ${plan.deferred.length} deferred`
    : "";
  $("plan-summary").textContent =
    `${plan.steps.length} to book · ${plan.totalUnits}/${plan.unitCap} units${deferred}`;

  const list = $("plan-steps");
  list.innerHTML = "";
  for (const step of plan.steps) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = step.courseId;
    const units = document.createElement("span");
    units.className = "units";
    units.textContent = ` · ${step.units}u`;
    item.append(name, units);

    const reason = step.criticality?.reasons?.[0];
    if (reason) {
      const why = document.createElement("span");
      why.className = "why";
      why.textContent = reason;
      item.appendChild(why);
    }
    list.appendChild(item);
  }
}

async function refresh() {
  const [planResponse, sectionResponse] = await Promise.all([
    send("TPBB_GET_PLAN"),
    send("TPBB_GET_SECTIONS"),
  ]);

  renderPlan(planResponse?.plan);

  const courses = Object.keys(sectionResponse?.sections || {});
  const total = courses.reduce(
    (sum, id) => sum + sectionResponse.sections[id].length,
    0
  );
  $("section-status").textContent = courses.length
    ? `${total} across ${courses.length} courses`
    : "none yet";
  if (courses.length) $("section-status").classList.add("ok");

  // Mirrors selectors.js `verified`. Until a capture confirms them, say so.
  $("selector-status").classList.add("warn");
}

$("open-tss").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://sis.ucsd.edu/" });
});

$("clear").addEventListener("click", async () => {
  await send("TPBB_CLEAR");
  location.reload();
});

refresh();
