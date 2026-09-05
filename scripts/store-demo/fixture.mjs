/** Entirely invented data for public screenshots. Never replace with a storage export. */
export const demoNow = '2026-10-05T10:00:00+09:00';
const updatedAt = new Date(demoNow).toISOString();
const at = (day, hour = '23:59:00') => `2026-10-${String(day).padStart(2, '0')}T${hour}+09:00`;
const definitions = [
  ['データサイエンス入門', '月', '2', 'A201'],
  ['線形代数学', '月', '3', 'B102'],
  ['アカデミック・ライティング', '月', '4', 'C203'],
  ['情報科学概論', '火', '2', 'A202'],
  ['認知科学入門', '火', '3', 'B201'],
  ['統計学', '水', '2', 'A201'],
  ['プログラミング演習', '木', '3,4', '情報演習室'],
  ['科学技術と社会', '金', '2', 'C101'],
];
const courses = definitions.map(([title, day, period, room], i) => ({
  code: `DEMO-${i + 1}`, departmentCode: 'DEMO', year: '2026', title, day, period: period.includes(',') ? period.split(',').map(slot => day + slot).join(',') : period,
  teacherAndRoom: `担当教員 / ${room}`, syllabusUrl: 'https://koan.osaka-u.ac.jp/campusweb/__demo__/syllabus',
}));
const schedule = Array.from({length: 4}, (_, week) => definitions.flatMap(([title, day, period, room]) =>
  period.split(',').map(slot => ({date: `2026-10-${String(5 + week * 7 + '月火水木金'.indexOf(day)).padStart(2, '0')}`, period: slot, title, room, kind: 'course'})),
)).flat();
// The cache validator requires the KOAN origin. These invented paths are disabled by the demo server.
const notices = [
  ['秋学期の履修登録内容を確認してください', '教務', '○', true, '教務担当', 5],
  ['線形代数学：次回授業の教室変更について', '授業', '', true, '授業担当', 5],
  ['学内キャリアセミナー「研究を仕事につなげる」', 'ｷｬﾘｱ支援', '', true, 'キャリア支援担当', 4],
  ['図書館の学習スペースを夜間開放します', '学生生活', '', false, '図書館', 4],
  ['秋の留学相談会：参加受付のお知らせ', '海外留学', '', true, '国際交流担当', 3],
  ['学習環境アンケートへのご協力のお願い', '学生生活', '', false, '学生支援担当', 2],
  ['データサイエンス入門：授業資料の公開について', '授業', '', false, '授業担当', 2],
  ['学生企画ワークショップの参加者を募集します', 'その他', '', false, '学生支援担当', 1],
].map(([title, genre, priority, unread, department, day], i) => ({
  title, genre, priority, unread, department, author: '', live: true, isNew: unread,
  href: `https://koan.osaka-u.ac.jp/campusweb/__demo__/notice-${i}`, period: `2026-10-${String(day).padStart(2, '0')} ～ 2026-10-31`,
}));
const tasks = [
  [0, '第2回レポート：データの可視化', 5, '未着手'],
  [3, '第1回小テスト：情報の表現', 6, '一時保存'],
  [5, '演習課題：確率分布と期待値', 8, '未着手'],
  [0, '第1回レポート：身近なデータを探す', 2, '採点済み'],
].map(([index, title, day, status], i) => ({
  id: `demo-task-${i}`, courseId: `demo-cle-${index}`, courseName: courses[index].title,
  title, dueAt: at(day), status, statusUpdatedAt: updatedAt,
  ...(status === '採点済み' ? {score: 9, possibleScore: 10} : {}),
}));
const announcements = [
  [0, '第2回の授業資料を公開しました', 5],
].map(([index, title, day], i) => ({
  id: `demo-announcement-${i}`, courseId: `demo-cle-${index}`, courseName: courses[index].title,
  title, body: '<p>次回の授業で使う資料を公開しました。授業までに内容を確認してください。</p>', created: at(day, '09:00:00'),
}));
const creditDefinitions = [
  ['全学共通教育科目', ['学問への扉', '現代社会を考える', '科学の方法', '健康とスポーツ']],
  ['専門基礎教育科目', ['微分積分学Ⅰ', '線形代数学Ⅰ', '基礎統計学', '情報学基礎']],
  ['専門教育科目', ['アルゴリズム入門', 'データ構造', 'プログラミング基礎', '離散数学']],
  ['外国語科目', ['英語リーディングⅠ', '英語コミュニケーションⅠ', '英語リーディングⅡ', '英語コミュニケーションⅡ']],
];
const gradeCourses = creditDefinitions.flatMap(([category, titles], categoryIndex) => titles.map((course, i) => ({
  majorCategory: category, minorCategory: category, course, credits: 2,
  year: i < 2 ? '2025' : '2026', term: i === 1 ? '秋・冬' : '春・夏', grade: categoryIndex >= 2 && i % 2 === 1 ? 'S' : 'A', pass: '合格',
})));
export const fixture = {
  koan: {
    courses, schedule, notices,
    changes: [{type: '教室変更', date: '2026-10-05', period: '3', course: '線形代数学'}],
    surveys: [],
    ...Object.fromEntries(['light','snapshot','schedule','futureSchedule','courses','changes','futureChanges','surveys','notices'].map(key => [`${key}UpdatedAt`, updatedAt])),
    snapshotVersion: 2, snapshotComplete: true, warnings: [],
  },
  cle: {
    courses: courses.map((course, i) => ({courseId: `demo-cle-${i}`, displayId: course.code, timetableCode: course.code, name: course.title, available: true})),
    tasks, announcements,
    messages: [{courseId: 'demo-cle-0', courseName: courses[0].title, unreadCount: 1}], unreadMessages: 1,
    updatedAt, ...Object.fromEntries(['courses','tasks','messages','taskStatuses','announcements'].map(key => [`${key}UpdatedAt`, updatedAt])),
    taskScopeVersion: 3, taskStatusCursor: 0, taskStatusPendingCount: 0,
    messagesComplete: true, messagesPendingCount: 0, messagesPaginationVersion: 2,
    announcementCourses: {}, announcementsPendingCount: 0, warnings: [],
  },
  grades: {
    creditsTotal: 32, cumulativeGpa: '3.25',
    termGpas: [{year: '2025', term: '春・夏', gpa: '3.00'}, {year: '2025', term: '秋・冬', gpa: '3.50'}, {year: '2026', term: '春・夏', gpa: '3.25'}],
    groups: creditDefinitions.map(([name]) => ({name, credits: 8, courses: gradeCourses.filter(course => course.majorCategory === name)})),
    courses: gradeCourses,
    history: gradeCourses.map((course, i) => ({code: `DEMO-GRADE-${i}`, course: course.course, teacher: '担当教員', year: course.year, grade: course.grade, pass: course.pass})),
    updatedAt,
  },
};
