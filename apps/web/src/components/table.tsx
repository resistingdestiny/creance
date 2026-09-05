import type { ReactNode } from 'react';

/**
 * docs/DESIGN-TOKENS.md section 7: 48px rows with a hairline bottom, text on
 * the left and the figure on the right.
 *
 * Two additions the sheet does not make, because its only table is three
 * columns wide and later screens are five and nine:
 *
 * - the header row is the secondary scale in ink-2 at 40px with a hairline
 *   bottom;
 * - numeric columns are right aligned and tabular; text columns are left
 *   aligned. A month is text, an index value is numeric.
 */

export interface TableColumn {
  readonly key: string;
  readonly label: string;
  readonly numeric?: boolean;
}

export interface TableRowData {
  readonly key: string;
  readonly cells: readonly ReactNode[];
}

export function DataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: readonly TableColumn[];
  rows: readonly TableRowData[];
}) {
  return (
    <table className="w-full border-collapse text-body">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-hairline">
          {columns.map((column) => (
            <th
              className={[
                'h-10 px-4 first:pl-0 last:pr-0 text-secondary font-normal text-ink-2',
                column.numeric ? 'text-right tabular-nums' : 'text-left',
              ].join(' ')}
              key={column.key}
              scope="col"
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr className="border-b border-hairline" key={row.key}>
            {row.cells.map((cell, index) => {
              const column = columns[index];
              return (
                <td
                  className={[
                    'h-12 px-4 first:pl-0 last:pr-0 text-ink',
                    column?.numeric ? 'text-right tabular-nums' : 'text-left',
                  ].join(' ')}
                  key={column?.key ?? index}
                >
                  {cell}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
