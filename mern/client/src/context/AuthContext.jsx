import { createContext, useContext, useState, useEffect, useRef } from "react";
import { supabase, supabaseConfigured } from "../utils/supabase";
import { oauthRedirectTo } from "../utils/authRedirect";
import {
  SIGN_IN_MIGRATION_KEY,
  clearDeviceLocalPlanState,
} from "../utils/plannerStateStore";

const AuthContext = createContext(null);

// Supabase user -> the shape the app uses everywhere
const mapUser = (u) =>
  u
    ? {
        id: u.id,
        email: u.email,
        name: u.user_metadata?.full_name || u.user_metadata?.name || null,
      }
    : null;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);
  // True when the session dropped WITHOUT the user asking to sign out — an
  // expired/rotated refresh token, or a multi-tab refresh race. MainLayout
  // reads this to keep the plan and audit on screen (and on disk) instead of
  // treating the drop as an account departure and wiping them.
  const [sessionExpired, setSessionExpired] = useState(false);
  const explicitSignOutRef = useRef(false);

  useEffect(() => {
    // Leftover token from the pre-Supabase auth implementation
    localStorage.removeItem("tp_auth_token");

    if (!supabase) {
      setInitializing(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(mapUser(session?.user));
      setInitializing(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = mapUser(session?.user);
      setUser((prev) => {
        if (!next && prev && !explicitSignOutRef.current) {
          setSessionExpired(true);
        }
        if (next) {
          setSessionExpired(false);
          explicitSignOutRef.current = false;
        }
        return next;
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    if (!supabase) {
      throw new Error(
        "Supabase isn't configured yet — add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to mern/client/.env and restart the dev server."
      );
    }

    // OAuth reloads the app. Send Google back to this origin (localhost vs
    // production) so a local sign-in does not land on the public site.
    // Remember that this sign-in started from the current browser session so
    // MainLayout can keep its local plan instead of replacing it with an
    // older plan already stored on the account.
    localStorage.setItem(SIGN_IN_MIGRATION_KEY, "pending");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: oauthRedirectTo(window.location) },
    });
    if (error) {
      localStorage.removeItem(SIGN_IN_MIGRATION_KEY);
      throw error;
    }
  };

  const logout = async () => {
    // Mark this drop as intentional BEFORE signOut fires the auth event, so
    // the listener doesn't misread it as an expired session.
    explicitSignOutRef.current = true;
    setSessionExpired(false);
    if (supabase) await supabase.auth.signOut();
    // The device copies of the plan and the saved-plan library are anonymous
    // browser state, not account state — the account's own copies are safe in
    // Supabase. Leaving them behind handed the next person on a shared machine
    // this student's degree audit, and let their first edit be uploaded over
    // their own account plan.
    clearDeviceLocalPlanState();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        initializing,
        sessionExpired,
        signInWithGoogle,
        logout,
        supabaseConfigured,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// The standard context pattern: the hook belongs beside the provider it reads.
// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
