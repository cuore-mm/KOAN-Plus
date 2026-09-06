import { recordStorageDiagnostic, THEME_KEY } from "./storage";

export type Theme = "light" | "dark";

export function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "dark" ? "dark" : "light";
  } catch (error) {
    recordStorageDiagnostic(THEME_KEY, "read", error);
    return "light";
  }
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
    return true;
  } catch (error) {
    recordStorageDiagnostic(THEME_KEY, "write", error);
    return false;
  }
}

export default function ThemeToggle({
  onToggle,
  theme,
}: {
  onToggle: () => void;
  theme: Theme;
}) {
  return (
    <div className="theme-toggle-container">
      <button
        type="button"
        className="theme-toggle-btn"
        aria-label={theme === "light" ? "ダークモードに切り替え" : "ライトモードに切り替え"}
        onClick={onToggle}
      >
        {theme === "light" ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide-icon moon">
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide-icon sun">
            <circle cx="12" cy="12" r="4"/>
            <path d="M12 2v2"/>
            <path d="M12 20v2"/>
            <path d="m4.93 4.93 1.41 1.41"/>
            <path d="m17.66 17.66 1.41 1.41"/>
            <path d="M2 12h2"/>
            <path d="M20 12h2"/>
            <path d="m6.34 17.66-1.41 1.41"/>
            <path d="m19.07 4.93-1.41 1.41"/>
          </svg>
        )}
      </button>
    </div>
  );
}
