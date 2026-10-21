import ExcelJS from 'exceljs';

/** Enough for years of use; a bigger download should be narrowed with the filters. */
export const MAX_EXPORT_ROWS = 50_000;

type Cell = string | number | null;

/**
 * One sheet as an Excel download: a bold, frozen heading row, then the rows.
 * Numbers stay numbers so Excel can add them up.
 */
export async function xlsxResponse(filename: string, sheetName: string, headers: string[], rows: Cell[][]): Promise<Response> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const row of rows) ws.addRow(row);
  ws.columns.forEach((col, i) => {
    const longest = Math.max(headers[i]?.length ?? 0, ...rows.slice(0, 500).map((r) => String(r[i] ?? '').length));
    col.width = Math.min(60, Math.max(10, longest + 2));
  });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(await wb.xlsx.writeBuffer()), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}-${day}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
