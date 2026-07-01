import { FormEvent, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../state/auth";

interface LocationState {
  from?: { pathname?: string };
}

type Mode = "signin" | "signup";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, register, error, clearError } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const signup = mode === "signup";

  const switchMode = (next: Mode) => {
    setMode(next);
    setConfirmPassword("");
    setLocalError("");
    clearError();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setLocalError("");
    if (signup && password !== confirmPassword) {
      setLocalError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    const submit = signup ? register : login;
    const ok = await submit(username.trim(), password);
    setSubmitting(false);
    if (ok) {
      const state = location.state as LocationState | null;
      const target = state?.from?.pathname || "/search";
      navigate(target, { replace: true });
    }
  };

  const shownError = localError || error;

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>{signup ? "Create account" : "Sign in"}</h1>
        <p>
          {signup
            ? "Pick a username and password for your new Soulseek account."
            : "Log in with your Soulseek credentials."}
        </p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label className="login-field">
            <span>Username</span>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className="login-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={signup ? "new-password" : "current-password"}
              required
            />
          </label>
          {signup ? (
            <label className="login-field">
              <span>Confirm password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
            </label>
          ) : null}
          {submitting ? (
            <div className="login-info">Contacting the Soulseek server…</div>
          ) : shownError ? (
            <div className="login-error">{shownError}</div>
          ) : null}
          <button type="submit" disabled={submitting}>
            {signup
              ? submitting ? "Creating account..." : "Create account"
              : submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="login-switch">
          {signup ? (
            <>
              Already have an account?{" "}
              <button type="button" className="link-button" onClick={() => switchMode("signin")}>
                Sign in
              </button>
            </>
          ) : (
            <>
              New to Soulseek?{" "}
              <button type="button" className="link-button" onClick={() => switchMode("signup")}>
                Register
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
