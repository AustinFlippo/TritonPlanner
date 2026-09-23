import { useState, useEffect, useRef } from "react";
import {
  CircleUserRound,
  Check,
  CirclePlay,
  CloudOff,
  Loader2,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { isAdmin } from "../utils/termSections";
import TritonMark from "./TritonMark";
import ConfirmDialog from "./ConfirmDialog";
import { useHowItWorks } from "./HowItWorks";

const NAV_ITEMS = [
  { key: "planner", label: "Planner" },
  { key: "quarter", label: "Quarter View" },
  { key: "storage", label: "Saved Plans" },
  // Only rendered for accounts in `app_admins`; everyone else never sees it.
  { key: "admin", label: "Admin", adminOnly: true },
];

const GoogleIcon = () => (
  <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true">
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </svg>
);

const SyncBadge = ({ status, compact = false }) => {
  if (!status || status === "idle") return null;

  const config = {
    saving: { icon: Loader2, text: "Saving…", spin: true },
    saved: { icon: Check, text: "Saved" },
    local: { icon: Check, text: "Saved on this device" },
    error: { icon: CloudOff, text: "Save failed" },
  }[status];

  if (!config) return null;
  const Icon = config.icon;

  // The phone header has no room for "Saved on this device" — the icon alone
  // carries the state, with the words kept in the accessible label.
  if (compact) {
    return (
      <span
        className={`flex items-center ${
          status === "error" ? "text-red-300" : "text-navy-200"
        }`}
        title={config.text}
        aria-label={config.text}
      >
        <Icon size={15} className={config.spin ? "animate-spin" : undefined} />
      </span>
    );
  }

  return (
    <span
      className={`flex items-center gap-1.5 text-xs ${
        status === "error" ? "text-red-300" : "text-navy-200"
      }`}
      title={
        status === "local"
          ? "Sign in to sync your plan across devices"
          : undefined
      }
    >
      <Icon size={13} className={config.spin ? "animate-spin" : undefined} />
      {config.text}
    </span>
  );
};

const Header = ({ currentPage, onNavigate, syncStatus, isCompact = false }) => {
  const { user, signInWithGoogle, logout } = useAuth();
  const { setOpen: openHowItWorks } = useHowItWorks();
  // Membership of `app_admins` is what actually gates publishing — row-level
  // security enforces it server-side. Hiding the tab is only so the other 99%
  // of students never see a page that isn't theirs.
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [alertMessage, setAlertMessage] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Close the phone overflow menu on outside tap / Escape
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false);
    };
    const onKeyDown = (e) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  // The tab bar owns Planner / Quarter View on a phone, so the menu only
  // carries what has nowhere else to live.
  useEffect(() => {
    if (!isCompact) setMenuOpen(false);
  }, [isCompact]);

  useEffect(() => {
    if (!user) {
      setIsAdminUser(false);
      return;
    }
    let cancelled = false;
    isAdmin().then((ok) => !cancelled && setIsAdminUser(ok));
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleSignIn = async () => {
    try {
      await signInWithGoogle(); // redirects to Google, then back here
    } catch (err) {
      setAlertMessage(err.message || "Sign-in failed. Please try again.");
    }
  };

  const menuItems = NAV_ITEMS.filter(
    (item) => !item.adminOnly || isAdminUser
  ).filter((item) => item.key !== "planner" && item.key !== "quarter");

  if (isCompact) {
    return (
      <>
        <header className="bg-navy-800 flex items-center gap-2 px-4 h-14 flex-shrink-0 pt-[env(safe-area-inset-top)] box-content">
          <span className="flex items-center gap-2 select-none min-w-0">
            <TritonMark size={18} className="text-gold-400 flex-shrink-0" title="TritonPlanner" />
            <span className="font-serif text-[17px] font-semibold tracking-tight text-white truncate">
              TritonPlanner<span className="text-gold-400">.</span>
            </span>
          </span>

          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            <SyncBadge status={syncStatus} compact />

            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                className="w-10 h-10 -mr-2 flex items-center justify-center rounded-lg text-navy-100 active:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
              >
                {menuOpen ? <X size={20} /> : <Menu size={20} />}
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-2 w-60 z-50 rounded-xl bg-white border border-slate-200 shadow-panel py-1.5 overflow-hidden"
                >
                  {user && (
                    <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2 min-w-0">
                      <CircleUserRound size={18} className="text-navy-500 flex-shrink-0" />
                      <span className="text-sm text-slate-600 truncate">
                        {user.name || user.email}
                      </span>
                    </div>
                  )}

                  {menuItems.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onNavigate(item.key);
                      }}
                      className={`w-full px-3 py-2.5 text-left text-sm transition-colors active:bg-slate-100 ${
                        currentPage === item.key
                          ? "font-semibold text-navy-700 bg-navy-50/60"
                          : "text-slate-700"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      openHowItWorks(true);
                    }}
                    className="w-full px-3 py-2.5 flex items-center gap-2 text-left text-sm text-slate-700 transition-colors active:bg-slate-100"
                  >
                    <CirclePlay size={15} className="text-navy-500 flex-shrink-0" />
                    Watch demo
                  </button>

                  <div className="my-1 border-t border-slate-100" />

                  {user ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        logout();
                      }}
                      className="w-full px-3 py-2.5 flex items-center gap-2 text-left text-sm text-slate-700 transition-colors active:bg-slate-100"
                    >
                      <LogOut size={15} className="text-slate-400 flex-shrink-0" />
                      Sign out
                    </button>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        handleSignIn();
                      }}
                      className="w-full px-3 py-2.5 flex items-center gap-2 text-left text-sm font-medium text-slate-700 transition-colors active:bg-slate-100"
                    >
                      <GoogleIcon />
                      Sign in with Google
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        <ConfirmDialog
          open={Boolean(alertMessage)}
          variant="alert"
          title="Sign-in failed"
          message={alertMessage}
          confirmLabel="OK"
          onConfirm={() => setAlertMessage(null)}
          onCancel={() => setAlertMessage(null)}
        />
      </>
    );
  }

  return (
    <>
      <header className="bg-navy-800 flex items-center gap-8 px-5 h-14 flex-shrink-0">
        {/* Logo lockup */}
        <span className="flex items-center gap-2 select-none">
          <TritonMark size={20} className="text-gold-400" title="TritonPlanner" />
          <span className="font-serif text-[19px] font-semibold tracking-tight text-white">
            TritonPlanner<span className="text-gold-400">.</span>
          </span>
        </span>

        {/* Page navigation */}
        <nav className="flex items-center gap-1" aria-label="Pages">
          {NAV_ITEMS.filter((item) => !item.adminOnly || isAdminUser).map((item) => {
            const active = currentPage === item.key;
            return (
              <button
                key={item.key}
                onClick={() => onNavigate(item.key)}
                className={`px-3.5 py-1.5 text-sm rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 ${
                  active
                    ? "bg-white/15 text-white font-medium"
                    : "text-navy-200 hover:text-white hover:bg-white/10"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Right side: demo + save status + account */}
        <div className="ml-auto flex items-center gap-4">
          <button
            type="button"
            onClick={() => openHowItWorks(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full text-navy-200 hover:text-white hover:bg-white/10 transition-colors whitespace-nowrap flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
          >
            <CirclePlay size={15} />
            Watch demo
          </button>
          <SyncBadge status={syncStatus} />

          {user ? (
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-2 text-sm text-navy-100">
                <CircleUserRound size={18} className="text-gold-400" />
                {user.name || user.email}
              </span>
              <button
                onClick={logout}
                className="px-3 py-1.5 text-sm rounded-full text-navy-200 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              onClick={handleSignIn}
              className="flex items-center gap-2 px-4 py-1.5 text-sm rounded-full bg-white text-slate-700 font-medium hover:bg-slate-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
            >
              <GoogleIcon />
              Sign in with Google
            </button>
          )}
        </div>
      </header>

      <ConfirmDialog
        open={Boolean(alertMessage)}
        variant="alert"
        title="Sign-in failed"
        message={alertMessage}
        confirmLabel="OK"
        onConfirm={() => setAlertMessage(null)}
        onCancel={() => setAlertMessage(null)}
      />
    </>
  );
};

export default Header;
