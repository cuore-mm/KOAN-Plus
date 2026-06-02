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
  const [view, setView] = useState<"dashboard" | "grades">("dashboard");

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
        <CleAttention data={cleData} loading={cleLoading} status={cleStatus} />

        <section className="summary-grid">
          <Today schedule={data.schedule} />
          <Changes changes={data.changes} />
        </section>

        <section className="section notices-section">
          <div className="section-heading">
            <div>
              <h2>掲示</h2>
              <p>同期 {fmtTime(data.snapshotUpdatedAt)}{snapshotExpired ? " / 更新推奨" : ""}</p>
            </div>
            <strong>{notices.length}</strong>
          </div>
          <div className="filters">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="掲示を検索" />
            <select value={genre} onChange={(event) => setGenre(event.target.value)}>
              <option value="">全ジャンル</option>
              {GENRES.map((item) => <option key={item}>{item}</option>)}
            </select>
            <select value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="attention">要確認</option>
              <option value="unread">未読</option>
              <option value="all">取得済みすべて</option>
            </select>
            <button type="button" disabled={snapshotLoading || !snapshotExpired} onClick={syncSnapshot}>
              {snapshotExpired ? "掲示を同期" : "同期済み"}
            </button>
            <span>{progress}</span>
          </div>
          <NoticeList notices={notices} onOpen={markNoticeRead} />
        </section>

        <section className="section actions-section">
          <div className="section-heading">
            <h2>操作一覧</h2>
          </div>
          <div className="actions-grid">
            {ACTIONS.map((action) => (
              <a key={action.label} href={action.url} target="_blank">{action.label}</a>
            ))}
          </div>
        </section>
          </>
        ) : <Grades />}
      </main>
    </>
  );
}

function fmtDue(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function CleAttention({
  data,
  loading,
  status,
}: {
  data: CleData;
  loading: boolean;
  status: string;
}) {
  const tasks = data.tasks
    .filter((task) => !["提出済み", "採点済み"].includes(task.status))
    .slice(0, 8);
  return (
    <section className="section cle-attention">
      <div className="section-heading">
        <div>
          <h2>要対応</h2>
          <p>CLE取得 {fmtTime(data.updatedAt)}{status ? ` / ${status}` : ""}</p>
        </div>
        <a className="detail-link" href={CLE_CALENDAR_URL} target="_blank">CLEカレンダー</a>
      </div>
      <div className="cle-grid">
        <div className="cle-tasks">
          <h3>CLE課題</h3>
          {tasks.length ? tasks.map((task) => <CleTaskRow task={task} key={task.id} />) : (
            <p className="empty">{loading ? "取得中です。" : "要対応の課題はありません。"}</p>
          )}
        </div>
        <div className="cle-messages">
          <div className="cle-message-heading">
            <div>
              <h3>CLEメッセージ</h3>
              <p>{data.unreadMessages}件未読</p>
            </div>
            <a className="detail-link" href={CLE_MESSAGES_URL} target="_blank">CLEで確認</a>
          </div>
          {data.messages.length ? data.messages.slice(0, 8).map((message) => (
            <a className="cle-message-row" href={cleMessageUrl(message.courseId)} target="_blank" key={message.courseId}>
              <span>{message.courseName}</span>
              <b>{message.unreadCount}</b>
            </a>
          )) : <p className="empty">{loading ? "取得中です。" : "未読メッセージはありません。"}</p>}
        </div>
      </div>
    </section>
  );
}

function CleTaskRow({ task }: { task: CleTask }) {
  const overdue = new Date(task.dueAt).getTime() < Date.now();
  return (
    <a className="cle-task-row" href={cleTaskUrl(task)} target="_blank">
      <b className={overdue ? "overdue" : ""}>{task.status}</b>
      <span>
        {task.title}
        <small>{task.courseName} / {fmtDue(task.dueAt)} 締切</small>
      </span>
    </a>
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
          <p className="eyebrow">ACADEMIC RECORD</p>
          <h1>成績</h1>
          <p>履修成績と単位修得状況を照合し、科目小区分ごとに集計します。</p>
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
          <p>取得した成績データは、この端末の拡張機能内にだけ保存します。</p>
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
                <p>卒業要件の確認に使う単位集計</p>
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
                <p>KOANの履修成績照会から取得</p>
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

function Today({ schedule }: { schedule: ScheduleItem[] }) {
  return (
    <section className="section">
      <div className="section-heading"><h2>今日の授業</h2></div>
      <div className="rows">
        {schedule.length ? schedule.map((item, index) => (
          <div className="schedule-row" key={`${item.period}-${index}`}>
            <b>{item.period}</b>
            <span>{item.title}<small>{item.room}</small></span>
          </div>
        )) : <p className="empty">予定はありません。</p>}
      </div>
    </section>
  );
}

function Changes({ changes }: { changes: ChangeItem[] }) {
  return (
    <section className="section">
      <div className="section-heading">
        <h2>休講・変更</h2>
        <a className="detail-link" href={CHANGES_URL} target="_blank">KOANで確認</a>
      </div>
      <div className="rows">
        {changes.length ? changes.map((item, index) => (
          <div className="change-row" key={`${item.date}-${item.period}-${index}`}>
            <b>{item.type}</b>
            <span>{item.date} {item.period}<small>{item.course}</small></span>
          </div>
        )) : <p className="empty">今週の変更はありません。</p>}
      </div>
    </section>
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
