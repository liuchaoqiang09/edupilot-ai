function cell(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CSV_EXPORT_MAX_ROWS = 20_000;

export function csvResponse(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const body = rows.map((row) => row.map(cell).join(",")).join("\r\n");
  return new Response(`\uFEFF${body}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

/** Stream CSV in batches so large exports do not build one giant string in memory. */
export function csvStreamResponse(
  filename: string,
  header: Array<string | number | null | undefined>,
  rows: AsyncIterable<Array<string | number | null | undefined>>,
  maxRows = CSV_EXPORT_MAX_ROWS,
) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`\uFEFF${header.map(cell).join(",")}\r\n`));
      let count = 0;
      for await (const row of rows) {
        controller.enqueue(encoder.encode(`${row.map(cell).join(",")}\r\n`));
        count += 1;
        if (count >= maxRows) {
          controller.enqueue(encoder.encode(`# 已截断：最多导出 ${maxRows} 行，请缩小筛选范围后再导出。\r\n`));
          break;
        }
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
