import { createContext, useContext, useEffect, useState } from "react";
import { CirclePlay, ExternalLink, X } from "lucide-react";

export const DEMO_VIDEO_URL = "https://youtu.be/NC7Q9cH84UU";
export const DEMO_VIDEO_ID = "NC7Q9cH84UU";
const DEMO_EMBED_URL = `https://www.youtube-nocookie.com/embed/${DEMO_VIDEO_ID}`;

const STEPS = [
  {
    title: "Upload your degree audit",
    body: "In TritonLink, open Degree Audit and save the page as HTML. Drop that file on the left — completed courses land on the grid, leftover requirements stay in the sidebar.",
  },
  {
    title: "Find classes that fill what's left",
    body: "Search the catalog on the right, or toggle next-quarter offerings. Drag a leftover requirement into search to see only courses that satisfy it, then drop one onto a term.",
  },
  {
    title: "Check the week, then ask the assistant",
    body: "Quarter View flags time conflicts. Click a course for professors and ratings. Or ask the assistant to plan the rest — it keeps seats, prereqs, and your remaining requirements in mind.",
  },
  {
    title: "Save the plan",
    body: "Sign in with Google and name the plan so you can reload it next time. Export to CSV if you want a spreadsheet copy.",
  },
];

const HowItWorksContext = createContext(null);

export const useHowItWorks = () => {
  const ctx = useContext(HowItWorksContext);
  if (!ctx) {
    throw new Error("useHowItWorks must be used inside HowItWorksProvider");
  }
  return ctx;
};

export const HowItWorksProvider = ({ children }) => {
  const [open, setOpen] = useState(false);
  return (
    <HowItWorksContext.Provider value={{ open, setOpen }}>
      {children}
      <HowItWorksDialog open={open} onClose={() => setOpen(false)} />
    </HowItWorksContext.Provider>
  );
};

export const WatchDemoButton = ({
  className = "",
  children = "Watch demo",
}) => {
  const { setOpen } = useHowItWorks();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={className}
    >
      {children}
    </button>
  );
};

const HowItWorksDialog = ({ open, onClose }) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="how-it-works-title"
        className="w-full max-w-xl max-h-[min(90vh,44rem)] overflow-y-auto rounded-xl bg-white border border-slate-200 shadow-panel"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-5 pt-5 pb-3 bg-white">
          <div>
            <h2
              id="how-it-works-title"
              className="text-base font-semibold text-slate-800"
            >
              How TritonPlanner works
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Two minutes, then the same steps in writing.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4">
          <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-navy-900">
            <iframe
              src={DEMO_EMBED_URL}
              title="TritonPlanner demo"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="absolute inset-0 w-full h-full border-0"
            />
          </div>

          <a
            href={DEMO_VIDEO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-navy-600 hover:text-navy-800"
          >
            Open on YouTube
            <ExternalLink size={12} />
          </a>

          <ol className="space-y-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-navy-700 text-white text-[11px] font-semibold tabular-nums">
                  {i + 1}
                </span>
                <div className="min-w-0 pt-0.5">
                  <div className="text-sm font-semibold text-slate-800">
                    {step.title}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
};

export const WatchDemoLink = ({ className = "", label = "Watch a 2-min demo" }) => (
  <WatchDemoButton
    className={`inline-flex items-center gap-1.5 text-xs font-medium text-navy-600 hover:text-navy-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 rounded ${className}`}
  >
    <CirclePlay className="w-3.5 h-3.5" />
    {label}
  </WatchDemoButton>
);

export default HowItWorksDialog;
