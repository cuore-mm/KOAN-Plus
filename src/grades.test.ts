import { describe, expect, it } from "vitest";
import { buildGpaTrendPoints } from "./grades";

describe("buildGpaTrendPoints", () => {
  it("uses official term GPA values without recalculating them from earned credits", () => {
    const points = buildGpaTrendPoints([
      { year: "2025", term: "夏学期", gpa: "2.75" },
      { year: "2024", term: "秋学期", gpa: "3.10" },
      { year: "2025", term: "春学期", gpa: "3.50" },
    ]);

    expect(points.map((point) => [point.label, point.gpa])).toEqual([
      ["2024 秋学期", 3.1],
      ["2025 春学期", 3.5],
      ["2025 夏学期", 2.75],
    ]);
  });

  it("omits malformed and out-of-range GPA values", () => {
    const points = buildGpaTrendPoints([
      { year: "2025", term: "春学期", gpa: "不明" },
      { year: "2025", term: "夏学期", gpa: "4.1" },
      { year: "2025", term: "秋学期", gpa: "2.8" },
    ]);

    expect(points).toHaveLength(1);
    expect(points[0].gpa).toBe(2.8);
  });
});
