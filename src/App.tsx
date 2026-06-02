import { useEffect, useMemo, useState } from "react";
import jsQR from "jsqr";
import {
  ACTIONS,
  BOARD_URL,
  GENRES,
  GRADE_HISTORY_URL,
  LIGHT_REFRESH_TTL_MS,
  PORTAL_URL,
  SCHEDULE_URL,
  SNAPSHOT_TTL_MS,
  type ChangeItem,
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
  type CleTask,
  cleMessageUrl,
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
  ensureCleLogin,
  ensureKoanLogin,
  loadAuthSettings,
  refreshCleLogin,
  saveAuthSettings,
} from "./auth";

const EMPTY = {
  schedule: [],
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

const fmtToday = () =>
  new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(new Date());

function App() {
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
  const [view, setView] = useState<"dashboard" | "reference" | "grades" | "settings">("dashboard");

  const updateKoan = async () => {
    setLoading(true);
    setStatus("ログイン状態を確認中");
    try {
      if (!isExpired(data.lightUpdatedAt, LIGHT_REFRESH_TTL_MS)) {
        setStatus(`キャッシュ表示中 / 更新 ${fmtTime(data.lightUpdatedAt)}`);
        return;
      }
      const auth = await ensureKoanLogin();
      if (auth.loginStarted) setStatus("自動ログイン完了 / 更新中");
      else setStatus("更新中");
      const result = await refreshLight(data.notices);
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
      if (auth.loginStarted) setCleStatus("CLE自動ログイン完了 / 更新中");
      else setCleStatus("CLE更新中");
      let next;
      try {
        next = await refreshCle(auth.tabId);
      } catch {
        setCleStatus("CLEセッションを再認証中");
        const refreshedAuth = await refreshCleLogin();
        next = await refreshCle(refreshedAuth.tabId);
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
    await updateKoan();
    await updateCle();
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
        if (scope === "attention" && attentionScore(notice) < 20) return false;
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

  return (
    <>
      <header className="app-header">
        <div className="brand">
          <span>KOAN</span>
          <b>Plus</b>
        </div>
        <nav className="main-nav" aria-label="画面切替">
          <button className={view === "dashboard" ? "active" : ""} type="button" onClick={() => setView("dashboard")}>
            ダッシュボード
          </button>
          <button className={view === "reference" ? "active" : ""} type="button" onClick={() => setView("reference")}>
            掲示
          </button>
          <button className={view === "grades" ? "active" : ""} type="button" onClick={() => setView("grades")}>
            成績
          </button>
          <button className={view === "settings" ? "active" : ""} type="button" onClick={() => setView("settings")}>
            設定
          </button>
        </nav>
        <div className="header-actions">
          <small>{status || cleStatus || `更新 ${fmtTime(data.lightUpdatedAt)}`}</small>
          <a href={PORTAL_URL} target="_blank">KOAN</a>
          <button type="button" disabled={loading || cleLoading} onClick={update}>
            更新
          </button>
        </div>
      </header>

      <main>
        {view === "dashboard" ? (
          <>
        <DashboardIntro
          tasks={cleData.tasks}
          notices={data.notices}
          unreadMessages={cleData.unreadMessages}
        />

        <section className="dashboard-columns">
          <div className="dashboard-lane">
            <WeeklyAgenda schedule={data.schedule} changes={data.changes} />
            <NewActivity
              loading={cleLoading}
              messages={cleData.messages}
              notices={data.notices}
              onOpen={markNoticeRead}
            />
          </div>
          <div className="dashboard-lane">
            <NextActions data={cleData} loading={cleLoading} status={cleStatus} />
            <QuickLinks />
          </div>
        </section>

          </>
        ) : view === "reference" ? (
          <ReferenceDesk
            genre={genre}
            notices={notices}
            onGenreChange={setGenre}
            onOpen={markNoticeRead}
            onQueryChange={setQuery}
            onScopeChange={setScope}
            onSync={syncSnapshot}
            progress={progress}
            query={query}
            scope={scope}
            snapshotExpired={snapshotExpired}
            snapshotLoading={snapshotLoading}
            snapshotUpdatedAt={data.snapshotUpdatedAt}
          />
        ) : view === "grades" ? <Grades /> : <Settings />}
      </main>
    </>
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
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [mfaConsent, setMfaConsent] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [status, setStatus] = useState("設定を確認中");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAuthSettings()
      .then((next) => {
        setSettings(next);
        setMfaEnabled(next.mfaEnabled);
        setStatus("");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, []);

  const run = async (task: () => Promise<AuthSettings>, success: string) => {
    setSaving(true);
    try {
      const next = await task();
      setSettings(next);
      setStatus(success);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const save = () => run(
    () => saveAuthSettings({
      enabled: settings.enabled,
      id,
      password,
      totpSecret,
      mfaConsent,
      mfaEnabled,
    }),
    settings.enabled ? "端末内に暗号化して保存しました。" : "自動ログインを無効にしました。",
  );

  return (
    <div className="settings-page">
      <header className="page-intro settings-intro">
        <div>
          <h1>設定</h1>
          <p>認証情報は端末内の拡張ストレージにだけ保存します。</p>
        </div>
        <span className={`auth-state ${settings.configured ? "ready" : ""}`}>
          {settings.configured ? "設定済み" : settings.enabled ? "編集中" : "未使用"}
        </span>
      </header>

      <section className="section settings-section">
        <div className="section-heading">
          <div>
            <h2>IT認証基盤の自動ログイン</h2>
            <p>任意設定です。登録後は IT 認証基盤で自動入力・送信します。</p>
          </div>
        </div>

        <label className="setting-toggle">
          <input
            checked={settings.enabled}
            onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })}
            type="checkbox"
          />
          <span>自動ログインを使用する</span>
        </label>

        {settings.enabled && (
          <>
            <div className="settings-grid">
              <label>
                <span>大阪大学個人ID</span>
                <input autoComplete="username" onChange={(event) => setId(event.target.value)} placeholder={settings.configured ? `保存済み: ${settings.idHint}` : ""} value={id} />
              </label>
              <label>
                <span>パスワード</span>
                <input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} placeholder={settings.configured ? "保存済み（変更時のみ入力）" : ""} type="password" value={password} />
              </label>
            </div>
            <div className="mfa-settings">
              <label className="setting-toggle mfa-toggle">
                <input checked={mfaEnabled} onChange={(event) => setMfaEnabled(event.target.checked)} type="checkbox" />
                <span>二段階認証も自動化する</span>
              </label>
              {mfaEnabled && (
                <>
                  <p>任意です。QR画像を端末内で解析するか、Base32 形式の手動入力コードを登録します。</p>
                  <label>
                    <span>TOTP シークレット</span>
                    <input autoComplete="off" onChange={(event) => setTotpSecret(event.target.value)} placeholder={settings.mfaEnabled ? "保存済み（変更時のみ入力）" : "例: JBSWY3DPEHPK3PXP"} value={totpSecret} />
                  </label>
                  <QrImport onSecret={setTotpSecret} onStatus={setStatus} />
                  <label className="mfa-consent">
                    <input checked={mfaConsent} onChange={(event) => setMfaConsent(event.target.checked)} type="checkbox" />
                    <span>パスワードと TOTP シークレットを同じ端末に保存すると、端末を奪われた場合に二要素を同時に失うリスクがあります。利便性とのトレードオフを理解し、MFA 自動化に同意します。</span>
                  </label>
                </>
              )}
            </div>
          </>
        )}

        <div className="settings-actions">
          <button disabled={saving || (settings.enabled && ((!settings.configured && (!id || !password)) || (mfaEnabled && !mfaConsent)))} onClick={save} type="button">
            設定を保存
          </button>
        </div>
        {status && <p className="settings-status">{status}</p>}
      </section>

      <section className="settings-note">
        <h2>扱う範囲</h2>
        <p>認証情報は KOAN Plus 独自のサーバーへ送信しません。抽出不能な暗号鍵と AES-GCM 暗号文を端末内に保存します。MFA を有効にした場合だけ、RFC 6238 に従って端末内で認証コードを生成します。</p>
      </section>
    </div>
  );
}

function QrImport({
  onSecret,
  onStatus,
}: {
  onSecret: (secret: string) => void;
  onStatus: (status: string) => void;
}) {
  const readQr = async (file: File) => {
    try {
      const Detector = (window as unknown as {
        BarcodeDetector?: new (options: { formats: string[] }) => {
          detect(image: ImageBitmap): Promise<Array<{ rawValue: string }>>;
        };
      }).BarcodeDetector;
      const bitmap = await createImageBitmap(file);
      let value = "";
      if (Detector) {
        const codes = await new Detector({ formats: ["qr_code"] }).detect(bitmap);
        value = codes[0]?.rawValue || "";
      }
      if (!value) {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("QR画像を解析できませんでした。");
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        value = jsQR(pixels.data, pixels.width, pixels.height)?.data || "";
      }
      bitmap.close();
      if (!value) throw new Error("QRコードを読み取れませんでした。画像を確認してください。");
      const url = new URL(value);
      if (url.protocol !== "otpauth:" || url.hostname !== "totp") {
        throw new Error("TOTP 登録用のQRコードではありません。");
      }
      const secret = url.searchParams.get("secret");
      if (!secret) throw new Error("QRコードにTOTPシークレットが含まれていません。");
      onSecret(secret);
      onStatus("QRコードを端末内で読み取りました。保存前にリスク同意を確認してください。");
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <label className="qr-import">
      <span>QR画像から読み取る</span>
      <input accept="image/*" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void readQr(file);
      }} type="file" />
      <small>QR画像は外部へ送信せず、このブラウザ内だけで解析します。</small>
    </label>
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

function courseDisplayName(value: string) {
  const withoutCode = value.replace(/^[^:]+:\s*\d+\s*/, "");
  const japanese = withoutCode.split(/\s*\/\s*/)[0];
  return japanese
    .replace(/\s*【[^】]*】/g, "")
    .replace(/\s+[月火水木金土日]\d+\s*$/, "")
    .trim() || value;
}

function DashboardIntro({
  tasks,
  notices,
  unreadMessages,
}: {
  tasks: CleTask[];
  notices: Notice[];
  unreadMessages: number;
}) {
  const openTasks = tasks.filter(
    (task) =>
      !["提出済み", "採点済み"].includes(task.status) &&
      new Date(task.dueAt).getTime() >= Date.now(),
  );
  const unreadNotices = notices.filter((notice) => notice.unread).length;
  return (
    <section className="dashboard-intro">
      <h1>{fmtToday()}</h1>
      <div className="dashboard-metrics" aria-label="要確認件数">
        <div><span>課題</span><strong>{openTasks.length}</strong></div>
        <div><span>CLE未読</span><strong>{unreadMessages}</strong></div>
        <div><span>KOAN未読</span><strong>{unreadNotices}</strong></div>
      </div>
    </section>
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
    .sort((left, right) => left.dueAt.localeCompare(right.dueAt))
    .slice(0, 8);
  const expiredTasks = tasks
    .filter((task) => new Date(task.dueAt).getTime() < Date.now())
    .sort((left, right) => right.dueAt.localeCompare(left.dueAt));
  return (
    <section className="section next-actions">
      <div className="section-heading">
        <div>
          <h2>次にやること</h2>
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

function QuickLinks() {
  return (
    <section className="section quick-links">
      <div className="section-heading">
        <h2>よく使うリンク</h2>
      </div>
      <div className="quick-links-grid">
        {ACTIONS.map((action) => (
          <a key={action.label} href={action.url} target="_blank">{action.label}</a>
        ))}
      </div>
    </section>
  );
}

function Grades() {
  const [data, setData] = useState<GradeData | null>(() =>
    loadGradesCache<GradeData>(),
  );
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const update = async () => {
    setLoading(true);
    setStatus("成績を取得中");
    try {
      const next = await refreshGrades(setStatus);
      setData(next);
      saveGradesCache(next);
      setStatus("取得しました");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grades-page">
      <section className="grades-intro">
        <div>
          <h1>成績</h1>
        </div>
        <div className="grades-controls">
          <small>{status || (data ? `取得 ${fmtTime(data.updatedAt)}` : "未取得")}</small>
          <a href={GRADE_HISTORY_URL} target="_blank">KOANで開く</a>
          <button type="button" disabled={loading} onClick={update}>成績を取得</button>
        </div>
      </section>

      {!data ? (
        <section className="section grades-empty">
          <h2>必要な時だけ取得</h2>
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
              <strong>{data.groups.length}</strong>
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

function weekDays() {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return {
      key: dateKey(date),
      label: new Intl.DateTimeFormat("ja-JP", { weekday: "short" }).format(date),
      shortDate: `${date.getMonth() + 1}/${date.getDate()}`,
    };
  });
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

function WeeklyAgenda({
  schedule,
  changes,
}: {
  schedule: ScheduleItem[];
  changes: ChangeItem[];
}) {
  const days = useMemo(weekDays, []);
  const today = dateKey(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const selectedSchedule = schedule.filter((item) => (item.date || today) === selectedDate);
  const selectedChanges = changesForDate(changes, selectedDate, today);
  const unmatchedChanges = selectedChanges.filter(
    (change) => !selectedSchedule.some((item) => changeFor(item, [change])),
  );
  const selectedDay = days.find((day) => day.key === selectedDate) || days[0];
  return (
    <section className="section today-agenda">
      <div className="section-heading">
        <div>
          <h2>今週の時間割</h2>
        </div>
        <a className="detail-link" href={SCHEDULE_URL} target="_blank">KOANで確認</a>
      </div>
      <div className="week-tabs" role="tablist" aria-label="表示する曜日">
        {days.map((day) => {
          const daySchedule = schedule.filter((item) => (item.date || today) === day.key);
          const dayChanges = changesForDate(changes, day.key, today);
          return (
            <button
              aria-selected={day.key === selectedDate}
              className={day.key === selectedDate ? "active" : ""}
              key={day.key}
              onClick={() => setSelectedDate(day.key)}
              role="tab"
              type="button"
            >
              <span>{day.label}</span>
              <small>{day.shortDate}</small>
              <b>{daySchedule.length}</b>
              {dayChanges.length > 0 && <em>{dayChanges.length}</em>}
            </button>
          );
        })}
      </div>
      <div className="agenda-column weekly-agenda-column">
        <div className="column-heading">
          <h3>{selectedDay.shortDate}（{selectedDay.label}） <b>{selectedSchedule.length}</b></h3>
          {selectedChanges.length > 0 && <span className="change-summary">変更 {selectedChanges.length}</span>}
        </div>
        <div className="agenda-rows">
          {selectedSchedule.length ? selectedSchedule.map((item, index) => {
            const change = changeFor(item, selectedChanges);
            return (
              <div className="schedule-row" key={`${item.period}-${index}`}>
                <b>{item.period}</b>
                <span>
                  {item.title}
                  <small>{item.room}</small>
                  {change && <em>{change.type}</em>}
                </span>
              </div>
            );
          }) : <p className="empty">この日の授業はありません。</p>}
          {unmatchedChanges.map((item, index) => (
            <div className="change-row" key={`${item.date}-${item.period}-${index}`}>
              <b>{item.type}</b>
              <span>{item.period}<small>{item.course}</small></span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
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
    .sort((left, right) => attentionScore(right) - attentionScore(left))
    .slice(0, 5);
  return (
    <section className="section activity-section">
      <div className="section-heading">
        <div>
          <h2>新着</h2>
        </div>
      </div>
      <div className="activity-grid">
        <div className="activity-column">
          <div className="column-heading">
            <h3>KOAN掲示 <b>{latestNotices.length}</b></h3>
          </div>
          {latestNotices.length ? latestNotices.map((notice) => (
            <ActivityNotice notice={notice} onOpen={onOpen} key={noticeKey(notice)} />
          )) : <p className="empty">要確認の掲示はありません。</p>}
        </div>
        <div className="activity-column message-inbox">
          <div className="column-heading">
            <h3>CLEメッセージ <b>{messages.reduce((sum, message) => sum + message.unreadCount, 0)}</b></h3>
            <a className="detail-link" href={CLE_MESSAGES_URL} target="_blank">CLEで確認</a>
          </div>
          {messages.length ? messages.slice(0, 6).map((message) => (
            <a className="cle-message-row" href={cleMessageUrl(message.courseId)} target="_blank" key={message.courseId}>
              <span>{courseDisplayName(message.courseName)}</span>
              <b>{message.unreadCount}</b>
            </a>
          )) : <p className="empty">{loading ? "取得中です。" : "未読メッセージはありません。"}</p>}
        </div>
      </div>
    </section>
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
      <span>{notice.genre}</span>
      <div>
        <h3>{notice.title}</h3>
        <p>{[notice.department, notice.period].filter(Boolean).join(" / ")}</p>
      </div>
      <b>{opening ? "取得中" : notice.unread ? "未読" : "新着"}</b>
    </button>
  );
}

function ReferenceDesk({
  genre,
  notices,
  onGenreChange,
  onOpen,
  onQueryChange,
  onScopeChange,
  onSync,
  progress,
  query,
  scope,
  snapshotExpired,
  snapshotLoading,
  snapshotUpdatedAt,
}: {
  genre: string;
  notices: Notice[];
  onGenreChange: (value: string) => void;
  onOpen: (notice: Notice) => void;
  onQueryChange: (value: string) => void;
  onScopeChange: (value: string) => void;
  onSync: () => void;
  progress: string;
  query: string;
  scope: string;
  snapshotExpired: boolean;
  snapshotLoading: boolean;
  snapshotUpdatedAt: string | null;
}) {
  return (
    <div className="reference-page">
      <header className="page-intro">
        <h1>掲示</h1>
      </header>
      <section className="section notices-section">
        <div className="section-heading">
          <div>
            <h2>掲示</h2>
            <p>同期 {fmtTime(snapshotUpdatedAt)}{snapshotExpired ? " / 更新推奨" : ""}</p>
          </div>
          <strong>{notices.length}</strong>
        </div>
        <div className="filters">
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="掲示を検索" />
          <select value={genre} onChange={(event) => onGenreChange(event.target.value)}>
            <option value="">全ジャンル</option>
            {GENRES.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select value={scope} onChange={(event) => onScopeChange(event.target.value)}>
            <option value="attention">要確認</option>
            <option value="unread">未読</option>
            <option value="all">取得済みすべて</option>
          </select>
          <button type="button" disabled={snapshotLoading || !snapshotExpired} onClick={onSync}>
            {snapshotExpired ? "掲示を同期" : "同期済み"}
          </button>
          <span>{progress}</span>
        </div>
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
  return (
    <div className="notice-list">
      {notices.slice(0, 300).map((notice) => {
        const key = `${notice.title}-${notice.period}`;
        return (
          <button className="notice-row" type="button" disabled={Boolean(opening)} onClick={() => openNotice(notice)} key={key}>
            <span>{notice.genre}</span>
            <div>
              <h3>{notice.title}</h3>
              <p>{[notice.department, notice.author, notice.period].filter(Boolean).join(" / ")}</p>
            </div>
            <div className="flags">
              {opening === key && <b>取得中</b>}
              {notice.unread && <b>未読</b>}
              {notice.isNew && <b>新着</b>}
              {attentionScore(notice) >= 120 && <b>要確認</b>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default App;
