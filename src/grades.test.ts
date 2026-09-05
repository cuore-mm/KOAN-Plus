import { describe, expect, it } from "vitest";
import { buildGpaTrendPoints } from "./grades";

describe("buildGpaTrendPoints", () => {
  it("aggregates terms into spring/summer and autumn/winter semesters with definitive GPA", () => {
    const points = buildGpaTrendPoints([
      { year: "2024", term: "春学期", gpa: "4.00" },
      { year: "2024", term: "夏学期", gpa: "3.39" },
      { year: "2024", term: "秋学期", gpa: "0.00" },
      { year: "2024", term: "冬学期", gpa: "3.27" },
      { year: "2025", term: "春学期", gpa: "0.00" },
      { year: "2025", term: "夏学期", gpa: "3.35" },
      { year: "2025", term: "秋学期", gpa: "2.50" },
      { year: "2025", term: "冬学期", gpa: "3.22" },
      { year: "2026", term: "春学期", gpa: "0.00" },
      { year: "2026", term: "夏学期", gpa: "3.00" },
    ]);

    expect(points.map((point) => [point.label, point.gpa])).toEqual([
      ["2024 夏", 3.39],
      ["2024 冬", 3.27],
      ["2025 夏", 3.35],
      ["2025 冬", 3.22],
      ["2026 夏", 3.0],
    ]);
  });

  it("omits 0.00, malformed, and out-of-range GPA values", () => {
    const points = buildGpaTrendPoints([
      { year: "2025", term: "春学期", gpa: "0.00" },
      { year: "2025", term: "春学期", gpa: "不明" },
      { year: "2025", term: "夏学期", gpa: "4.1" },
      { year: "2025", term: "秋学期", gpa: "2.8" },
    ]);

    expect(points).toHaveLength(1);
    expect(points[0].gpa).toBe(2.8);
    expect(points[0].label).toBe("2025 秋");
  });
});
