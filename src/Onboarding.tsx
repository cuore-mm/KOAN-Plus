import { useEffect, useState } from "react";
import privacyDocument from "../PRIVACY.md?raw";
import termsDocument from "../TERMS.md?raw";
import { loadAuthSettings, saveAuthSettings } from "./auth";
import ThemeToggle, { loadTheme } from "./ThemeToggle";

type OnboardingProps = {
  onComplete: (openSettings: boolean) => void;
};

type Step = "welcome" | "credentials";
type LegalDocument = "terms" | "privacy";

function plainLegalText(document: string) {
  return document
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/^- /gm, "• ");
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [theme, setTheme] = useState(loadTheme);
  const [accepted, setAccepted] = useState(false);
  const [legalDocument, setLegalDocument] = useState<LegalDocument | null>(null);
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [existingCredentials, setExistingCredentials] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    void loadAuthSettings()
      .then((settings) => setExistingCredentials(settings.configured))
      .catch(() => setExistingCredentials(false));
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("koan-plus-theme", theme);
  }, [theme]);

  const saveCredentials = async () => {
    if (!id.trim() || !password) return;
    setSaving(true);
    setStatus("");
    try {
      await saveAuthSettings({
        enabled: true,
        id: id.trim(),
        password,
        totpSecret: "",
        mfaConsent: false,
        mfaEnabled: false,
      });
      setPassword("");
      onComplete(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const finish = (openSettings: boolean) => {
    onComplete(openSettings);
  };

  const stepNumber = step === "welcome" ? 1 : 2;
  const privacyJapanese = privacyDocument.includes("## 日本語")
    ? `# プライバシーポリシー\n\n${privacyDocument.split("## 日本語")[1].trim()}`
    : privacyDocument;

  return (
    <main className="page-layout onboarding-shell">
      <section className="onboarding-panel" aria-labelledby="onboarding-title">
        <header className="onboarding-header">
          <div>
            <p>初回設定</p>
            <h1>
              {step === "welcome" ? "KOAN Plusへようこそ" : "自動ログイン設定"}
            </h1>
          </div>
          <div className="topbar-actions">
            <ThemeToggle onToggle={() => setTheme(theme === "light" ? "dark" : "light")} theme={theme} />
          </div>
        </header>

        {existingCredentials === false && (
          <div className="onboarding-progress" aria-label={`全2ステップ中${stepNumber}ステップ目`}>
            {["利用規約", "ログイン設定"].map((label, index) => (
              <div className={stepNumber >= index + 1 ? "active" : ""} key={label}>
                <span />
                <small>{label}</small>
              </div>
            ))}
          </div>
        )}

        <div className="onboarding-content">
          {step === "welcome" && (
            <div className="settings-form-block">
              <div className="section-heading compact">
                <div>
                  <h2 id="onboarding-title">利用規約とプライバシーポリシー</h2>
                  <p>内容を確認してから次へ進んでください。</p>
                </div>
              </div>

              <div className="onboarding-legal-links">
                <button onClick={() => setLegalDocument("terms")} type="button">利用規約を読む</button>
                <button onClick={() => setLegalDocument("privacy")} type="button">プライバシーポリシーを読む</button>
              </div>

              <label className="onboarding-consent">
                <input checked={accepted} onChange={(event) => setAccepted(event.target.checked)} type="checkbox" />
                <span>利用規約に同意し、プライバシーポリシーを確認しました。</span>
              </label>

              <div className="settings-actions onboarding-actions onboarding-actions-end">
                <div className="onboarding-actions-right">
                  <button
                    className="primary-action"
                    disabled={!accepted || existingCredentials === null}
                    onClick={() => existingCredentials ? finish(false) : setStep("credentials")}
                    type="button"
                  >
                    {existingCredentials ? "同意して利用開始" : "同意して次へ"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === "credentials" && (
            <div className="settings-form-block">
              <div className="section-heading compact">
                <div>
                  <h2 id="onboarding-title">自動ログインを設定</h2>
                  <p>個人IDとパスワードを保存すると、KOAN/CLEのログイン画面へ自動入力できます。設定は任意です。</p>
                </div>
              </div>

              <div className="settings-grid onboarding-form">
                <label>
                  <span>大阪大学個人ID</span>
                  <input autoComplete="username" onChange={(event) => setId(event.target.value)} value={id} />
                </label>
                <label>
                  <span>パスワード</span>
                  <input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
                </label>
              </div>

              <p className="onboarding-storage-note">認証情報は暗号化してこの端末内に保存します。共用端末では設定しないでください。</p>
              {status && <p className="settings-status onboarding-status" role="alert">{status}</p>}

              <div className="settings-actions onboarding-actions">
                <div className="onboarding-actions-left">
                  <button className="secondary-action" onClick={() => setStep("welcome")} type="button">戻る</button>
                </div>
                <div className="onboarding-actions-right">
                  <button className="subtle-action" disabled={saving} onClick={() => finish(false)} type="button">あとで設定</button>
                  <button className="primary-action" disabled={saving || !id.trim() || !password} onClick={() => void saveCredentials()} type="button">
                    {saving ? "保存中..." : "保存して利用開始"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {legalDocument && (
        <div className="onboarding-modal-overlay" onMouseDown={() => setLegalDocument(null)}>
          <section className="onboarding-legal-modal" aria-modal="true" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <h2>{legalDocument === "terms" ? "利用規約" : "プライバシーポリシー"}</h2>
              <button aria-label="閉じる" onClick={() => setLegalDocument(null)} type="button">閉じる</button>
            </header>
            <pre>{plainLegalText(legalDocument === "terms" ? termsDocument : privacyJapanese)}</pre>
          </section>
        </div>
      )}
    </main>
  );
}
