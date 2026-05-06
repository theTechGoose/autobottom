/** Reusable data table with column definitions. */
import type { ComponentChildren } from "preact";

interface Column {
  key: string;
  label: string;
  mono?: boolean;
  render?: (value: unknown, row: Record<string, unknown>) => ComponentChildren;
}

interface DataTableProps {
  columns: Column[];
  rows: Record<string, unknown>[];
  emptyMessage?: string;
  title?: string;
}

export function DataTable({ columns, rows, emptyMessage = "No data", title }: DataTableProps) {
  return (
    <div class="tbl">
      {title && <div class="tbl-title">{title}</div>}
      <table class="data-table">
        <thead>
          <tr>
            {columns.map((col) => <th key={col.key}>{col.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr class="empty-row"><td colSpan={columns.length}>{emptyMessage}</td></tr>
          ) : rows.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td key={col.key} class={col.mono ? "mono" : ""}>
                  {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
