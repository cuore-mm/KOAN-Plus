import { Component, StrictMode, useState, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Onboarding from "./Onboarding";
import { loadOnboardingRecord, saveOnboardingRecordResult } from "./storage";
import { loadTheme } from "./ThemeToggle";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found.");
document.documentElement.setAttribute("data-theme", loadTheme());

function Root() {
  const [onboardingComplete, setOnboardingComplete] = useState(() => Boolean(loadOnboardingRecord()));
  const [openSettings, setOpenSettings] = useState(false);

  if (!onboardingComplete) {
    return (
      <Onboarding onComplete={(shouldOpenSettings) => {
        const saved = saveOnboardingRecordResult();
        if (!saved.ok) return false;
        setOpenSettings(shouldOpenSettings);
        setOnboardingComplete(true);
        return true;
      }} />
    );
  }

  return <App initialView={openSettings ? "settings" : "dashboard"} />;
}

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { error: Error | null };

/**
 * Rendering failures should be recoverable in a long-running extension. A
 * malformed cache or an unexpected API shape must not leave a blank tab with
 * no way back to the dashboard.
 */
class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("KOAN Plus UI crashed", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-error-boundary" role="alert" aria-labelledby="app-error-title">
          <section className="app-error-card">
            <p className="app-error-kicker">KOAN Plus</p>
            <h1 id="app-error-title">画面を表示できませんでした</h1>
            <p>
              一時的なエラーが発生しました。保存済みの認証情報は削除せず、まず画面を再読み込みしてください。
            </p>
            <div className="app-error-actions">
              <button type="button" onClick={() => window.location.reload()}>
                再読み込み
              </button>
            </div>
            <details>
              <summary>エラーの詳細</summary>
              <code>{this.state.error.message || "Unknown error"}</code>
            </details>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

createRoot(root).render(<StrictMode><AppErrorBoundary><Root /></AppErrorBoundary></StrictMode>);
