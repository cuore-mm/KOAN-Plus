import { useEffect, useMemo, useState } from "react";
import {
  BOARD_URL,
  GENRES,
  LIGHT_REFRESH_TTL_MS,
  PORTAL_URL,
  SNAPSHOT_TTL_MS,
  type ChangeItem,
  type CourseRegistration,
  type GradeData,
  type KoanData,
  type Notice,
  type ScheduleItem,
  attentionScore,
  mergeNotices,
  noticeKey,
  refreshGrades,
  refreshLight,
  refreshSnapshot,
  resolveNoticeUrl,
} from "./koan";
import {
  CLE_CALENDAR_URL,
  CLE_MESSAGES_URL,
  EMPTY_CLE_DATA,
  type CleData,
  type CleCourse,
  type CleTask,
  cleMessageUrl,
  cleCourseUrl,
  cleTaskUrl,
  refreshCle,
} from "./cle";
import {
  loadCache,
  loadCleCache,
  loadGradesCache,
  saveCache,
  saveCleCache,
  saveGradesCache,
} from "./storage";
import {
  type AuthSettings,
  deleteAuthSettings,
  ensureCleLogin,
  ensureKoanLogin,
  loadAuthSettings,
  refreshCleLogin,
  saveAuthSettings,
  getSavedMfaSecrets,
} from "./auth";
import QRCode from "qrcode";


const EMPTY = {
  schedule: [],
  courses: [],
  changes: [],
  notices: [],
  lightUpdatedAt: null,
  snapshotUpdatedAt: null,
};

const fmtTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("ja-JP", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "未取得";

const isExpired = (value: string | null, ttl: number) =>
  !value || Date.now() - new Date(value).getTime() >= ttl;

const compactStatus = (label: string, value: string) => value ? `${label}: ${value}` : "";

function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const stored = localStorage.getItem("koan-plus-theme");
    if (stored === "light" || stored === "dark") return stored;
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    localStorage.setItem("koan-plus-theme", theme);
  }, [theme]);

  const [data, setData] = useState<KoanData>(() => ({
    ...EMPTY,
    ...loadCache<KoanData>(),
  }));
  const [loading, setLoading] = useState(false);
  const [cleData, setCleData] = useState<CleData>(() => ({
    ...EMPTY_CLE_DATA,
    ...loadCleCache<CleData>(),
  }));
  const [cleLoading, setCleLoading] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [cleStatus, setCleStatus] = useState("");
  const [progress, setProgress] = useState("");
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("");
  const [scope, setScope] = useState("attention");
  const [view, setView] = useState<"dashboard" | "courses" | "reference" | "grades" | "settings">("dashboard");
  const [gradesData, setGradesData] = useState<GradeData | null>(() =>
    loadGradesCache<GradeData>(),
  );
  const [gradesLoading, setGradesLoading] = useState(false);
  const [gradesStatus, setGradesStatus] = useState("");

  const updateKoan = async () => {
    setLoading(true);
    setStatus("ログイン状態を確認中");
    try {
      if (!isExpired(data.lightUpdatedAt, LIGHT_REFRESH_TTL_MS)) {
        setStatus(`キャッシュ表示中 / 更新 ${fmtTime(data.lightUpdatedAt)}`);
        return;
      }
      const auth = await ensureKoanLogin();
      if (auth.loginStarted) setStatus("自動ログイン完了 / データ取得準備中");
      else setStatus("データ取得準備中");
      const result = await refreshLight(data.notices, (value) => {
        if (value) setStatus(value);
      });
      setData((current) => {
        const next = { ...current, ...result };
        saveCache(next);
        return next;
      });
      setStatus("更新しました");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const updateCle = async () => {
    setCleLoading(true);
    setCleStatus("CLEログイン状態を確認中");
    try {
      const auth = await ensureCleLogin();
      if (auth.loginStarted) setCleStatus("自動ログイン完了 / データ取得準備中");
      else setCleStatus("データ取得準備中");
      let next;
      try {
        next = await refreshCle(auth.tabId, (value) => {
          if (value) setCleStatus(value);
        });
      } catch {
        setCleStatus("セッションを再認証中");
        const refreshedAuth = await refreshCleLogin();
        next = await refreshCle(refreshedAuth.tabId, (value) => {
          if (value) setCleStatus(value);
        });
      }
      setCleData(next);
      saveCleCache(next);
      setCleStatus("CLE更新済み");
    } catch (error) {
      setCleStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCleLoading(false);
    }
  };

  const update = async () => {
    await Promise.all([updateKoan(), updateCle()]);
  };

  const syncSnapshot = async () => {
    setSnapshotLoading(true);
    setStatus("掲示スナップショットを同期中");
    try {
      const snapshot = await refreshSnapshot(setProgress);
      setData((current) => {
        const next = {
          ...current,
          ...snapshot,
          notices: mergeNotices([...snapshot.notices, ...current.notices]),
        };
        saveCache(next);
        return next;
      });
      setStatus("掲示スナップショットを同期しました");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setProgress("");
      setSnapshotLoading(false);
    }
  };

  const updateGrades = async () => {
    setGradesLoading(true);
    setGradesStatus("成績を取得中");
    try {
      const next = await refreshGrades(setGradesStatus);
      setGradesData(next);
      saveGradesCache(next);
      setGradesStatus("取得しました");
    } catch (error) {
      setGradesStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setGradesLoading(false);
    }
  };

  useEffect(() => {
    void update();
  }, []);

  const notices = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.notices
      .filter((notice) => {
        const text = [notice.title, notice.department, notice.author]
          .join(" ")
          .toLowerCase();
        if (needle && !text.includes(needle)) return false;
        if (genre && notice.genre !== genre) return false;
        if (scope === "unread" && !notice.unread) return false;
        if (scope === "important" && !isImportantNotice(notice)) return false;
        if (scope === "attention" && attentionScore(notice) < 120) return false;
        return true;
      })
      .sort((a, b) => attentionScore(b) - attentionScore(a));
  }, [data.notices, genre, query, scope]);

  const snapshotExpired = isExpired(data.snapshotUpdatedAt, SNAPSHOT_TTL_MS);
  const markNoticeRead = (openedNotice: Notice) => {
    const openedKey = noticeKey(openedNotice);
    setData((current) => {
      const notices = current.notices.map((notice) =>
        noticeKey(notice) === openedKey ? { ...notice, unread: false } : notice,
      );
      const next = { ...current, notices };
      saveCache(next);
      return next;
    });
  };

  const updateTimes = [data.lightUpdatedAt, cleData.updatedAt]
    .filter((value): value is string => Boolean(value))
    .sort();
  const latestUpdatedAt = updateTimes[updateTimes.length - 1] || null;
  const viewTitle = {
    dashboard: "ホーム",
    courses: "授業",
    reference: "掲示",
    grades: "成績",
    settings: "設定",
  }[view];
  const topbarState = view === "reference" ? {
    action: syncSnapshot,
    disabled: snapshotLoading || !snapshotExpired,
    label: snapshotLoading ? "同期中..." : snapshotExpired ? "掲示を同期" : "同期済み",
    status: snapshotLoading
      ? (progress || "掲示同期中...")
      : `掲示同期 ${fmtTime(data.snapshotUpdatedAt)}${snapshotExpired ? " / 更新推奨" : ""}`,
  } : view === "grades" ? {
    action: updateGrades,
    disabled: gradesLoading,
    label: gradesLoading ? "取得中..." : "成績を取得",
    status: gradesLoading
      ? (gradesStatus || "成績を取得中...")
      : `成績更新履歴 ${fmtTime(gradesData?.updatedAt ?? null)}`,
  } : {
    action: update,
    disabled: loading || cleLoading,
    label: loading || cleLoading ? "更新中..." : "更新",
    status: loading || cleLoading
      ? [
          compactStatus("KOAN", status),
          compactStatus("CLE", cleStatus),
        ].filter(Boolean).join(" / ") || "更新中..."
      : `更新済み ${fmtTime(latestUpdatedAt)}`,
  };

  return (
    <div className="app-shell">
      <Sidebar
        onViewChange={setView}
        view={view}
      />

      <header className="app-topbar">
        <h1>{viewTitle}</h1>
        <div className="topbar-actions">
          <div className="update-group">
            <small>{topbarState.status}</small>
            <button type="button" disabled={topbarState.disabled} onClick={topbarState.action}>
              {topbarState.label}
            </button>
          </div>
          <div className="theme-toggle-container">
            <button
              type="button"
              className="theme-toggle-btn"
              aria-label={theme === "light" ? "ダークモードに切り替え" : "ライトモードに切り替え"}
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
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
        </div>
      </header>

      <main className={view === "dashboard" ? "dashboard-layout" : "page-layout"}>
        {view === "dashboard" ? (
          <Dashboard
            cleData={cleData}
            cleLoading={cleLoading}
            cleStatus={cleStatus}
            data={data}
            onOpenNotice={markNoticeRead}
          />
        ) : view === "courses" ? (
          <CoursesPage
            cleData={cleData}
            data={data}
            onOpenNotice={markNoticeRead}
          />
        ) : view === "reference" ? (
          <ReferenceDesk
            genre={genre}
            allNotices={data.notices}
            notices={notices}
            onGenreChange={setGenre}
            onOpen={markNoticeRead}
            onQueryChange={setQuery}
            onScopeChange={setScope}
            query={query}
            scope={scope}
            snapshotUpdatedAt={data.snapshotUpdatedAt}
          />
        ) : view === "grades" ? (
          <Grades data={gradesData} />
        ) : <Settings />}
      </main>
    </div>
  );
}

function Sidebar({
  onViewChange,
  view,
}: {
  onViewChange: (view: "dashboard" | "courses" | "reference" | "grades" | "settings") => void;
  view: "dashboard" | "courses" | "reference" | "grades" | "settings";
}) {
  const items = [
    ["dashboard", "ホーム"],
    ["courses", "授業"],
    ["reference", "掲示"],
    ["grades", "成績"],
    ["settings", "設定"],
  ] as const;
  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">
        <span>KOAN</span>
        <b>Plus</b>
      </div>
      <nav className="side-nav" aria-label="画面切替">
        {items.map(([key, label]) => (
          <button className={view === key ? "active" : ""} key={key} onClick={() => onViewChange(key)} type="button">
            {label}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <small>外部リンク</small>
        <a href={PORTAL_URL} target="_blank">KOAN</a>
        <a href={CLE_MESSAGES_URL} target="_blank">CLE</a>
      </div>
    </aside>
  );
}

const EMPTY_AUTH_SETTINGS: AuthSettings = {
  configured: false,
  enabled: false,
  autoSubmit: true,
  mfaEnabled: false,
  idHint: "",
};

function Settings() {
  const [settings, setSettings] = useState(EMPTY_AUTH_SETTINGS);
  const [persistedSettings, setPersistedSettings] = useState(EMPTY_AUTH_SETTINGS);
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [mfaConsent, setMfaConsent] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingCredentials, setEditingCredentials] = useState(false);
  const [setupStarted, setSetupStarted] = useState(false);
  const [setupStep, setSetupStep] = useState<1 | 2 | 3>(1);
  const [showDetails, setShowDetails] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [savedSecrets, setSavedSecrets] = useState<{
    totpSecret: string;
    temporaryCancelCode: string;
  } | null>(null);
  const [showCancelCode, setShowCancelCode] = useState(false);
  const [showMfaSecret, setShowMfaSecret] = useState(false);
  const [showMfaWizardModal, setShowMfaWizardModal] = useState(false);
  const [mfaWizardStep, setMfaWizardStep] = useState<"consent" | "registering" | "qr">("consent");
  const [mfaConsentChecked1, setMfaConsentChecked1] = useState(false);
  const [mfaConsentChecked2, setMfaConsentChecked2] = useState(false);

  const reloadSettings = async () => {
    try {
      const next = await loadAuthSettings();
      setSettings(next);
      setPersistedSettings(next);
      setMfaEnabled(next.mfaEnabled);
      setMfaConsent(next.mfaEnabled);
      if (next.configured) setSetupStarted(false);
      if (next.configured) {
        const secrets = await getSavedMfaSecrets();
        if (secrets.configured && secrets.totpSecret) {
          setSavedSecrets({
            totpSecret: secrets.totpSecret,
            temporaryCancelCode: secrets.temporaryCancelCode || "",
          });
          return;
        }
      }
      setSavedSecrets(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    void reloadSettings();

    const handleFocus = () => {
      void reloadSettings();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  const hasSavedMfa = Boolean(savedSecrets?.totpSecret);
  const maskedTotpSecret = savedSecrets?.totpSecret
    ? `${savedSecrets.totpSecret.slice(0, 4)}${"*".repeat(Math.max(6, savedSecrets.totpSecret.length - 8))}${savedSecrets.totpSecret.slice(-4)}`
    : "";
  const maskedCancelCode = savedSecrets?.temporaryCancelCode
    ? `${savedSecrets.temporaryCancelCode.slice(0, 2)}${"*".repeat(Math.max(4, savedSecrets.temporaryCancelCode.length - 4))}${savedSecrets.temporaryCancelCode.slice(-2)}`
    : "";
  const setupCanGoNext = Boolean(id.trim() && password);
  const canSaveCredentials = !saving && Boolean(id.trim() && password);
  const canFinishSetup = !saving && Boolean(id.trim() && password) && (!mfaEnabled || (mfaConsent && Boolean(hasSavedMfa || totpSecret.trim())));
  const canSaveManualTotp = !saving && settings.mfaEnabled && Boolean(totpSecret.trim());

  const startAutoCollect = () => {
    const chromeObj = typeof window !== "undefined" ? (window as any).chrome : undefined;
    if (chromeObj && chromeObj.tabs?.create) {
      setSaving(true);
      
      chromeObj.tabs.create({
        url: "about:blank",
        active: false // 非アクティブ（バックグラウンド）で開く
      }, (tab: any) => {
        if (!tab || !tab.id) {
          setSaving(false);
          setStatus("バックグラウンドタブの作成に失敗しました。");
          setShowMfaWizardModal(false);
          return;
        }

        // バックグラウンドに自動取得対象タブとして登録
        chromeObj.runtime.sendMessage({
          type: "auth-mfa-register-auto-tab",
          tabId: tab.id
        }, (response: any) => {
          if (!response?.ok) {
            setSaving(false);
            setStatus(response?.error || "自動取得タブの登録に失敗しました。");
            setShowMfaWizardModal(false);
            return;
          }
          chromeObj.tabs.update(tab.id, {
            url: "https://auth-mfa.auth.osaka-u.ac.jp/AttributeRegistSite/MfaInfoServlet#auto-collect"
          });
        });

        // 12秒のセーフティタイマー（ログイン要求やエラー等で進まない場合に前面に出す）
        const timeoutId = setTimeout(() => {
          if (chromeObj.tabs?.update) {
            chromeObj.tabs.update(tab.id, { active: true });
            setStatus("自動ログインが完了しなかったため、タブを前面に表示しました。ログインを完了させてください。");
          }
        }, 12000);

        // タブが閉じられたことを検知してリロード
        const listener = (tabId: number) => {
          if (tabId === tab.id) {
            chromeObj.tabs.onRemoved.removeListener(listener);
            clearTimeout(timeoutId);
            
            void reloadSettings().then(() => {
              setSaving(false);
              setStatus("二段階認証の登録を保存しました。今後はこの端末で6桁コードを生成できます。");
              setMfaWizardStep("qr");
            }).catch((e) => {
              setSaving(false);
              setStatus(`自動取得後の読み込みに失敗しました: ${e.message}`);
              setShowMfaWizardModal(false);
            });
          }
        };
        chromeObj.tabs.onRemoved.addListener(listener);
      });
    } else {
      setStatus("自動取得は拡張機能のポップアップまたはオプション画面から実行してください。");
      setShowMfaWizardModal(false);
    }
  };

  const handleStartRegister = () => {
    setMfaWizardStep("registering");
    startAutoCollect();
  };

  const qrCanvasRef = (node: HTMLCanvasElement | null) => {
    if (node && savedSecrets?.totpSecret) {
      const uri = `otpauth://totp/osaka-u?secret=${savedSecrets.totpSecret}&issuer=osaka-u`;
      QRCode.toCanvas(node, uri, { width: 200, margin: 2 }, (error) => {
        if (error) console.error("Failed to generate QR code:", error);
      });
    }
  };


  const run = async (task: () => Promise<AuthSettings>, success: string) => {
    setSaving(true);
    try {
      const next = await task();
      setSettings(next);
      setPersistedSettings(next);
      setId("");
      setPassword("");
      setTotpSecret("");
      setMfaEnabled(next.mfaEnabled);
      setMfaConsent(next.mfaEnabled);
      setEditingCredentials(false);
      setSetupStarted(false);
      if (next.configured) {
        const secrets = await getSavedMfaSecrets();
        setSavedSecrets(secrets.configured && secrets.totpSecret ? {
          totpSecret: secrets.totpSecret,
          temporaryCancelCode: secrets.temporaryCancelCode || "",
        } : null);
      } else {
        setSavedSecrets(null);
      }
      setStatus(success);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const save = () => run(
    () => saveAuthSettings({
      enabled: true,
      id,
      password,
      totpSecret,
      mfaConsent,
      mfaEnabled: mfaEnabled && Boolean(hasSavedMfa || totpSecret.trim()),
    }),
    "端末内に暗号化して保存しました。",
  );

  const toggleAutoLogin = (enabled: boolean) => {
    if (!settings.configured) {
      setSetupStarted(true);
      setSettings({ ...settings, enabled: true });
      setStatus("ログイン情報を保存してから自動ログインを有効にできます。");
      return;
    }
    setSettings({ ...settings, enabled });
    void run(
      () => saveAuthSettings({
        enabled,
        id: "",
        password: "",
        totpSecret: "",
        mfaConsent: settings.mfaEnabled,
        mfaEnabled: settings.mfaEnabled,
      }),
      enabled ? "自動ログインを有効にしました。" : "自動ログインを停止しました。",
    );
  };

  const toggleMfa = (enabled: boolean) => {
    setSettings({ ...settings, mfaEnabled: enabled });
    setMfaEnabled(enabled);
    setMfaConsent(enabled);
    if (!enabled) {
      setTotpSecret("");
      void run(
        () => saveAuthSettings({
          enabled: settings.enabled,
          id: "",
          password: "",
          totpSecret: "",
          mfaConsent: settings.mfaEnabled,
          mfaEnabled: false,
        }),
        "二段階認証を停止しました。",
      );
    } else {
      setStatus(hasSavedMfa ? "二段階認証を使用できます。" : "二段階認証情報を登録してください。");
    }
  };

  const saveManualTotp = () => run(
    () => saveAuthSettings({
      enabled: settings.enabled,
      id: "",
      password: "",
      totpSecret,
      mfaConsent: true,
      mfaEnabled: true,
    }),
    "TOTP シークレットを保存しました。",
  );

  const cancelCredentialEdit = () => {
    setEditingCredentials(false);
    setId("");
    setPassword("");
    setStatus("");
  };

  const copyValue = (value: string, message: string) => {
    void navigator.clipboard.writeText(value);
    setStatus(message);
    window.setTimeout(() => setStatus(""), 3000);
  };

  const confirmDelete = () => {
    setShowDeleteModal(true);
  };

  const removeSavedCredentials = () => {
    setShowDeleteModal(false);
    void run(async () => {
      const next = await deleteAuthSettings();
      setId("");
      setPassword("");
      setTotpSecret("");
      setMfaConsent(false);
      setMfaEnabled(false);
      setEditingCredentials(false);
      setSetupStarted(false);
      setSetupStep(1);
      return next;
    }, "保存済みの認証情報を削除しました。");
  };

  return (
    <div className="settings-page">
      <div className="settings-container">
        {/* 左カラム：操作系 */}
        <div className="settings-main">
          {!settings.configured ? (
            <section className="section settings-card setup-card">
              {!setupStarted ? (
                <>
                  <div className="section-heading">
                    <div>
                      <h2>自動ログインを設定する</h2>
                      <p>まだ自動ログインは設定されていません。利用するには、この端末にログイン情報を保存してください。</p>
                    </div>
                  </div>
                  <button className="primary-action" onClick={() => setSetupStarted(true)} type="button">
                    自動ログインを設定する
                  </button>
                </>
              ) : (
                <>
                  <div className="wizard-steps" aria-label="初回設定の進行状況">
                    {["ログイン情報", "二段階認証", "確認"].map((label, index) => (
                      <span className={setupStep === index + 1 ? "active" : ""} key={label}>
                        {index + 1}. {label}
                      </span>
                    ))}
                  </div>

                  {setupStep === 1 && (
                    <div className="settings-form-block">
                      <div className="section-heading compact">
                        <div>
                          <h2>ログイン情報</h2>
                          <p>大阪大学個人IDとパスワードを、この端末内に保存します。</p>
                        </div>
                      </div>
                      <div className="settings-grid">
                        <label>
                          <span>大阪大学個人ID</span>
                          <input autoComplete="username" onChange={(event) => setId(event.target.value)} value={id} />
                        </label>
                        <label>
                          <span>パスワード</span>
                          <input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
                        </label>
                      </div>
                      <div className="settings-actions">
                        <button className="primary-action" disabled={!setupCanGoNext} onClick={() => setSetupStep(2)} type="button">
                          次へ
                        </button>
                        <button className="secondary-action" onClick={() => setSetupStarted(false)} type="button">
                          キャンセル
                        </button>
                      </div>
                    </div>
                  )}

                  {setupStep === 2 && (
                    <div className="settings-form-block">
                      <div className="section-heading compact">
                        <div>
                          <h2>二段階認証</h2>
                          <p>この端末で6桁の認証コードを生成する場合だけ登録します。</p>
                        </div>
                      </div>
                      <label className="mfa-consent">
                        <input checked={mfaEnabled} onChange={(event) => {
                          setMfaEnabled(event.target.checked);
                          setMfaConsent(event.target.checked);
                          if (!event.target.checked) setTotpSecret("");
                        }} type="checkbox" />
                        <span>端末内保存とMFA自動化のリスクを理解し、この端末で利用することに同意します。</span>
                      </label>
                      {mfaEnabled && (
                        <div className="manual-totp-panel setup-manual-totp">
                          <label>
                            <span>TOTP シークレットを手動入力</span>
                            <input
                              autoComplete="one-time-code"
                              onChange={(event) => setTotpSecret(event.target.value)}
                              placeholder="例: JBSWY3DPEHPK3PXP"
                              value={totpSecret}
                            />
                          </label>
                        </div>
                      )}
                      <div className="settings-actions">
                        <button className="secondary-action" disabled={!mfaConsent || saving} onClick={() => {
                          setMfaConsentChecked1(false);
                          setMfaConsentChecked2(false);
                          setMfaWizardStep("consent");
                          setShowMfaWizardModal(true);
                        }} type="button">
                          二段階認証を自動登録する
                        </button>
                        <button className="primary-action" onClick={() => setSetupStep(3)} type="button">
                          {hasSavedMfa ? "確認へ" : "スキップして確認へ"}
                        </button>
                        <button className="secondary-action" onClick={() => setSetupStep(1)} type="button">
                          戻る
                        </button>
                      </div>
                    </div>
                  )}

                  {setupStep === 3 && (
                    <div className="settings-form-block">
                      <div className="section-heading compact">
                        <div>
                          <h2>確認</h2>
                          <p>保存すると、自動ログインが有効になります。</p>
                        </div>
                      </div>
                      <dl className="settings-state-list">
                        <div>
                          <dt>大阪大学個人ID</dt>
                          <dd>{id ? `${id.slice(0, 2)}${"*".repeat(Math.max(2, id.length - 4))}${id.slice(-2)}` : "未入力"}</dd>
                        </div>
                        <div>
                          <dt>パスワード</dt>
                          <dd>{password ? "保存予定" : "未入力"}</dd>
                        </div>
                        <div>
                          <dt>二段階認証</dt>
                          <dd>{hasSavedMfa ? "登録済み" : "未登録"}</dd>
                        </div>
                      </dl>
                      <div className="settings-actions">
                        <button className="primary-action" disabled={!canFinishSetup} onClick={save} type="button">
                          {saving ? "保存中..." : "保存して有効化"}
                        </button>
                        <button className="secondary-action" onClick={() => setSetupStep(2)} type="button">
                          戻る
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>
          ) : (
            <>
              {/* 自動ログインセクション */}
              <section className="section settings-card">
                <label className="section-heading toggle-heading">
                  <div>
                    <h2>自動ログインを使用する</h2>
                    <p>阪大認証画面で保存済みのID・パスワードを入力します。</p>
                  </div>
                  <div className="switch">
                    <input
                      checked={settings.enabled}
                      disabled={saving}
                      onChange={(event) => toggleAutoLogin(event.target.checked)}
                      type="checkbox"
                    />
                    <span className="slider"></span>
                  </div>
                </label>

                {settings.enabled && <div className="settings-toggle-details">
                  <hr className="settings-divider" />
                  {!editingCredentials ? (
                    <div className="saved-id-row">
                      <dl className="settings-state-list compact">
                        <div>
                          <dt>保存済みID</dt>
                          <dd>{settings.idHint || "保存済み"}</dd>
                        </div>
                      </dl>
                      <button className="secondary-action" onClick={() => setEditingCredentials(true)} type="button">
                        ログイン情報を変更
                      </button>
                    </div>
                  ) : (
                    <div className="settings-form-block">
                      <div className="settings-grid">
                        <label>
                          <span>大阪大学個人ID</span>
                          <input
                            autoComplete="username"
                            onChange={(event) => setId(event.target.value)}
                            placeholder={settings.configured ? `保存済み: ${settings.idHint}` : ""}
                            value={id}
                          />
                        </label>
                        <label>
                          <span>パスワード</span>
                          <input
                            autoComplete="current-password"
                            onChange={(event) => setPassword(event.target.value)}
                            placeholder={settings.configured ? "保存済み（変更時のみ入力）" : ""}
                            type="password"
                            value={password}
                          />
                        </label>
                      </div>
                      <div className="settings-actions-row">
                        <div className="settings-actions">
                          <button className="primary-action" disabled={!canSaveCredentials} onClick={save} type="button">
                            {saving ? "保存中..." : "保存"}
                          </button>
                          <button className="secondary-action" onClick={cancelCredentialEdit} type="button">
                            キャンセル
                          </button>
                        </div>
                        <button className="danger-text-action" disabled={saving} onClick={confirmDelete} type="button">
                          認証情報を削除
                        </button>
                      </div>
                    </div>
                  )}
                </div>}
              </section>

              {/* 二段階認証セクション */}
              <section className="section settings-card">
                <label className="section-heading toggle-heading">
                  <div>
                    <h2>二段階認証を使用する</h2>
                    <p>ログイン時に必要な6桁コードをこの端末で生成します。</p>
                  </div>
                  <div className="switch">
                    <input
                      checked={settings.mfaEnabled}
                      disabled={saving}
                      onChange={(event) => toggleMfa(event.target.checked)}
                      type="checkbox"
                    />
                    <span className="slider"></span>
                  </div>
                </label>

                {settings.mfaEnabled && <div className="settings-toggle-details">
                  <hr className="settings-divider" />
                  
                  {hasSavedMfa ? (
                    <div className="mfa-status-info">
                      <span className="mfa-badge ready">登録済み</span>
                      <p className="mfa-status-desc">この端末で自動的に二段階認証コードを生成して入力します。</p>
                    </div>
                  ) : (
                    <div className="mfa-status-info unconfigured">
                      <span className="mfa-badge disabled">未登録</span>
                      <p className="mfa-status-desc">自動ログインで二段階認証を通過させるには、MFA情報の登録が必要です。</p>
                    </div>
                  )}

                  <div className="settings-actions">
                    <button className={hasSavedMfa ? "subtle-action" : "primary-action"} disabled={saving || !settings.mfaEnabled} onClick={() => {
                      setMfaConsentChecked1(false);
                      setMfaConsentChecked2(false);
                      setMfaWizardStep("consent");
                      setShowMfaWizardModal(true);
                    }} type="button">
                      {hasSavedMfa ? "再設定" : "二段階認証を自動登録する"}
                    </button>
                  </div>

                  <details className="settings-details-accordion">
                    <summary>高度なオプション（手動入力）</summary>
                    <div className="manual-totp-panel">
                      <label>
                        <span>TOTP シークレットを手動入力</span>
                        <input
                          autoComplete="one-time-code"
                          onChange={(event) => setTotpSecret(event.target.value)}
                          placeholder={hasSavedMfa ? "登録済み（変更時のみ入力）" : "例: JBSWY3DPEHPK3PXP"}
                          value={totpSecret}
                        />
                      </label>
                      <button className="secondary-action" disabled={!canSaveManualTotp} onClick={saveManualTotp} type="button">
                        手動入力で保存
                      </button>
                    </div>
                  </details>
                </div>}
              </section>
            </>
          )}
        </div>

        {/* 右カラム：ステータス・安全性について */}
        <div className="settings-sidebar">
          <section className="section settings-card summary-card">
            <div className="section-heading">
              <div>
                <h2>自動ログインのステータス</h2>
                <p>現在の設定状況と暗号化保存の状態です。</p>
              </div>
            </div>
            <ul className="settings-status-list">
              <li>
                <span className="status-label">自動ログイン機能</span>
                <span className={`status-value ${settings.enabled ? "ready" : "disabled"}`}>
                  {settings.configured ? settings.enabled ? "有効" : "無効" : "未設定"}
                </span>
              </li>
              <li>
                <span className="status-label">ログインID・パスワード</span>
                <span className={`status-value ${settings.configured ? "ready" : "disabled"}`}>
                  {settings.configured ? "保存済み" : "未保存"}
                </span>
              </li>
              <li>
                <span className="status-label">二段階認証（MFA）情報</span>
                <span className={`status-value ${hasSavedMfa ? "ready" : "disabled"}`}>
                  {hasSavedMfa ? "登録済み" : settings.configured ? "未登録" : "未設定"}
                </span>
              </li>
            </ul>
          </section>

          {hasSavedMfa && (
            <section className="section settings-card mfa-sidebar-card">
              <div className="section-heading">
                <div>
                  <h2>二段階認証（MFA）の管理</h2>
                  <p>登録済みの認証情報の確認や操作が行えます。</p>
                </div>
              </div>
              <div className="card-body">
                <div className="mfa-sidebar-actions">
                  <button className="secondary-action" onClick={() => {
                    setMfaWizardStep("qr");
                    setShowMfaWizardModal(true);
                  }} type="button">
                    登録用QRコードを表示
                  </button>
                </div>
                {savedSecrets?.temporaryCancelCode && (
                  <div className="sidebar-cancel-code-box">
                    <span className="sidebar-code-label">一時解除コード</span>
                    <div className="sidebar-code-row">
                      <code>{showCancelCode ? savedSecrets.temporaryCancelCode : maskedCancelCode}</code>
                      <div className="sidebar-code-actions">
                        <button className="subtle-action" onClick={() => setShowCancelCode(!showCancelCode)} type="button">
                          {showCancelCode ? "隠す" : "表示"}
                        </button>
                        <button className="subtle-action" onClick={() => copyValue(savedSecrets.temporaryCancelCode, "一時解除コードをコピーしました。")} type="button">
                          コピー
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          <section className="section settings-card how-it-works-card">
            <div className="section-heading">
              <div>
                <h2>安全性について</h2>
              </div>
            </div>
            <div className="card-body">
              <p>認証情報はこの端末内だけに保存され、外部サーバーには送信されません。</p>
              <p>この機能は、自分だけが使う端末での利用を想定しています。</p>
              <button type="button" className="btn-details-toggle" onClick={() => setShowDetails(true)}>
                詳しく見る
              </button>
            </div>
          </section>
        </div>
      </div>

      {/* Security Details Modal */}
      {showDetails && (
        <div className="settings-modal-overlay">
          <div className="settings-modal details-modal" role="dialog" aria-modal="true">
            <h3 className="modal-title">自動ログインの安全性</h3>
            <p className="modal-text">保存と利用の範囲は、この端末内の自動ログイン補助に限定されます。</p>
            <div className="details-groups">
              <div>
                <h4>保存される情報</h4>
                <ul>
                  <li>大阪大学個人ID</li>
                  <li>パスワード</li>
                  <li>二段階認証情報</li>
                </ul>
              </div>
              <div>
                <h4>使われる場面</h4>
                <ul>
                  <li>阪大ログイン画面での入力補助</li>
                  <li>6桁認証コードの生成</li>
                </ul>
              </div>
            </div>
            <p className="modal-text">KOAN Plus 独自の外部サーバーへ認証情報を送信することはありません。共有端末では使わず、端末を手放す前には自動ログイン欄から認証情報を削除してください。</p>
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowDetails(false)} type="button">
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="settings-modal-overlay">
          <div className="settings-modal" role="dialog" aria-modal="true">
            <h3 className="modal-title">認証情報を削除しますか</h3>
            <p className="modal-text">次の情報をこの端末から削除します。この操作は取り消せません。</p>
            <ul className="modal-delete-list">
              <li>大阪大学個人ID</li>
              <li>パスワード</li>
              <li>二段階認証情報</li>
            </ul>
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowDeleteModal(false)} type="button">
                キャンセル
              </button>
              <button className="modal-btn confirm" onClick={removeSavedCredentials} type="button">
                削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MFA Wizard Modal */}
      {showMfaWizardModal && (
        <div className="settings-modal-overlay">
          <div className="settings-modal mfa-wizard-modal" role="dialog" aria-modal="true">
            <div className="mfa-wizard-viewport">
              <div className={`mfa-wizard-track step-${mfaWizardStep}`}>
                
                {/* Step 1: Consent */}
                <div className="mfa-wizard-slide">
                  <h3 className="modal-title">二段階認証の自動登録に関する重要なお願い</h3>
                  <div className="modal-text consent-content">
                    <p>自動ログインで二段階認証を通過させるため、本拡張機能にMFA情報を登録します。登録の前に、以下の重要な注意点をご確認いただき、同意をお願いします。</p>
                    
                    <div className="consent-alert-box">
                      <h4>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide-icon warning">
                          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                          <line x1="12" y1="9" x2="12" y2="13"/>
                          <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        スマートフォン等への再登録が必要です
                      </h4>
                      <p>大阪大学のMFA仕様上、本拡張機能で新しく登録を行うと、<strong>これまでスマートフォン等の認証アプリ（Google Authenticator等）で生成していたコードは使用できなくなります（上書きされます）。</strong></p>
                      <p>自動登録完了後に表示されるQRコードを、お使い of スマートフォン等で再度スキャンし、モバイルデバイスへの再登録を必ず行ってください。</p>
                    </div>

                    <div className="consent-alert-box">
                      <h4>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide-icon security">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                        セキュリティのリスクについて
                      </h4>
                      <p>認証コード生成キーをこの端末内に保存するため、端末の紛失や盗難時に不正アクセスのリスクが生じます。利便性とセキュリティのリスクのトレードオフを理解したうえでご利用ください。</p>
                    </div>
                  </div>

                  <div className="consent-checkboxes">
                    <label className="consent-checkbox-label">
                      <input
                        type="checkbox"
                        checked={mfaConsentChecked1}
                        onChange={(e) => setMfaConsentChecked1(e.target.checked)}
                      />
                      <span>他端末（スマホ等）への再登録が必要になる仕様を理解しました。</span>
                    </label>
                    <label className="consent-checkbox-label">
                      <input
                        type="checkbox"
                        checked={mfaConsentChecked2}
                        onChange={(e) => setMfaConsentChecked2(e.target.checked)}
                      />
                      <span>端末内保存に伴うセキュリティのリスクと利便性のトレードオフに同意します。</span>
                    </label>
                  </div>

                  <div className="modal-actions">
                    <button className="modal-btn cancel" onClick={() => setShowMfaWizardModal(false)} type="button">
                      キャンセル
                    </button>
                    <button
                      className="modal-btn confirm"
                      disabled={!mfaConsentChecked1 || !mfaConsentChecked2}
                      onClick={handleStartRegister}
                      type="button"
                    >
                      登録を開始
                    </button>
                  </div>
                </div>

                {/* Step 2: Registering (Loading) */}
                <div className="mfa-wizard-slide">
                  <div className="mfa-wizard-loading-content">
                    <div className="spinner-wrapper">
                      <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide-icon spinner">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                      </svg>
                    </div>
                    <h3 className="modal-title loading-title">二段階認証情報を自動登録中</h3>
                    <p className="modal-text loading-text">
                      ブラウザのバックグラウンドタブで設定を実行しています。<br />
                      MFA登録情報の取得を完了するまで、このまま数秒お待ちください。
                    </p>
                  </div>
                </div>

                {/* Step 3: QR Code & Secrets */}
                <div className="mfa-wizard-slide step-qr-slide">
                  <h3 className="modal-title">認証アプリ登録用QRコード</h3>
                  <div className="mfa-qr-layout-container">
                    <div className="mfa-qr-left-col">
                      <div className="qr-box">
                        <canvas ref={qrCanvasRef} />
                      </div>
                    </div>
                    <div className="mfa-qr-right-col">
                      <p className="modal-text qr-instruction-text">
                        Google Authenticator等の<strong>認証アプリ内のスキャンカメラ</strong>でスキャンしてください。（スマートフォンの標準カメラアプリでは登録できません）
                      </p>
                      
                      <div className="mfa-secret-panel modal-secret-panel">
                        <div className="secret-row">
                          <span className="secret-label">登録キー</span>
                          <code className="secret-code">{showMfaSecret ? savedSecrets?.totpSecret : maskedTotpSecret}</code>
                          <div className="secret-actions">
                            <button className="subtle-action" onClick={() => setShowMfaSecret(!showMfaSecret)} type="button">
                              {showMfaSecret ? "隠す" : "表示"}
                            </button>
                            <button className="subtle-action" disabled={!savedSecrets?.totpSecret} onClick={() => savedSecrets?.totpSecret && copyValue(savedSecrets.totpSecret, "登録キーをコピーしました。")} type="button">
                              コピー
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="modal-actions qr-actions">
                    <button
                      className="modal-btn cancel"
                      onClick={() => setShowMfaWizardModal(false)}
                      type="button"
                    >
                      閉じる
                    </button>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}
    </div>

  );
}

function fmtDue(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function dueLabel(value: string) {
  const milliseconds = new Date(value).getTime() - Date.now();
  const hours = Math.ceil(milliseconds / (60 * 60 * 1000));
  if (hours < 0) return "期限超過";
  if (hours <= 24) return hours <= 1 ? "まもなく" : `あと${hours}時間`;
  return `あと${Math.ceil(hours / 24)}日`;
}

function taskLabel(task: CleTask) {
  if (["提出済み", "採点済み", "期限切れ"].includes(task.status)) {
    return task.status;
  }
  return dueLabel(task.dueAt);
}

function taskTone(task: CleTask) {
  if (["提出済み", "採点済み"].includes(task.status)) return "done";
  if (task.status === "期限切れ" || dueLabel(task.dueAt) === "期限超過") return "attention";
  return "neutral";
}

function courseDisplayName(value: string) {
  const withoutCode = value.replace(/^[^:]+:\s*\d+\s*/, "");
  const japanese = withoutCode.split(/\s*\/\s*/)[0];
  return japanese
    .replace(/\s*【[^】]*】/g, "")
    .replace(/\s+[月火水木金土日]\d+\s*$/, "")
    .trim() || value;
}

function normalizeCourseTitle(value: string) {
  return courseDisplayName(value)
    .replace(/^【取消】/, "")
    .replace(/\s*【[^】]*】/g, "")
    .replace(/[ 　]+/g, "")
    .toLowerCase();
}

function timetableCodeFromCleDisplay(value: string) {
  return value.match(/^\d{4}-\d{2}-(\d{6})-/)?.[1] || "";
}

type CourseSummary = {
  code: string;
  koan: CourseRegistration;
  cleCourse?: CleCourse;
  tasks: CleTask[];
  messages: CleData["messages"];
  notices: Notice[];
  changes: ChangeItem[];
  schedules: ScheduleItem[];
};

function courseMatchesText(course: CourseRegistration, value: string) {
  const courseTitle = normalizeCourseTitle(course.title);
  const text = normalizeCourseTitle(value);
  return Boolean(courseTitle && text && (text.includes(courseTitle) || courseTitle.includes(text)));
}

function buildCourseSummaries(data: KoanData, cleData: CleData): CourseSummary[] {
  const cleByCode = new Map<string, CleCourse>();
  const cleCodeByCourseId = new Map<string, string>();
  for (const course of cleData.courses || []) {
    const code = course.timetableCode || timetableCodeFromCleDisplay(course.displayId);
    if (!code) continue;
    cleByCode.set(code, course);
    cleCodeByCourseId.set(course.courseId, code);
  }
  return (data.courses || []).filter((course) => !/【取消】|取消/.test(course.title)).map((course) => {
    const cleCourse = cleByCode.get(course.code);
    const tasks = cleData.tasks.filter((task) => {
      const code = cleCodeByCourseId.get(task.courseId) || timetableCodeFromCleDisplay(task.courseName);
      return code ? code === course.code : courseMatchesText(course, task.courseName);
    });
    const messages = cleData.messages.filter((message) => {
      const code = cleCodeByCourseId.get(message.courseId) || timetableCodeFromCleDisplay(message.courseName);
      return code ? code === course.code : courseMatchesText(course, message.courseName);
    });
    const schedules = data.schedule.filter((item) => courseMatchesText(course, item.title));
    const changes = data.changes.filter((item) => courseMatchesText(course, item.course));
    const notices = data.notices
      .filter((notice) => courseMatchesText(course, notice.title))
      .sort((left, right) => attentionScore(right) - attentionScore(left))
      .slice(0, 5);
    return {
      code: course.code,
      koan: course,
      cleCourse,
      tasks: tasks.sort((left, right) => left.dueAt.localeCompare(right.dueAt)),
      messages,
      notices,
      changes,
      schedules,
    };
  });
}

const timetableDays = ["月", "火", "水", "木", "金", "土"] as const;
const timetablePeriods = ["1", "2", "3", "4", "5", "6"];

function courseSlots(course: CourseRegistration) {
  const slotPattern = /([月火水木金土日])\s*(\d+)/g;
  const slots = [...course.period.matchAll(slotPattern)]
    .map((match) => ({ day: match[1], period: match[2] }));
  if (slots.length) return slots;
  const period = periodNumber(course.period);
  return course.day && period ? [{ day: course.day, period }] : [];
}

function courseSlotLabel(course: CourseRegistration) {
  const slots = courseSlots(course);
  if (slots.length) return slots.map((slot) => `${slot.day}${slot.period}`).join(",");
  return [course.day, course.period].filter(Boolean).join(" ");
}

function courseTeacherRoom(value: string) {
  const normalized = value.replace(/\s*\/\s*/g, " / ").replace(/\s+/g, " ").trim();
  if (!normalized) return { teacher: "未取得", room: "未取得" };
  const slashParts = normalized.split(" / ").map((part) => part.trim()).filter(Boolean);
  if (slashParts.length >= 2) {
    return { teacher: slashParts[0], room: slashParts.slice(1).join(" / ") };
  }
  const roomKeyword = /(法経|講義室|教室|研究室|演習室|セミナー室|レバレジーズ|オンライン|未定|豊中|吹田|箕面)/;
  const keywordIndex = normalized.search(roomKeyword);
  if (keywordIndex > 0) {
    return {
      teacher: normalized.slice(0, keywordIndex).trim(),
      room: normalized.slice(keywordIndex).trim(),
    };
  }
  return { teacher: normalized, room: "未取得" };
}

function courseTermHeading(courses: CourseSummary[]) {
  const year = courses.find((course) => course.koan.year)?.koan.year || String(new Date().getFullYear());
  const month = new Date().getMonth() + 1;
  const term = month >= 10 || month <= 3 ? "秋学期" : "春学期";
  return `${year}年 ${term}`;
}

function CoursesPage({
  cleData,
  data,
  onOpenNotice,
}: {
  cleData: CleData;
  data: KoanData;
  onOpenNotice: (notice: Notice) => void;
}) {
  const courses = useMemo(() => buildCourseSummaries(data, cleData), [cleData, data]);
  const [selectedCode, setSelectedCode] = useState("");
  useEffect(() => {
    if (!courses.some((course) => course.code === selectedCode)) {
      setSelectedCode("");
    }
  }, [courses, selectedCode]);
  const selected = courses.find((course) => course.code === selectedCode);
  const regularCourses = courses.filter((course) => courseSlots(course.koan).some((slot) =>
    timetableDays.includes(slot.day as typeof timetableDays[number]) &&
    timetablePeriods.includes(slot.period),
  ));
  const irregularCourses = courses.filter((course) => !regularCourses.includes(course));
  return (
    <div className="courses-page">
      <div className="course-timetable-pane">
        {courses.length ? (
          <>
            <div className="course-timetable-heading">
              <h2>{courseTermHeading(courses)}</h2>
            </div>
            <CourseTimetable
              courses={regularCourses}
              onSelect={setSelectedCode}
              selectedCode={selectedCode}
            />
            <div className="irregular-courses">
              <h3>集中講義・曜日未定</h3>
              {irregularCourses.length ? (
                <div>
                  {irregularCourses.map((course) => (
                    <button
                      className={course.code === selectedCode ? "active" : ""}
                      key={course.code}
                      onClick={() => setSelectedCode(course.code)}
                      type="button"
                    >
                      <span>{course.koan.title}</span>
                      <small>{courseSlotLabel(course.koan) || "曜日時限未定"}</small>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="irregular-empty">該当する授業はありません。</p>
              )}
            </div>
          </>
        ) : <p className="empty">授業情報はまだ取得されていません。右上の更新でKOANとCLEを読み込めます。</p>}
      </div>

      <div className="course-detail-pane">
        {selected ? (
          <CourseDetail course={selected} onOpenNotice={onOpenNotice} />
        ) : (
          <CourseDefaultDetail />
        )}
      </div>
    </div>
  );
}

function CourseTimetable({
  courses,
  onSelect,
  selectedCode,
}: {
  courses: CourseSummary[];
  onSelect: (code: string) => void;
  selectedCode: string;
}) {
  return (
    <div className="course-timetable" role="grid" aria-label="授業時間割">
      <div className="timetable-corner" aria-hidden="true"></div>
      {timetableDays.map((day) => <div className="timetable-day" key={day}>{day}</div>)}
      {timetablePeriods.map((period) => (
        <div className="timetable-row" key={period}>
          <div className="timetable-period">{period}</div>
          {timetableDays.map((day) => {
            const slotCourses = courses.filter((course) =>
              courseSlots(course.koan).some((slot) => slot.day === day && slot.period === period),
            );
            return (
              <div className="timetable-cell" key={`${day}-${period}`}>
                {slotCourses.map((course) => {
                  const activeTasks = course.tasks.filter((task) => !["提出済み", "採点済み"].includes(task.status));
                  return (
                    <button
                      className={course.code === selectedCode ? "timetable-course selected" : "timetable-course"}
                      key={course.code}
                      onClick={() => onSelect(course.code)}
                      title={`${course.koan.title}${activeTasks.length ? ` / 未完了課題 ${activeTasks.length}件` : ""}`}
                      type="button"
                    >
                      <b>{course.koan.title}</b>
                      {!!activeTasks.length && (
                        <span
                          aria-label={`未完了課題 ${activeTasks.length}件`}
                          className="timetable-task-indicator"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function CourseDefaultDetail() {
  return (
    <div className="course-default-detail" aria-label="授業未選択">
      <div className="course-empty-state">
        <div className="course-empty-icon" aria-hidden="true">
          <span />
        </div>
        <strong>授業を選択して詳細を表示</strong>
        <p>時間割のコマを選ぶと、課題・連絡・変更情報をここに表示します。</p>
      </div>
    </div>
  );
}

function CourseDetail({
  course,
  onOpenNotice,
}: {
  course: CourseSummary;
  onOpenNotice: (notice: Notice) => void;
}) {
  const teacherRoom = courseTeacherRoom(course.koan.teacherAndRoom);
  return (
    <div className="course-detail">
      <div className="course-detail-header">
        <div className="course-detail-title">
          <h2>{course.koan.title}</h2>
          <div className="course-detail-meta">
            <div><span>曜日時限</span><b>{courseSlotLabel(course.koan) || "未定"}</b></div>
            <div><span>教員</span><b>{teacherRoom.teacher}</b></div>
            <div><span>教室</span><b>{teacherRoom.room}</b></div>
          </div>
        </div>
      </div>

      <div className="course-detail-flow">
        <section className="course-detail-block course-tasks-block">
          <h3>課題</h3>
          <div className="course-line-list">
            {course.tasks.length ? course.tasks.map((task) => (
              <a className="course-line-row" href={cleTaskUrl(task)} key={task.id} target="_blank">
                <b className={`course-status-label ${taskTone(task)}`}>{taskLabel(task)}</b>
                <span>{task.title}<small>{fmtDue(task.dueAt)}まで / {task.status}</small></span>
              </a>
            )) : <p className="subtle-empty">表示する課題はありません。</p>}
          </div>
        </section>

        <section className="course-detail-block course-messages-block">
          <h3>連絡</h3>
          <div className="course-line-list">
            {course.messages.length ? course.messages.map((message) => (
              <a className="course-line-row" href={cleMessageUrl(message.courseId)} key={message.courseId} target="_blank">
                <b>{message.unreadCount ? "未読" : "連絡"}</b>
                <span>{message.courseName}<small>{message.unreadCount ? `${message.unreadCount}件の未読` : "既読"}</small></span>
              </a>
            )) : <p className="subtle-empty">表示する連絡はありません。</p>}
          </div>
        </section>

        <section className="course-detail-block course-updates-block">
          <h3>変更・掲示</h3>
          <div className="course-line-list">
            {course.changes.map((change, index) => (
              <div className="course-line-row" key={`${change.date}-${change.period}-${index}`}>
                <b>{change.type}</b>
                <span>{change.date} {change.period}</span>
              </div>
            ))}
            {course.notices.map((notice) => (
              <button
                className="course-line-row course-notice-row"
                key={noticeKey(notice)}
                onClick={() => onOpenNotice(notice)}
                type="button"
              >
                <b>掲示</b>
                <span>{notice.title}<small>{[notice.period, notice.genre].filter(Boolean).join(" / ") || notice.author}</small></span>
              </button>
            ))}
            {!course.changes.length && !course.notices.length && <p className="subtle-empty">表示する変更・掲示はありません。</p>}
          </div>
        </section>
      </div>

      <div className="course-link-actions">
        {course.koan.syllabusUrl ? (
          <a href={course.koan.syllabusUrl} target="_blank">シラバス</a>
        ) : (
          <span className="disabled">シラバス</span>
        )}
        {course.cleCourse ? (
          <a href={cleCourseUrl(course.cleCourse.courseId)} target="_blank">CLE</a>
        ) : (
          <span className="disabled">CLE</span>
        )}
      </div>
    </div>
  );
}

function Dashboard({
  cleData,
  cleLoading,
  cleStatus,
  data,
  onOpenNotice,
}: {
  cleData: CleData;
  cleLoading: boolean;
  cleStatus: string;
  data: KoanData;
  onOpenNotice: (notice: Notice) => void;
}) {
  const today = dateKey(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const selectedSchedule = data.schedule.filter((item) => (item.date || today) === selectedDate);
  const selectedChanges = changesForDate(data.changes, selectedDate, today);
  return (
    <>
      <section className="dashboard-main">
        <NextActions data={cleData} loading={cleLoading} status={cleStatus} />
        <NewActivity
          loading={cleLoading}
          messages={cleData.messages}
          notices={data.notices}
          onOpen={onOpenNotice}
        />
      </section>
      <DashboardRightRail
        changes={selectedChanges}
        onSelectDate={setSelectedDate}
        schedule={selectedSchedule}
        selectedDate={selectedDate}
        tasks={cleData.tasks}
      />
    </>
  );
}

function NextActions({
  data,
  loading,
  status,
}: {
  data: CleData;
  loading: boolean;
  status: string;
}) {
  const tasks = data.tasks.filter(
    (task) => !["提出済み", "採点済み"].includes(task.status),
  );
  const upcomingTasks = tasks
    .filter((task) => new Date(task.dueAt).getTime() >= Date.now())
    .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
  const expiredTasks = tasks
    .filter((task) => new Date(task.dueAt).getTime() < Date.now())
    .sort((left, right) => right.dueAt.localeCompare(left.dueAt));
  return (
    <section className="section next-actions">
      <div className="section-heading">
        <div>
          <h2>直近の課題</h2>
          <p>CLE取得 {fmtTime(data.updatedAt)}{status ? ` / ${status}` : ""}</p>
        </div>
        <a className="detail-link" href={CLE_CALENDAR_URL} target="_blank">CLEカレンダー</a>
      </div>
      <div className="task-list">
        {upcomingTasks.length ? upcomingTasks.map((task) => <CleTaskRow task={task} key={task.id} />) : (
          <p className="empty">{loading ? "取得中です。" : "期限の近い課題はありません。"}</p>
        )}
        {!!expiredTasks.length && (
          <details className="expired-tasks">
            <summary>期限切れ <b>{expiredTasks.length}</b></summary>
            {expiredTasks.map((task) => <CleTaskRow task={task} key={task.id} />)}
          </details>
        )}
      </div>
    </section>
  );
}

function CleTaskRow({ task }: { task: CleTask }) {
  const overdue = new Date(task.dueAt).getTime() < Date.now();
  return (
    <a className="cle-task-row" href={cleTaskUrl(task)} target="_blank">
      <time className={overdue ? "overdue" : ""}>{dueLabel(task.dueAt)}</time>
      <span>
        {task.title}
        <small>{courseDisplayName(task.courseName)} / {fmtDue(task.dueAt)}まで / {task.status}</small>
      </span>
    </a>
  );
}

function noticeRecencyTime(notice: Notice) {
  const match = notice.period.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})|(\d{1,2})[/-](\d{1,2})/);
  if (!match) return 0;
  const currentYear = new Date().getFullYear();
  const year = match[1] ? Number(match[1]) : currentYear;
  const month = Number(match[2] || match[4]);
  const day = Number(match[3] || match[5]);
  return new Date(year, month - 1, day).getTime();
}

function isImportantNotice(notice: Notice) {
  return notice.priority === "○" || /重要|要確認|締切|期限|停止|休講|変更|試験/.test(notice.title);
}


function Grades({ data }: { data: GradeData | null }) {
  return (
    <div className="grades-page">
      {!data ? (
        <section className="section grades-empty">
          <h2>成績データはまだ取得されていません</h2>
          <p>右上の「成績を取得」から KOAN の履修成績を読み込めます。</p>
        </section>
      ) : (
        <>
          <section className="grade-metrics" aria-label="成績概要">
            <div><span>修得単位数</span><strong>{data.creditsTotal ?? "不明"}</strong></div>
            <div><span>通算 GPA</span><strong>{data.cumulativeGpa || "不明"}</strong></div>
            <div><span>修得科目</span><strong>{data.courses.length}</strong></div>
            <div><span>履修履歴</span><strong>{data.history.length}</strong></div>
          </section>

          <section className="section grade-section">
            <div className="section-heading">
              <div>
                <h2>科目小区分</h2>
              </div>
            </div>
            <div className="credit-groups">
              {data.groups.map((group) => (
                <details key={group.name}>
                  <summary>
                    <span>{group.name}</span>
                    <b>{group.credits} 単位</b>
                  </summary>
                  <GradeTable courses={group.courses} />
                </details>
              ))}
            </div>
          </section>

          {!!data.termGpas.length && (
            <section className="grade-gpa-grid">
              <div className="section grade-section compact-section">
                <div className="section-heading"><h2>学期 GPA</h2></div>
                <table className="record-table">
                  <thead><tr><th>年度</th><th>学期</th><th>GPA</th></tr></thead>
                  <tbody>
                    {data.termGpas.map((item, index) => (
                      <tr key={`${item.year}-${item.term}-${index}`}>
                        <td>{item.year}</td><td>{item.term}</td><td>{item.gpa}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <GpaTrend courses={data.courses} termGpas={data.termGpas} />
            </section>
          )}

          <section className="section grade-section">
            <div className="section-heading">
              <div>
                <h2>履修成績</h2>
              </div>
            </div>
            <div className="table-scroll">
              <table className="record-table">
                <thead><tr><th>科目名</th><th>教員</th><th>年度</th><th>評語</th><th>合否</th></tr></thead>
                <tbody>
                  {data.history.map((item, index) => (
                    <tr key={`${item.code}-${index}`}>
                      <td>{item.course}</td><td>{item.teacher}</td><td>{item.year}</td><td>{item.grade}</td><td>{item.pass}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function halfTerm(value: string) {
  return /春|夏/.test(value) ? "前期" : /秋|冬/.test(value) ? "後期" : "";
}

function GpaTrend({
  courses,
  termGpas,
}: {
  courses: GradeData["courses"];
  termGpas: GradeData["termGpas"];
}) {
  const termCredits = new Map<string, number>();
  for (const course of courses) {
    const key = `${course.year}-${course.term}`;
    termCredits.set(key, (termCredits.get(key) || 0) + course.credits);
  }
  const grouped = new Map<string, { credits: number; qualityPoints: number }>();
  for (const item of termGpas) {
    const half = halfTerm(item.term);
    const gpa = Number.parseFloat(item.gpa);
    const credits = termCredits.get(`${item.year}-${item.term}`) || 0;
    if (!half || !Number.isFinite(gpa) || credits <= 0) continue;
    const key = `${item.year}-${half}`;
    const current = grouped.get(key) || { credits: 0, qualityPoints: 0 };
    grouped.set(key, {
      credits: current.credits + credits,
      qualityPoints: current.qualityPoints + gpa * credits,
    });
  }
  let cumulativeCredits = 0;
  let cumulativeQualityPoints = 0;
  const points = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, values]) => {
      const [year, half] = key.split("-");
      cumulativeCredits += values.credits;
      cumulativeQualityPoints += values.qualityPoints;
      return {
        cumulative: cumulativeQualityPoints / cumulativeCredits,
        key,
        label: `${year} ${half}`,
      };
    });
  const width = 590;
  const height = 285;
  const margin = { top: 35, right: 20, bottom: 50, left: 42 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const x = (index: number) =>
    margin.left + (points.length <= 1 ? plotWidth / 2 : (plotWidth * index) / (points.length - 1));
  const y = (value: number) => margin.top + plotHeight - (plotHeight * value) / 4;
  const cumulativePolyline = points.map((point, index) => `${x(index)},${y(point.cumulative)}`).join(" ");

  return (
    <section className="section grade-section gpa-trend">
      <div className="section-heading">
        <div>
          <h2>GPA 推移</h2>
          <p>前期・後期ごとの時点累積 GPA</p>
        </div>
      </div>
      <div className="gpa-chart">
        <svg aria-label="前期・後期ごとの時点累積 GPA の推移" role="img" viewBox={`0 0 ${width} ${height}`}>
          {[0, 1, 2, 3, 4].map((tick) => (
            <g className="gpa-grid-line" key={tick}>
              <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
              <text x={margin.left - 11} y={y(tick) + 4}>{tick.toFixed(1)}</text>
            </g>
          ))}
          {!!points.length && <polyline className="gpa-line cumulative" points={cumulativePolyline} />}
          {points.map((point, index) => (
            <g className="gpa-point cumulative" key={`${point.key}-cumulative`}>
              <circle cx={x(index)} cy={y(point.cumulative)} r="4" />
              <text className="gpa-value" x={x(index)} y={y(point.cumulative) - 12}>{point.cumulative.toFixed(2)}</text>
              <text className="gpa-label" x={x(index)} y={height - 20}>{point.label}</text>
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}

function GradeTable({ courses }: { courses: GradeData["courses"] }) {
  return (
    <div className="table-scroll">
      <table className="record-table">
        <thead><tr><th>科目名</th><th>詳細区分</th><th>年度・学期</th><th>単位</th><th>評語</th></tr></thead>
        <tbody>
          {courses.map((course, index) => (
            <tr key={`${course.course}-${course.year}-${index}`}>
              <td>{course.course}</td><td>{course.majorCategory}</td><td>{course.year} {course.term}</td><td>{course.credits}</td><td>{course.grade || course.pass}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const dateKey = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(date.getMonth() + months, 1);
  return next;
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function monthGrid(monthDate: Date) {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const start = addDays(firstDay, -firstDay.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(start, index);
    return {
      date,
      inMonth: date.getMonth() === monthDate.getMonth(),
      key: dateKey(date),
    };
  });
}

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date);
}

function selectedDateLabel(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(dateFromKey(value));
}

function selectedClassHeading(value: string) {
  const date = dateFromKey(value);
  return `${date.getMonth() + 1}/${date.getDate()} (${new Intl.DateTimeFormat("ja-JP", {
    weekday: "narrow",
  }).format(date)}) の授業`;
}

function periodNumber(value: string) {
  return value.match(/\d+/)?.[0] || "";
}


function DashboardRightRail({
  changes,
  onSelectDate,
  schedule,
  selectedDate,
  tasks,
}: {
  changes: ChangeItem[];
  onSelectDate: (date: string) => void;
  schedule: ScheduleItem[];
  selectedDate: string;
  tasks: CleTask[];
}) {
  const today = dateKey(new Date());
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const moveMonth = (months: number) => setVisibleMonth((current) => addMonths(current, months));
  const periods = ["1", "2", "3", "4", "5", "6"];
  const activeTasks = useMemo(
    () => tasks.filter((task) => !["提出済み", "採点済み"].includes(task.status)),
    [tasks],
  );
  const deadlineDates = useMemo(
    () => new Set(activeTasks.map((task) => dateKey(new Date(task.dueAt)))),
    [activeTasks],
  );
  const selectedTasks = activeTasks
    .filter((task) => dateKey(new Date(task.dueAt)) === selectedDate)
    .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
  return (
    <aside className="dashboard-right-rail">
      <section className="rail-section calendar-panel">
        <MonthCalendar
          deadlineDates={deadlineDates}
          month={visibleMonth}
          onNextMonth={() => moveMonth(1)}
          onPreviousMonth={() => moveMonth(-1)}
          onSelectDate={onSelectDate}
          selectedDate={selectedDate}
          today={today}
        />
      </section>
      <section className="rail-section selected-day-panel">
        <div className="rail-heading">
          <div>
            <h2>{selectedClassHeading(selectedDate)}</h2>
          </div>
        </div>
        <div className="rail-schedule-list">
          {periods.map((period) => {
            const item = schedule.find((scheduleItem) => periodNumber(scheduleItem.period) === period);
            const change = item ? changeFor(item, changes) : null;
            return (
              <div className={`rail-schedule-row ${item ? "" : "empty-period"}`} key={period}>
                <b>{period}</b>
                <span>
                  {item?.title && <span className="rail-course-title">{item.title}</span>}
                  {item?.room && <small>{item.room}</small>}
                  {change && <em>{change.type}</em>}
                </span>
              </div>
            );
          })}
          {changes
            .filter((change) => !schedule.some((item) => changeFor(item, [change])))
            .map((item, index) => (
              <div className="rail-change-row" key={`${item.date}-${item.period}-${index}`}>
                <b>{item.type}</b>
                <span>{item.period}<small>{item.course}</small></span>
              </div>
            ))}
        </div>
      </section>
      <section className="rail-section selected-deadline-panel">
        <div className="rail-heading">
          <h2>締切課題</h2>
        </div>
        <div className="rail-deadline-list">
          {selectedTasks.length ? (
            <>
              {selectedTasks.slice(0, 2).map((task) => (
                <a className="rail-deadline-row" href={cleTaskUrl(task)} key={task.id} target="_blank">
                  <time>{new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date(task.dueAt))}</time>
                  <span>
                    <b>{task.title}</b>
                    <small>{courseDisplayName(task.courseName)}</small>
                  </span>
                </a>
              ))}
              {selectedTasks.length > 2 && <p className="rail-more">他 {selectedTasks.length - 2} 件</p>}
            </>
          ) : <p className="rail-empty">この日の締切課題はありません。</p>}
        </div>
      </section>
    </aside>
  );
}

function MonthCalendar({
  deadlineDates,
  month,
  onNextMonth,
  onPreviousMonth,
  onSelectDate,
  selectedDate,
  today,
}: {
  deadlineDates: Set<string>;
  month: Date;
  onNextMonth: () => void;
  onPreviousMonth: () => void;
  onSelectDate: (date: string) => void;
  selectedDate: string;
  today: string;
}) {
  const days = monthGrid(month);
  return (
    <div className="month-calendar">
      <div className="month-heading">
        <button aria-label="前の月" onClick={onPreviousMonth} type="button">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide-icon chevron-left">
            <path d="m15 18-6-6 6-6"/>
          </svg>
        </button>
        <h3>{monthLabel(month)}</h3>
        <button aria-label="次の月" onClick={onNextMonth} type="button">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide-icon chevron-right">
            <path d="m9 18 6-6-6-6"/>
          </svg>
        </button>
      </div>
      <div className="calendar-weekdays" aria-hidden="true">
        {["日", "月", "火", "水", "木", "金", "土"].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="calendar-days">
        {days.map((day) => {
          return (
            <button
              aria-label={`${selectedDateLabel(day.key)}を選択`}
              className={[
                day.inMonth ? "" : "outside",
                day.key === selectedDate ? "selected" : "",
                day.key === today ? "today" : "",
                deadlineDates.has(day.key) ? "has-deadline" : "",
              ].filter(Boolean).join(" ")}
              key={day.key}
              onClick={() => onSelectDate(day.key)}
              type="button"
            >
              <span>{day.date.getDate()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function changeMatchesDate(change: ChangeItem, date: string) {
  const match = change.date.match(/(\d{1,2})[\/月](\d{1,2})/);
  if (!match) return false;
  const [, month, day] = date.split("-");
  return Number(month) === Number(match[1]) && Number(day) === Number(match[2]);
}

function changesForDate(changes: ChangeItem[], date: string, today: string) {
  return changes.filter(
    (item) => changeMatchesDate(item, date) || (date === today && item.date === "今週"),
  );
}

function changeFor(schedule: ScheduleItem, changes: ChangeItem[]) {
  return changes.find((change) => {
    const sameDate = !schedule.date || changeMatchesDate(change, schedule.date);
    const samePeriod = change.period && change.period === schedule.period;
    const sameCourse =
      change.course &&
      (change.course.includes(schedule.title) || schedule.title.includes(change.course));
    return sameDate && samePeriod && sameCourse;
  });
}


function NewActivity({
  loading,
  messages,
  notices,
  onOpen,
}: {
  loading: boolean;
  messages: CleData["messages"];
  notices: Notice[];
  onOpen: (notice: Notice) => void;
}) {
  const latestNotices = notices
    .filter((notice) => notice.unread || notice.isNew || attentionScore(notice) >= 20)
    .sort((left, right) => {
      const recency = noticeRecencyTime(right) - noticeRecencyTime(left);
      return recency || attentionScore(right) - attentionScore(left);
    })
    .slice(0, 5);
  return (
    <>
      <section className="section cle-messages-section">
        <div className="section-heading">
          <div>
            <h2>CLEメッセージ</h2>
          </div>
          <a className="detail-link" href={CLE_MESSAGES_URL} target="_blank">CLEで確認</a>
        </div>
        <div className="cle-messages-list">
          {messages.length ? messages.map((message) => (
            <a className="cle-message-row" href={cleMessageUrl(message.courseId)} target="_blank" key={message.courseId}>
              <span>{courseDisplayName(message.courseName)}</span>
              <b>未読 {message.unreadCount}</b>
            </a>
          )) : <p className="empty">{loading ? "取得中です。" : "未読メッセージはありません。"}</p>}
        </div>
      </section>

      <section className="section koan-notices-section">
        <div className="section-heading">
          <div>
            <h2>KOAN新着掲示</h2>
          </div>
        </div>
        <div className="koan-notices-list">
          {latestNotices.length ? latestNotices.map((notice) => (
            <ActivityNotice notice={notice} onOpen={onOpen} key={noticeKey(notice)} />
          )) : <p className="empty">要確認の掲示はありません。</p>}
        </div>
      </section>
    </>
  );
}

function ActivityNotice({
  notice,
  onOpen,
}: {
  notice: Notice;
  onOpen: (notice: Notice) => void;
}) {
  const [opening, setOpening] = useState(false);
  const openNotice = async () => {
    const detailWindow = window.open("", "_blank");
    onOpen(notice);
    setOpening(true);
    try {
      const url = await resolveNoticeUrl(notice);
      if (detailWindow) detailWindow.location.href = url || BOARD_URL;
    } catch {
      if (detailWindow) detailWindow.location.href = BOARD_URL;
    } finally {
      setOpening(false);
    }
  };
  return (
    <button className="activity-notice" type="button" disabled={opening} onClick={openNotice}>
      <div className="notice-chip-row">
        <span className="notice-chip genre-chip">{notice.genre}</span>
        {notice.unread && <span className="notice-chip state-chip">未読</span>}
        {isImportantNotice(notice) && <span className="notice-chip state-chip important-chip">重要</span>}
        {opening && <span className="notice-chip state-chip">取得中</span>}
      </div>
      <h3 className="notice-title">{notice.title}</h3>
      <p className="notice-meta">{[notice.department, notice.period].filter(Boolean).join(" / ")}</p>
    </button>
  );
}

function ReferenceDesk({
  allNotices,
  genre,
  notices,
  onGenreChange,
  onOpen,
  onQueryChange,
  onScopeChange,
  query,
  scope,
  snapshotUpdatedAt,
}: {
  allNotices: Notice[];
  genre: string;
  notices: Notice[];
  onGenreChange: (value: string) => void;
  onOpen: (notice: Notice) => void;
  onQueryChange: (value: string) => void;
  onScopeChange: (value: string) => void;
  query: string;
  scope: string;
  snapshotUpdatedAt: string | null;
}) {
  const summary = {
    all: allNotices.length,
    unread: allNotices.filter((notice) => notice.unread).length,
    attention: allNotices.filter((notice) => attentionScore(notice) >= 120).length,
    important: allNotices.filter(isImportantNotice).length,
  };
  const tabs = [
    ["attention", "要確認", summary.attention],
    ["unread", "未読", summary.unread],
    ["important", "重要", summary.important],
    ["all", "すべて", summary.all],
  ] as const;

  return (
    <div className="reference-page">
      <section className="notice-summary" aria-label="掲示サマリー">
        <div>
          <span>全</span>
          <strong>{summary.all}</strong>
          <small>件</small>
        </div>
        <div className="needs-action">
          <span>未読</span>
          <strong>{summary.unread}</strong>
          <small>件</small>
        </div>
        <div className="needs-action">
          <span>要確認</span>
          <strong>{summary.attention}</strong>
          <small>件</small>
        </div>
        <p>同期 {fmtTime(snapshotUpdatedAt)}</p>
      </section>

      <section className="notice-operations" aria-label="掲示の絞り込み">
        <div className="notice-scope-tabs" role="tablist" aria-label="状態">
          {tabs.map(([value, label, count]) => (
            <button
              aria-selected={scope === value}
              className={scope === value ? "active" : ""}
              key={value}
              onClick={() => onScopeChange(value)}
              role="tab"
              type="button"
            >
              <span>{label}</span>
              <b>{count}</b>
            </button>
          ))}
        </div>
        <div className="notice-tools">
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="掲示を検索" />
          <select value={genre} onChange={(event) => onGenreChange(event.target.value)}>
            <option value="">全ジャンル</option>
            {GENRES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
      </section>

      <section className="notice-list-section" aria-label="掲示一覧">
        <NoticeList notices={notices} onOpen={onOpen} />
      </section>
    </div>
  );
}

function NoticeList({
  notices,
  onOpen,
}: {
  notices: Notice[];
  onOpen: (notice: Notice) => void;
}) {
  const [opening, setOpening] = useState("");

  const openNotice = async (notice: Notice) => {
    const key = `${notice.title}-${notice.period}`;
    const detailWindow = window.open("", "_blank");
    onOpen(notice);
    setOpening(key);
    try {
      const url = await resolveNoticeUrl(notice);
      if (detailWindow) detailWindow.location.href = url || BOARD_URL;
    } catch {
      if (detailWindow) detailWindow.location.href = BOARD_URL;
    } finally {
      setOpening("");
    }
  };

  if (!notices.length) return <p className="empty notice-empty">条件に一致する掲示はありません。</p>;
  const importantNotices = notices.filter(isImportantNotice);
  const otherNotices = notices.filter((notice) => !isImportantNotice(notice));
  const showGroups = Boolean(importantNotices.length && otherNotices.length);
  const renderRows = (items: Notice[]) => items.slice(0, 300).map((notice) => {
    const key = `${notice.title}-${notice.period}`;
    const openingThis = opening === key;
    return (
      <button
        className={[
          "notice-row",
          notice.unread ? "unread" : "",
          isImportantNotice(notice) ? "important" : "",
        ].filter(Boolean).join(" ")}
        type="button"
        disabled={Boolean(opening)}
        onClick={() => openNotice(notice)}
        key={key}
      >
        <div className="notice-content">
          <div className="notice-row-meta">
            <span className="notice-chip genre-chip">{notice.genre}</span>
            {attentionScore(notice) >= 120 && <span className="notice-chip state-chip important-chip">要確認</span>}
            {notice.isNew && <span className="notice-chip state-chip">新着</span>}
            {openingThis && <span className="notice-chip state-chip">取得中</span>}
          </div>
          <h3 title={notice.title}>{notice.title}</h3>
          <p>{[notice.department, notice.author].filter(Boolean).join(" / ") || "発信元未取得"}</p>
        </div>
        <time>{notice.period || "期間未取得"}</time>
      </button>
    );
  });

  return (
    <div className="notice-list">
      {showGroups ? (
        <>
          <div className="notice-group-heading">
            <h2>重要掲示</h2>
            <span>{importantNotices.length}件</span>
          </div>
          {renderRows(importantNotices)}
          <div className="notice-group-heading secondary">
            <h2>その他の掲示</h2>
            <span>{otherNotices.length}件</span>
          </div>
          {renderRows(otherNotices)}
        </>
      ) : renderRows(notices)}
    </div>
  );
}

export default App;
