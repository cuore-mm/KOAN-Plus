import type { Notice } from "./koan";

export type NoticeBenefit = { label: string; evidence: "title" | "needs-detail" };

/** Conservative title evidence only. Never read a notice body just to classify it. */
export function noticeBenefit(notice: Pick<Notice, "title">): NoticeBenefit | null {
  const title = notice.title.normalize("NFKC");
  // Administrative notices, warnings and unpaid volunteering are not offers.
  if (/注意喚起|詐欺|募集終了|受付終了|募集停止|中止|廃止|無償化終了|無料.*(?:終了|停止)|(?:無料|割引|謝礼|報酬).*(?:ではありません|なし|無し|ありません)|(?:謝金|旅費).*(?:受けるみなさま|事務|手続)|割引証.*(?:変更|取扱)|ボランティア/i.test(title)) return null;
  if (/(?:謝礼|報酬|謝金)(?:あり|有|付き|付|支給|提供|[:：\s]*[\d,]+円)|(?:ギフト券|商品券|図書カード).*(?:進呈|支給|プレゼント)|有償.*(?:募集|参加|協力)/i.test(title)) return { label: "謝礼あり", evidence: "title" };
  if (/副賞あり|賞金.*(?:募集|コンテスト)|(?:募集|コンテスト).*賞金/i.test(title)) return { label: "賞金・副賞", evidence: "title" };
  if (/無料|無償化|無償(?:提供|利用)|\bfree\s+(?:access|subscription|admission|webinar)/i.test(title)) return { label: "無料・無償", evidence: "title" };
  if (/割引(?:情報|特典|サービス|案内)|学割(?:サービス|特典)|優待|クーポン/i.test(title)) return { label: "割引・優待", evidence: "title" };
  if (/(?:研究|実験)(?:参加者|協力者|被験者).*募集|(?:研究|実験).*参加者募集/.test(title)) return { label: "研究参加・謝礼未確認", evidence: "needs-detail" };
  if (/(?:学生限定|学内限定).*(?:サービス|利用)|(?:電子ブック|電子書籍).*(?:利用できます|利用開始)|(?:nikkei\s*asia|日経アジア).*(?:利用|購読|閲覧)/i.test(title)) return { label: "利用条件を確認", evidence: "needs-detail" };
  return null;
}
