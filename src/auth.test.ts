import { expect, it } from "vitest";
import { academicLinkUrl } from "./auth";

it("accepts academic navigation without any asynchronous login checks", () => {
  for (const url of ["https://koan.osaka-u.ac.jp/campusweb/campusportal.do?page=main", "https://www.cle.osaka-u.ac.jp/ultra/messages"])
    expect(academicLinkUrl(url)).toBe(url);
});

it("keeps the existing academic destination restrictions for native links", () => {
  for (const url of ["javascript:alert(1)", "http://koan.osaka-u.ac.jp/campusweb/", "https://example.org/", "https://www.cle.osaka-u.ac.jp.example.org/", "https://koan.osaka-u.ac.jp/other", "invalid"])
    expect(academicLinkUrl(url)).toBeNull();
});
