import { MatchedPosition } from './customer-zalo.entity';

/**
 * Thuật toán tách mã khách hàng khỏi tên Zalo — thiết kế mục 4.3.2.
 *
 * Mã khách hàng LUÔN chứa dấu `_` (ví dụ HQC_TPH_SM_KHOINGUYEN) nhưng không có
 * vị trí cố định trong tên (đầu/giữa/cuối). Hai bước:
 *   B1. regex băm tên thành ứng viên — chỉ nhận ASCII nên tự loại tên có dấu
 *   B2. so khớp TOÀN BỘ chuỗi với tập mã của đúng Sale (dictionary, không LIKE)
 * B5. fallback quét chuỗi con có ranh giới (tên dùng `-` trong khi mã dùng `_`,
 *     hoặc dán liền mép chuỗi) — vẫn so khớp toàn bộ mã.
 */

/** Ứng viên mã: chuỗi ASCII có ≥1 dấu `_` hoặc `-` ở giữa. */
const CODE_CANDIDATE_REGEX = /[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)+/g;

/** B1 — băm tên Zalo thành các ứng viên có thể là mã, đã khử trùng lặp. */
export function extractCodeCandidates(displayName: string): string[] {
  const found = displayName.match(CODE_CANDIDATE_REGEX) ?? [];
  return [...new Set(found)];
}

/**
 * B5 — quét chuỗi con: vị trí `code` xuất hiện trong `displayName` với ranh
 * giới hai đầu là mép chuỗi hoặc ký tự KHÔNG phải chữ/số — nhờ vậy mã ngắn
 * KHÔNG khớp bên trong mã dài (HQC_TPH_SM_KHOI ≠ hậu tố của …KHOINGUYEN).
 * Trả về index xuất hiện đầu tiên, -1 nếu không có.
 */
export function findCodeInName(displayName: string, code: string): number {
  const name = displayName.toUpperCase();
  const needle = code.toUpperCase();
  let from = 0;
  while (from <= name.length - needle.length) {
    const idx = name.indexOf(needle, from);
    if (idx === -1) return -1;
    const beforeOk = idx === 0 || !/[A-Za-z0-9]/.test(name[idx - 1]);
    const afterIdx = idx + needle.length;
    const afterOk =
      afterIdx === name.length || !/[A-Za-z0-9]/.test(name[afterIdx]);
    if (beforeOk && afterOk) return idx;
    from = idx + 1;
  }
  return -1;
}

/** B4 — vị trí khớp để thống kê phong cách đặt tên của Sale. */
export function positionOf(
  displayName: string,
  index: number,
  codeLength: number,
): MatchedPosition {
  if (displayName.length === codeLength) return MatchedPosition.ONLY;
  if (index === 0) return MatchedPosition.START;
  if (index + codeLength === displayName.length) return MatchedPosition.END;
  return MatchedPosition.MIDDLE;
}

/** Một dòng phân công tra được từ mã — matcher dùng để ghi customer_zalo. */
export interface ZaloCodeTarget {
  code: string;
  customer_id: number;
  assignment_ids: number[];
}

export interface ZaloNameMatch {
  /** Mã dài nhất trúng khớp (B3 — mã dài luôn đúng hơn mã ngắn trùng vế). */
  match: ZaloCodeTarget | null;
  /** Nhiều khách trùng nhau ở độ dài lớn nhất → ghi bản ghi trùng is_active=false. */
  conflicts: ZaloCodeTarget[];
  /** Vị trí xuất hiện của mã trong tên (thông kê cho match/conflicts). */
  index: number;
  position: MatchedPosition | null;
}

/**
 * B2+B3+B5 — ghép một tên Zalo với dictionary mã của ĐÚNG Sale đó.
 * `dict` khoá bằng mã IN HOA; tra O(1), không dùng LIKE.
 */
export function matchDisplayName(
  displayName: string,
  dict: Map<string, ZaloCodeTarget>,
): ZaloNameMatch {
  // B1 + B2: ứng viên từ regex, trúng khớp toàn bộ chuỗi
  const hits: Array<{ target: ZaloCodeTarget; index: number }> = [];
  for (const candidate of extractCodeCandidates(displayName)) {
    const target = dict.get(candidate.toUpperCase());
    if (target) {
      hits.push({ target, index: displayName.toUpperCase().indexOf(candidate.toUpperCase()) });
    }
  }
  // B5 fallback: quét chuỗi con có ranh giới trên toàn bộ tập mã của Sale
  if (hits.length === 0) {
    for (const [codeUpper, target] of dict) {
      const idx = findCodeInName(displayName, codeUpper);
      if (idx !== -1) hits.push({ target, index: idx });
    }
  }
  if (hits.length === 0) {
    return { match: null, conflicts: [], index: -1, position: null };
  }

  // B3: lấy mã DÀI nhất; hoà độ dài khác khách → xung đột, người dùng quyết
  const best = hits.reduce((a, b) => (b.target.code.length > a.target.code.length ? b : a));
  const ties = hits.filter((h) => h.target.code.length === best.target.code.length);
  const distinct = new Map<string, { target: ZaloCodeTarget; index: number }>();
  for (const t of ties) {
    if (!distinct.has(t.target.code.toUpperCase())) distinct.set(t.target.code.toUpperCase(), t);
  }
  const finalists = [...distinct.values()];
  const index = finalists[0].index;
  const position = positionOf(displayName, index, finalists[0].target.code.length);
  if (finalists.length > 1) {
    return {
      match: null,
      conflicts: finalists.map((f) => f.target),
      index,
      position,
    };
  }
  return { match: finalists[0].target, conflicts: [], index, position };
}
