'use client';

import { useState } from 'react';

import { Check, UploadGlyph } from './icons';

/**
 * The addendum's C3 upload. The whole area is a label wrapping a visually
 * hidden file input, so the keyboard and the screen reader get it for free and
 * there is no drag-and-drop-only path: the phone is the primary device and it
 * has no drag.
 *
 * It reads as a drop target rather than as an empty box. A hairline rectangle
 * saying "Add a file" is indistinguishable from a disabled field, and this is
 * the one control on the proof step, so it carries a dashed edge, the surface
 * tint, a glyph and a second line naming the formats it takes, which is a fact
 * about the control and belongs on it. Which document to send is a different
 * question and stays with the screen, which lists the four that count. The
 * drag state fills the plate rather than only thickening the border, because
 * on a laptop the pointer is over the area and a one pixel change under it is
 * not feedback.
 *
 * Long file names truncate in the middle so the extension stays visible, and a
 * size is shown once a file is over a megabyte, because someone photographing
 * a letter can easily produce eight.
 */

export interface UploadedFile {
  readonly name: string;
  readonly bytes: number;
  readonly failed?: boolean;
}

const MEGABYTE = 1024 * 1024;

export function truncateMiddle(name: string, keep = 14): string {
  if (name.length <= keep * 2) return name;
  return `${name.slice(0, keep)}…${name.slice(-keep)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < MEGABYTE) return '';
  return `${(bytes / MEGABYTE).toFixed(1)} MB`;
}

export function UploadArea({
  files = [],
  name,
  onSelect,
  busy = false,
  className,
}: {
  files?: readonly UploadedFile[];
  /** The field name, when the area sits inside a form that submits the files. */
  name?: string;
  /** Called with the chosen files, for a screen that submits them itself. */
  onSelect?: (chosen: FileList) => void;
  /** A file is on its way up. The label says so and the input is closed. */
  busy?: boolean;
  className?: string;
}) {
  const [over, setOver] = useState(false);

  return (
    <div className={`flex flex-col gap-3 ${className ?? ''}`}>
      <label
        className={[
          'flex min-h-[148px] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-field border-2 border-dashed px-5 text-center transition-colors duration-200 ease-out motion-reduce:transition-none',
          over ? 'border-ink bg-surface' : 'border-hairline bg-surface/60 hover:border-ink-3',
        ].join(' ')}
        onDragLeave={() => setOver(false)}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
        }}
      >
        <input
          accept="image/jpeg,image/png,application/pdf"
          className="sr-only"
          disabled={busy}
          multiple
          name={name}
          onChange={(event) => {
            if (event.target.files !== null) onSelect?.(event.target.files);
          }}
          type="file"
        />
        <UploadGlyph className="text-ink-2" />
        <span className="text-body font-medium text-ink">
          {busy ? 'Adding your file' : 'Add a file, or drop it here'}
        </span>
        <span className="text-secondary text-ink-2">A photo or a PDF</span>
      </label>
      {files.length > 0 ? (
        <ul className="divide-y divide-hairline">
          {files.map((file) => (
            <li
              className="flex min-h-[52px] items-center justify-between gap-4 py-3"
              key={file.name}
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-body text-ink">{truncateMiddle(file.name)}</span>
                {formatBytes(file.bytes) ? (
                  <span className="text-secondary text-ink-2">{formatBytes(file.bytes)}</span>
                ) : null}
              </span>
              {file.failed ? (
                <span className="text-secondary text-ink">
                  <span aria-hidden="true" className="mr-1.5 inline-block size-1.5 rounded-full bg-triggered" />
                  Not added. Try again.
                </span>
              ) : (
                <Check className="shrink-0 text-ink" />
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-secondary text-ink-2">
        We keep your documents private. Only a fingerprint of each file goes on the public record.
      </p>
    </div>
  );
}
