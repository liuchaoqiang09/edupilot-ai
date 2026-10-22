export type CsvRow = { line: number; cells: string[] };

const aliases: Record<string, "name" | "grade" | "phone" | "note" | "studentNo"> = {
  姓名: "name",
  "年级/年龄": "grade",
  年级: "grade",
  年龄: "grade",
  家长手机号: "phone",
  手机号: "phone",
  备注: "note",
  联系备注: "note",
  编号: "studentNo",
  学生编号: "studentNo",
};

export function decodeCsvBytes(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("gb18030").decode(bytes);
  }
}

function delimiterOf(headerLine: string) {
  const commas = headerLine.split(",").length;
  const semis = headerLine.split(";").length;
  const tabs = headerLine.split("\t").length;
  if (tabs >= commas && tabs >= semis && tabs > 1) return "\t";
  if (semis > commas) return ";";
  return ",";
}

export function parseCsv(text: string): CsvRow[] {
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const headerLine = source.split("\n", 1)[0] ?? "";
  const delimiter = delimiterOf(headerLine);
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === "\n") line += 1;
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    if (char === "\n") {
      cells.push(cell.trim());
      if (cells.some((value) => value !== "")) rows.push({ line, cells });
      cells = [];
      cell = "";
      line += 1;
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  if (cells.some((value) => value !== "")) rows.push({ line, cells });
  return rows;
}

export function headerMap(cells: string[]) {
  const map = new Map<"name" | "grade" | "phone" | "note" | "studentNo", number>();
  cells.forEach((cell, index) => {
    const key = aliases[cell.replace(/\*/g, "").trim()];
    if (key && !map.has(key)) map.set(key, index);
  });
  return map;
}

export function cellAt(cells: string[], map: Map<string, number>, key: string) {
  const index = map.get(key);
  return index === undefined ? "" : (cells[index] ?? "").trim();
}
