import { expect, it } from "vitest";
import { noticeBenefit } from "./notice-benefits";

it("distinguishes explicit benefits from research requiring detail confirmation", () => {
  expect(noticeBenefit({ title: "【受講料無料】統計入門の受講者募集" })).toEqual({ label: "無料・無償", evidence: "title" });
  expect(noticeBenefit({ title: "図書館の資料配送サービス無償化" })?.label).toBe("無料・無償");
  expect(noticeBenefit({ title: "【謝礼1,000円】認知実験の協力者募集" })?.label).toBe("謝礼あり");
  expect(noticeBenefit({ title: "【実験参加者募集】視覚判断のオンライン研究" })).toEqual({ label: "研究参加・謝礼未確認", evidence: "needs-detail" });
  expect(noticeBenefit({ title: "【学生限定】デザインサービスの利用開始" })?.evidence).toBe("needs-detail");
  expect(noticeBenefit({ title: "【割引情報】研究支援サービス" })?.label).toBe("割引・優待");
});
it("excludes warnings, closures, administration and unpaid recruiting", () => {
  for (const title of ["【注意喚起】無料サービスをかたる詐欺", "無料閲覧サービスの終了", "旅費、謝金の支給を受けるみなさまへ", "割引証の取扱変更について", "【ボランティア募集】地域交流", "実験参加者募集（謝礼なし）", "【募集終了】無料講座", "一般向け講演会の開催", "謝礼ではありません"])
    expect(noticeBenefit({ title }), title).toBeNull();
});
