// Minimal XLSX reader for Workers — enough to parse Xero's "Project
// Financials" export: unzip (stored/deflate via DecompressionStream) and
// regex-parse sharedStrings + the first worksheet.

function u16(dv: DataView, o: number): number {
  return dv.getUint16(o, true);
}
function u32(dv: DataView, o: number): number {
  return dv.getUint32(o, true);
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** Extract one file from a zip archive by name. */
export async function unzipEntry(buf: ArrayBuffer, name: string): Promise<string | null> {
  const bytes = new Uint8Array(buf);
  const dv = new DataView(buf);
  // Find end-of-central-directory (scan back for PK\x05\x06).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = u16(dv, eocd + 10);
  let off = u32(dv, eocd + 16);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) return null;
    const method = u16(dv, off + 10);
    const compSize = u32(dv, off + 20);
    const nameLen = u16(dv, off + 28);
    const extraLen = u16(dv, off + 30);
    const commentLen = u16(dv, off + 32);
    const localOff = u32(dv, off + 42);
    const entryName = dec.decode(bytes.subarray(off + 46, off + 46 + nameLen));
    if (entryName === name) {
      // Local header: name/extra lengths there may differ from the CD copy.
      const lNameLen = u16(dv, localOff + 26);
      const lExtraLen = u16(dv, localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const data = bytes.subarray(start, start + compSize);
      const out = method === 8 ? await inflateRaw(data) : method === 0 ? data : null;
      return out ? new TextDecoder().decode(out) : null;
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const unescapeXml = (s: string): string =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, "&");

/** Rows of the first worksheet as arrays of strings, indexed by column. */
export async function readSheetRows(buf: ArrayBuffer): Promise<string[][]> {
  const ssXml = (await unzipEntry(buf, "xl/sharedStrings.xml")) ?? "";
  const shared: string[] = [];
  for (const si of ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const texts = [...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1]));
    shared.push(texts.join(""));
  }
  const sheetXml = (await unzipEntry(buf, "xl/worksheets/sheet1.xml")) ?? "";
  const rows: string[][] = [];
  for (const rowM of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cm of rowM[1].matchAll(/<c ([^>]*?)\/>|<c ([^>]*?)>([\s\S]*?)<\/c>/g)) {
      const attrs = cm[1] ?? cm[2] ?? "";
      const inner = cm[3] ?? "";
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1] ?? "";
      let col = 0;
      for (const ch of ref) col = col * 26 + (ch.charCodeAt(0) - 64);
      col = Math.max(0, col - 1);
      const t = /t="([^"]+)"/.exec(attrs)?.[1] ?? "";
      let val = "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      if (t === "s" && v != null) val = shared[Number(v)] ?? "";
      else if (t === "inlineStr") val = unescapeXml([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));
      else if (v != null) val = unescapeXml(v);
      while (cells.length < col) cells.push("");
      cells[col] = val.trim();
    }
    rows.push(cells);
  }
  return rows;
}

export type ProjectItem = {
  project_name: string;
  contact: string;
  item_type: string;
  item_name: string;
  cost: number;
  charge: number;
  invoiced: number;
};

/** Parse Xero's "Project Financials" export into allocation line items. */
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

/** "1 March 2026 to 28 February 2027" → { label, month } (month set when single-month). */
export function parsePeriod(raw: string): { label: string; month: string | null } {
  const label = raw.trim();
  const ms = [...label.matchAll(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/g)].map((m) => {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    return mi >= 0 ? `${m[3]}-${String(mi + 1).padStart(2, "0")}` : null;
  });
  const start = ms[0] ?? null;
  const end = ms[1] ?? ms[0] ?? null;
  return { label, month: start && end && start === end ? start : null };
}

export async function parseProjectFinancials(buf: ArrayBuffer): Promise<{ period: string; items: ProjectItem[] }> {
  const rows = await readSheetRows(buf);
  let period = "";
  let cols: Record<string, number> = {};
  let current = "";
  const items: ProjectItem[] = [];
  const num = (s: string | undefined): number => {
    const n = Number(String(s ?? "").replace(/[,\s]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  for (const r of rows) {
    const a = r[0] ?? "";
    if (!period && /for the period/i.test(a)) period = a.replace(/for the period/i, "").trim();
    // Header row establishes column positions.
    if (r.some((c) => c === "Project Item Type") && r.some((c) => c === "Contact")) {
      cols = {};
      r.forEach((c, i) => {
        if (c) cols[c] = i;
      });
      continue;
    }
    if (Object.keys(cols).length === 0) continue;
    const type = r[cols["Project Item Type"]] ?? "";
    const nonEmpty = r.filter((c) => c !== "").length;
    if (a && !type && nonEmpty <= 1 && !/^total/i.test(a)) {
      current = a; // project group header
      continue;
    }
    if (!current || !type) continue; // totals / blank rows
    items.push({
      project_name: current,
      contact: a,
      item_type: type,
      item_name: r[cols["Project Item Name"]] ?? "",
      cost: num(r[cols["Cost Amount"]]),
      charge: num(r[cols["Charge Amount"]]),
      invoiced: num(r[cols["Invoiced Amount"]]),
    });
  }
  return { period, items };
}
