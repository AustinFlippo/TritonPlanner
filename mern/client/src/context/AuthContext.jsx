import { createContext, useContext, useState, useEffect } from "react";
import { supabase, supabaseConfigured } from "../utils/supabase";

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
      setUser(mapUser(session?.user));
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    if (!supabase) {
      throw new Error(
        "Supabase isn't configured yet — add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to mern/client/.env and restart the dev server."
      );
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  };

  const logout = async () => {
    if (supabase) await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, initializing, signInWithGoogle, logout, supabaseConfigured }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
