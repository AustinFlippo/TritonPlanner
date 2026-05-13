import { useAuth } from "../../context/AuthContext";

const SignInButton = () => {
  const { currentUser, signInWithGoogle, signOutUser } = useAuth();

  if (currentUser === undefined) return null;

  if (currentUser) {
    return (
      <div className="flex items-center gap-2">
        {currentUser.photoURL && (
          <img
            src={currentUser.photoURL}
            alt={currentUser.displayName}
            className="w-7 h-7 rounded-full"
          />
        )}
        <span style={{ color: "white", fontSize: "12px" }}>
          {currentUser.displayName}
        </span>
        <button
          onClick={signOutUser}
          style={{
            fontSize: "11px",
            color: "#7db8e8",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "0 4px",
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={signInWithGoogle}
      style={{
        fontSize: "12px",
        fontWeight: 600,
        color: "white",
        background: "#0066cc",
        border: "none",
        borderRadius: "4px",
        padding: "5px 12px",
        cursor: "pointer",
      }}
    >
      Sign in with Google
    </button>
  );
};

export default SignInButton;
