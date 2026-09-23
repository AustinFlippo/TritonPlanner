import { CalendarRange, GraduationCap, LayoutList, Sparkles } from "lucide-react";

// Bottom navigation for phones. The desktop workspace shows requirements,
// planner and assistant side by side; a phone can only hold one at a time, so
// the three columns become three destinations (plus Quarter View, which is the
// week-by-week lens students actually open during enrollment).
const TABS = [
  { key: "plan", label: "Plan", icon: LayoutList },
  { key: "quarter", label: "Quarter", icon: CalendarRange },
  { key: "progress", label: "Progress", icon: GraduationCap },
  { key: "assistant", label: "Assistant", icon: Sparkles },
];

const MobileTabBar = ({ active, onSelect }) => (
  <nav
    aria-label="Sections"
    className="flex-shrink-0 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]"
  >
    {TABS.map(({ key, label, icon: Icon }) => {
      const isActive = active === key;
      return (
        <button
          key={key}
          type="button"
          onClick={() => onSelect(key)}
          aria-current={isActive ? "page" : undefined}
          aria-label={label}
          // 56px tall: comfortably above the 44px minimum touch target.
          className={`flex-1 h-14 flex flex-col items-center justify-center gap-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-400 ${
            isActive ? "text-navy-700" : "text-slate-400 active:bg-slate-50"
          }`}
        >
          <Icon className="w-5 h-5" strokeWidth={isActive ? 2.25 : 1.75} />
          <span
            className={`text-[10px] leading-none ${
              isActive ? "font-semibold" : "font-medium"
            }`}
          >
            {label}
          </span>
        </button>
      );
    })}
  </nav>
);

export default MobileTabBar;
