import { useEffect, useMemo, useState } from "react";
import {
  ACTIONS,
  BOARD_URL,
  CHANGES_URL,
  GENRES,
  GRADE_HISTORY_URL,
  PORTAL_URL,
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
  const [view, setView] = useState<"dashboard" | "reference" | "grades">("dashboard");

  const updateKoan = async () => {
    setLoading(true);
    setStatus("更新中");
    try {
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
    setCleStatus("CLE更新中");
    try {
      const next = await refreshCle();
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
    await Promise.allSettled([updateKoan(), updateCle()]);
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
            <TodayAgenda schedule={data.schedule} changes={data.changes} />
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
        ) : <Grades />}
      </main>
    </>
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
            <section className="section grade-section compact-section">
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

function changeFor(schedule: ScheduleItem, changes: ChangeItem[]) {
  return changes.find((change) => {
    const samePeriod = change.period && change.period === schedule.period;
    const sameCourse =
      change.course &&
      (change.course.includes(schedule.title) || schedule.title.includes(change.course));
    return samePeriod && sameCourse;
  });
}

function TodayAgenda({
  schedule,
  changes,
}: {
  schedule: ScheduleItem[];
  changes: ChangeItem[];
}) {
  return (
    <section className="section today-agenda">
      <div className="section-heading">
        <div>
          <h2>今日</h2>
        </div>
        <span className="today-date">{fmtToday()}</span>
      </div>
      <div className="today-body">
        <div className="agenda-column">
          <h3>時間割 <b>{schedule.length}</b></h3>
          <div className="agenda-rows">
            {schedule.length ? schedule.map((item, index) => {
              const change = changeFor(item, changes);
              return (
                <div className="schedule-row" key={`${item.period}-${index}`}>
                  <b>{item.period}</b>
                  <span>
                    {item.title}
                    <small>{item.room}</small>
                    {change && <em>{change.type} / {change.date}</em>}
                  </span>
                </div>
              );
            }) : <p className="empty">今日の授業はありません。</p>}
          </div>
        </div>
        <div className="changes-column">
          <div className="column-heading">
            <h3>今週の変更 <b>{changes.length}</b></h3>
            <a className="detail-link" href={CHANGES_URL} target="_blank">KOANで確認</a>
          </div>
          <div className="agenda-rows">
            {changes.length ? changes.map((item, index) => (
              <div className="change-row" key={`${item.date}-${item.period}-${index}`}>
                <b>{item.type}</b>
                <span>{item.date} {item.period}<small>{item.course}</small></span>
              </div>
            )) : <p className="empty">今週の変更はありません。</p>}
          </div>
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
