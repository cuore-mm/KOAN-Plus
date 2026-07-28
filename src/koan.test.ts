import { describe, expect, it } from "vitest";
import { mergeCourses, noticeKey, type CourseRegistration, type Notice } from "./koan";

function course(
  code: string,
  day: string,
  period: string,
  isIntensive = false,
): CourseRegistration {
  return {
    code,
    day,
    period,
    isIntensive,
    departmentCode: "",
    syllabusUrl: "",
    teacherAndRoom: "",
    title: code,
    year: "2025",
  };
}

describe("mergeCourses", () => {
  it("preserves every slot when the same course has three or more meetings", () => {
    const [merged] = mergeCourses([
      course("ABC001", "月", "1限"),
      course("ABC001", "水", "2限"),
      course("ABC001", "金", "3限"),
    ]);

    expect(merged.day).toBe("月,水,金");
    expect(merged.period).toBe("月1,水2,金3");
  });

  it("keeps a mixed regular/intensive course on the regular timetable", () => {
    const [merged] = mergeCourses([
      course("ABC001", "月", "1限"),
      course("ABC001", "集中", "随時", true),
    ]);

    expect(merged.isIntensive).toBe(false);
    expect(merged.period).toBe("月1");
  });
});

describe("noticeKey", () => {
  it("does not collapse notices when KOAN changes its query parameter names", () => {
    const notice = (href: string): Notice => ({
      title: href,
      href,
      genre: "授業",
      priority: "",
      unread: false,
      department: "",
      author: "",
      period: "",
      live: true,
    });

    expect(noticeKey(notice("https://koan.osaka-u.ac.jp/notice?id=1")))
      .not.toBe(noticeKey(notice("https://koan.osaka-u.ac.jp/notice?id=2")));
  });
});
