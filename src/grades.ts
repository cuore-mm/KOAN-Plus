import type { TermGpa } from "./koan";

export type GpaTrendPoint = {
  key: string;
  label: string;
  gpa: number;
};

function academicTermOrder(term: string) {
  if (/春/.test(term)) return 0;
  if (/夏/.test(term)) return 1;
  if (/秋/.test(term)) return 2;
  if (/冬/.test(term)) return 3;
  if (/前期/.test(term)) return 0;
  if (/後期/.test(term)) return 2;
  return 4;
}

export function buildGpaTrendPoints(termGpas: TermGpa[]): GpaTrendPoint[] {
  return termGpas
    .map((item, index) => ({
      gpa: Number.parseFloat(item.gpa),
      index,
      term: item.term,
      year: item.year,
      yearNumber: Number.parseInt(item.year, 10),
    }))
    .filter((item) => Number.isFinite(item.gpa) && item.gpa >= 0 && item.gpa <= 4)
    .sort((left, right) => {
      const leftYear = Number.isFinite(left.yearNumber)
        ? left.yearNumber
        : Number.MAX_SAFE_INTEGER;
      const rightYear = Number.isFinite(right.yearNumber)
        ? right.yearNumber
        : Number.MAX_SAFE_INTEGER;
      return leftYear - rightYear ||
        academicTermOrder(left.term) - academicTermOrder(right.term) ||
        left.term.localeCompare(right.term, "ja") ||
        left.index - right.index;
    })
    .map((item) => ({
      key: `${item.year}-${item.term}-${item.index}`,
      label: `${item.year} ${item.term}`,
      gpa: item.gpa,
    }));
}
