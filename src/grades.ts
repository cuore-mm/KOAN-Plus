import type { TermGpa } from "./koan";

export type GpaTrendPoint = {
  key: string;
  year: string;
  term: string;
  label: string;
  gpa: number;
};

type SemesterKind = "spring_summer" | "autumn_winter";

function parseSemester(term: string): { kind: SemesterKind; name: string; order: number } {
  if (/春|夏|前期|1Q|2Q/i.test(term)) {
    const isSummer = /夏|2Q/i.test(term);
    return { kind: "spring_summer", name: isSummer ? "夏" : "春", order: isSummer ? 2 : 1 };
  }
  if (/秋|冬|後期|3Q|4Q/i.test(term)) {
    const isWinter = /冬|4Q/i.test(term);
    return { kind: "autumn_winter", name: isWinter ? "冬" : "秋", order: isWinter ? 2 : 1 };
  }
  return { kind: "spring_summer", name: term, order: 0 };
}

export function buildGpaTrendPoints(termGpas: TermGpa[]): GpaTrendPoint[] {
  const validItems = termGpas
    .map((item, index) => ({
      gpa: Number.parseFloat(item.gpa),
      index,
      term: item.term,
      year: item.year,
      yearNumber: Number.parseInt(item.year, 10),
    }))
    .filter((item) => Number.isFinite(item.gpa) && item.gpa > 0 && item.gpa <= 4);

  type GroupedEntry = {
    year: string;
    yearNumber: number;
    semesterKind: SemesterKind;
    semesterName: string;
    order: number;
    gpa: number;
    originalIndex: number;
  };

  const groups = new Map<string, GroupedEntry>();

  for (const item of validItems) {
    const { kind, name, order } = parseSemester(item.term);
    const groupKey = `${item.year}-${kind}`;
    const existing = groups.get(groupKey);

    if (!existing || order > existing.order || (order === existing.order && item.index > existing.originalIndex)) {
      groups.set(groupKey, {
        year: item.year,
        yearNumber: item.yearNumber,
        semesterKind: kind,
        semesterName: name,
        order,
        gpa: item.gpa,
        originalIndex: item.index,
      });
    }
  }

  return Array.from(groups.values())
    .sort((left, right) => {
      const leftYear = Number.isFinite(left.yearNumber) ? left.yearNumber : Number.MAX_SAFE_INTEGER;
      const rightYear = Number.isFinite(right.yearNumber) ? right.yearNumber : Number.MAX_SAFE_INTEGER;
      if (leftYear !== rightYear) return leftYear - rightYear;

      const semesterOrder = (kind: SemesterKind) => (kind === "spring_summer" ? 0 : 1);
      return semesterOrder(left.semesterKind) - semesterOrder(right.semesterKind);
    })
    .map((entry) => ({
      key: `${entry.year}-${entry.semesterKind}`,
      year: entry.year,
      term: entry.semesterName,
      label: `${entry.year} ${entry.semesterName}`,
      gpa: entry.gpa,
    }));
}
