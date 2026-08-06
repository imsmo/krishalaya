// apps/web-admin/src/test/admin1d-csv.spec.ts · PC-56 ADMIN-1d.
// The console writes the bytes of the download, so the CSV-injection defence has to exist HERE too — and it has to
// agree with the server's copy. These tests are the contract between the two implementations.
import { csvCell, toCsv, exportFileName } from '../features/billing/csv';

describe('console CSV', () => {
  it('defuses formulas in tenant-controlled text', () => {
    // the file a finance team opens in Excel; a slug or a reason is tenant-controlled text
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('+91 98765')).toBe("'+91 98765");
    expect(csvCell('=cmd|"/c calc"!A0')).toBe(`"'=cmd|""/c calc""!A0"`);
    expect(csvCell('anand-fpo')).toBe('anand-fpo');
  });

  it('matches the server implementation on every rule that matters', () => {
    // Both sides are asserted against the SAME table. If one is edited without the other, this fails — which is the
    // point of duplicating thirty lines rather than importing across an app boundary.
    const cases: Array<[unknown, string]> = [
      [null, ''], [undefined, ''], ['', ''], [0, '0'], [false, 'false'], [true, 'true'],
      ['plain', 'plain'], ['a,b', '"a,b"'], ['say "hi"', '"say ""hi"""'], ['l1\nl2', '"l1\nl2"'],
      ['=X', "'=X"], ['\tx', "'\tx"],
    ];
    for (const [input, expected] of cases) expect(csvCell(input)).toBe(expected);
  });

  it('always writes a header, and follows the declared column order', () => {
    expect(toCsv(['b', 'a'], [{ a: 1, b: 2 }])).toBe('b,a\r\n2,1');
    expect(toCsv(['a'], [])).toBe('a');
    expect(toCsv(['a', 'b'], [{ a: 'x' }])).toBe('a,b\r\nx,');
  });

  it('names the file after the report, the day and the receipt', () => {
    expect(exportFileName('invoices', '018f1234-0000-7000-8000-000000000001', '2026-08-06T09:00:00.000Z'))
      .toBe('krishalaya-invoices-2026-08-06-018f1234.csv');
    // a hostile report name cannot escape the filename
    expect(exportFileName('../../etc/passwd', 'abcd1234', '2026-08-06T00:00:00.000Z'))
      .toBe('krishalaya-etcpasswd-2026-08-06-abcd1234.csv');
  });
});
