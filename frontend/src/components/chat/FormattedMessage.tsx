function isAmountHeader(header: string): boolean {
  const h = header.toLowerCase();
  return h.includes("tiền") || h.includes("amount") || h.includes("giá") || h.includes("thu") || h.includes("chi");
}

function isCategoryHeader(header: string): boolean {
  const h = header.toLowerCase();
  return h.includes("danh mục") || h.includes("category");
}

function isDateOrTimeHeader(header: string): boolean {
  const h = header.toLowerCase();
  return h.includes("ngày") || h.includes("date") || h.includes("giờ") || h.includes("time");
}

function formatTableCell(header: string, raw: string) {
  // Category pills and amounts carry their own emphasis, so bold markers are dropped there.
  const cell = raw.replace(/\*\*/g, "");
  if (isCategoryHeader(header)) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#EFECE6] text-ink-2">
        {cell}
      </span>
    );
  }
  if (isAmountHeader(header)) {
    const isPositive = cell.trim().startsWith("+");
    const isNegative = cell.trim().startsWith("-");
    const colorClass = isPositive
      ? "text-[#1E7E34] font-semibold"
      : isNegative
      ? "text-ink font-semibold"
      : "text-ink font-medium";
    return <span className={`font-mono ${colorClass}`}>{cell}</span>;
  }
  return renderInline(raw);
}

/** Render **bold** spans as <strong>; everything else stays plain, escaped text. */
function renderInline(text: string) {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, index) =>
    part.length > 4 && part.startsWith("**") && part.endsWith("**")
      ? <strong key={index} className="font-semibold text-ink">{part.slice(2, -2)}</strong>
      : part,
  );
}

export function FormattedMessage({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ({ type: "text"; lines: string[] } | { type: "table"; headers: string[]; rows: string[][] })[] = [];

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const headers = trimmed.slice(1, -1).split("|").map((c) => c.trim());
      if (i + 1 < lines.length && lines[i + 1].trim().startsWith("|") && lines[i + 1].includes("-")) {
        i += 2;
        const rows: string[][] = [];
        while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
          const cells = lines[i].trim().slice(1, -1).split("|").map((c) => c.trim());
          rows.push(cells);
          i++;
        }
        blocks.push({ type: "table", headers, rows });
        continue;
      }
    }
    const last = blocks[blocks.length - 1];
    if (last && last.type === "text") {
      last.lines.push(lines[i]);
    } else {
      blocks.push({ type: "text", lines: [lines[i]] });
    }
    i++;
  }

  return (
    <div className="flex flex-col gap-2.5 text-inherit">
      {blocks.map((block, idx) => {
        if (block.type === "table") {
          return (
            <div key={idx} className="my-1.5 overflow-x-auto rounded-xl border border-border bg-surface shadow-xs">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-[#F4F2EC] text-ink font-semibold border-b border-border">
                    {block.headers.map((h, hIdx) => {
                      const isAmount = isAmountHeader(h);
                      const isDate = isDateOrTimeHeader(h);
                      const align = isAmount ? "text-right" : isDate ? "text-center" : "text-left";
                      return (
                        <th
                          key={hIdx}
                          className={`px-3.5 py-2.5 whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider ${align}`}
                        >
                          {renderInline(h)}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-row">
                  {block.rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-[#FAF9F5] transition-colors">
                      {row.map((cell, cIdx) => {
                        const h = block.headers[cIdx] || "";
                        const isAmount = isAmountHeader(h);
                        const isDate = isDateOrTimeHeader(h);
                        const align = isAmount ? "text-right" : isDate ? "text-center" : "text-left";
                        return (
                          <td key={cIdx} className={`px-3.5 py-2.5 text-ink-2 whitespace-nowrap ${align}`}>
                            {formatTableCell(h, cell)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        const paragraph = block.lines.join("\n").trim();
        if (!paragraph) return null;
        return (
          <p key={idx} className="m-0 leading-relaxed whitespace-pre-wrap">
            {renderInline(paragraph)}
          </p>
        );
      })}
    </div>
  );
}
