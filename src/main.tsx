import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Onboarding from "./Onboarding";
import { loadOnboardingRecord, saveOnboardingRecord } from "./storage";
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
        saveOnboardingRecord();
        setOpenSettings(shouldOpenSettings);
        setOnboardingComplete(true);
      }} />
    );
  }

  return <App initialView={openSettings ? "settings" : "dashboard"} />;
}

createRoot(root).render(<StrictMode><Root /></StrictMode>);
