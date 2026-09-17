// modules/education/domain/lesson-clock.ts · PC-56 TENANT-7b · the clock a person types and the seconds the row keeps.
//
// W411 prints durations as `mm:ss` (`08:20`, `42:10`); W412 prints chapter marks (`02:14`) and the thumbnail frame
// (`frame at 02:31`). A person types `8:20`, `08:20`, `1:02:14` or plain `500`; the row stores an integer of seconds;
// the review shows what will be stored in the canon's own format, so `8:20` → `08:20` is a normalisation the screen
// can draw attention to. Integer arithmetic throughout — a duration is not a float.
export const MAX_LESSON_SECS = 86_400;   // the DTO's ceiling since PC-26: a day

/** `mm:ss`, `h:mm:ss` or bare seconds → seconds. Null for anything else (a sign, a fraction, `61` seconds in a field). */
export function parseClock(raw: string | null | undefined): number | null {
  const s = (raw ?? '').trim();
  if (s.length === 0) return null;
  if (/^\d{1,6}$/.test(s)) { const n = Number(s); return n <= MAX_LESSON_SECS ? n : null; }
  const m = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = m[1] === undefined ? 0 : Number(m[1]);
  const mm = Number(m[2]); const ss = Number(m[3]);
  if (ss > 59) return null;
  if (m[1] !== undefined && mm > 59) return null;
  const total = h * 3600 + mm * 60 + ss;
  return total <= MAX_LESSON_SECS ? total : null;
}

/** Seconds → `mm:ss` (the canon's column), or `h:mm:ss` past an hour. Never negative. */
export function formatClock(secs: number): string {
  const n = Math.max(0, Math.trunc(secs));
  const h = Math.floor(n / 3600); const m = Math.floor((n % 3600) / 60); const s = n % 60;
  const two = (x: number) => String(x).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

export interface ParsedChapter { at: number; title: string }
export type ChapterProblem = 'CHAPTER_LINE_INVALID' | 'CHAPTER_ORDER' | 'CHAPTER_BEYOND_DURATION' | 'CHAPTER_TITLE_LONG';
export const MAX_CHAPTERS = 60;
export const MAX_CHAPTER_TITLE = 120;

/**
 * W412's chapter list as text — one `mm:ss title` per line (`00:00 — Why colostrum, in the first hour`; the dash is
 * optional). Marks must increase, and every mark must fall inside the lesson when a duration is known. Every problem is
 * reported, not the first, because a form-error screen that lists one line at a time is a form nobody finishes.
 */
export function parseChapters(raw: string | null | undefined, durationSecs: number | null): { chapters: ParsedChapter[]; problems: ChapterProblem[] } {
  const lines = (raw ?? '').replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const chapters: ParsedChapter[] = []; const problems = new Set<ChapterProblem>();
  if (lines.length > MAX_CHAPTERS) problems.add('CHAPTER_LINE_INVALID');
  let last = -1;
  for (const line of lines.slice(0, MAX_CHAPTERS)) {
    const m = /^(\S+)\s*(?:[—–-]\s*)?(.*)$/.exec(line);
    const at = m ? parseClock(m[1]) : null;
    const title = (m?.[2] ?? '').trim();
    if (at === null || title.length === 0) { problems.add('CHAPTER_LINE_INVALID'); continue; }
    if (title.length > MAX_CHAPTER_TITLE) problems.add('CHAPTER_TITLE_LONG');
    if (at <= last) problems.add('CHAPTER_ORDER');
    if (durationSecs !== null && at >= durationSecs) problems.add('CHAPTER_BEYOND_DURATION');
    last = at;
    chapters.push({ at, title: title.slice(0, MAX_CHAPTER_TITLE) });
  }
  return { chapters, problems: [...problems] };
}

/** The chapters as the form re-shows them — the canon's line shape, so a saved list round-trips through the textarea. */
export function chaptersToText(chapters: readonly ParsedChapter[]): string {
  return chapters.map((c) => `${formatClock(c.at)} — ${c.title}`).join('\n');
}
