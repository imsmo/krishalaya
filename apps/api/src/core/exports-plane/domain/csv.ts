// core/exports-plane/domain/csv.ts · the file, one line at a time, with its digest and its row count computed WHILE it
// is written (PC-56 TENANT-6e-2). Pure: a sink the caller drains; no filesystem, no store.
//
// RFC 4180: comma-separated, CRLF line endings, a field is quoted when it holds a comma, a quote, a CR or an LF, and a
// quote inside a quoted field is doubled. UTF-8 with a BOM, because the person opening a Gujarati cooperative's file is
// opening it in a spreadsheet program that guesses the encoding wrong without one — and the BOM is part of the bytes
// the digest covers, so the receipt's sha256 is the sha256 of the file as delivered, not of some canonical form of it.
//
// FORMULA INJECTION. A cell beginning `=`, `@`, or a sign followed by a non-digit is what a spreadsheet executes on open;
// a member's name entered as `=HYPERLINK(...)` at a counter must not run when the secretary opens the export. Such a
// cell is prefixed with a single quote — which is data, and is recorded in the file's notes by the producer when it
// matters. A negative NUMBER (`-12.5`) is left alone: it is what a spreadsheet must read as a number.
import { createHash, Hash } from 'node:crypto';

export const CSV_BOM = '\uFEFF';
export const CSV_EOL = '\r\n';

export function csvCell(v: string | number | bigint | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'string' ? v : String(v);
  if (/^[=@\t\r]/.test(s) || /^[+-](?![0-9.])/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(cells: ReadonlyArray<string | number | bigint | boolean | null | undefined>): string {
  return cells.map(csvCell).join(',') + CSV_EOL;
}

/**
 * Writes a CSV through a byte-consuming callback and keeps the three facts the receipt needs: DATA rows, bytes, sha256.
 * The header is written once and is not a row. `finish()` may be called exactly once.
 */
export class CsvSink {
  private readonly hash: Hash = createHash('sha256');
  private rows = 0;
  private bytes = 0;
  private headerWritten = false;
  private finished = false;

  constructor(private readonly write: (chunk: Buffer) => Promise<void> | void) {}

  /** Bytes written so far — the worker's size cap reads it between rows. */
  get bytesSoFar(): number { return this.bytes; }
  get rowsSoFar(): number { return this.rows; }

  private async emit(text: string): Promise<void> {
    if (this.finished) throw new Error('CsvSink: write after finish');
    const b = Buffer.from(text, 'utf8');
    this.hash.update(b);
    this.bytes += b.length;
    await this.write(b);
  }

  async header(cells: readonly string[]): Promise<void> {
    if (this.headerWritten) throw new Error('CsvSink: header written twice');
    this.headerWritten = true;
    await this.emit(CSV_BOM + csvLine(cells));
  }

  async row(cells: ReadonlyArray<string | number | bigint | boolean | null | undefined>): Promise<void> {
    if (!this.headerWritten) throw new Error('CsvSink: row before header');
    this.rows += 1;
    await this.emit(csvLine(cells));
  }

  finish(): { rowCount: number; byteSize: number; sha256: string } {
    if (this.finished) throw new Error('CsvSink: finished twice');
    this.finished = true;
    return { rowCount: this.rows, byteSize: this.bytes, sha256: this.hash.digest('hex') };
  }
}

/** A SAFE file name from a dataset code and a stamp: `dairy.insights` → `dairy-insights-90d-2026-09-10.csv`. Only what a
 *  Content-Disposition header and every filesystem accept; never a tenant name (it would leak into a download log). */
export function exportFileName(datasetCode: string, suffix: string, day: string): string {
  const base = `${datasetCode}-${suffix}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${base}-${day}.csv`.slice(0, 200);
}
