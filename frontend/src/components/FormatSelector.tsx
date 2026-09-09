import type { FormatOption } from "../types";
import { formatBytes } from "../utils/format";

interface Props {
  formats: FormatOption[];
  selected: FormatOption | null;
  onSelect: (format: FormatOption) => void;
  onDownload: () => void;
  starting: boolean;
  error: string | null;
}

const GROUP_LABELS: Record<FormatOption["kind"], string> = {
  "video+audio": "Video + audio",
  "video-only": "Video only",
  "audio-only": "Audio only",
};

function groupFormats(formats: FormatOption[]): [FormatOption["kind"], FormatOption[]][] {
  const order: FormatOption["kind"][] = ["video+audio", "video-only", "audio-only"];
  return order
    .map((kind): [FormatOption["kind"], FormatOption[]] => [kind, formats.filter((f) => f.kind === kind)])
    .filter(([, list]) => list.length > 0);
}

function formatDetails(f: FormatOption): string {
  const parts: string[] = [];
  if (f.fps && f.fps > 30) parts.push(`${f.fps}fps`);
  if (f.kind !== "audio-only" && f.acodec) parts.push("with audio");
  if (f.kind === "video-only") parts.push("no audio");
  const size = formatBytes(f.filesizeBytes);
  if (size) parts.push(`${f.filesizeApprox ? "~" : ""}${size}`);
  return parts.join(" · ");
}

export default function FormatSelector({ formats, selected, onSelect, onDownload, starting, error }: Props) {
  const groups = groupFormats(formats);

  return (
    <div className="card format-selector">
      <h3 className="format-selector-title">Choose a format</h3>

      <div className="format-groups" role="radiogroup" aria-label="Available download formats">
        {groups.map(([kind, list]) => (
          <div className="format-group" key={kind}>
            <p className="format-group-label">{GROUP_LABELS[kind]}</p>
            <div className="format-list">
              {list.map((f) => {
                const isSelected = selected?.formatId === f.formatId;
                return (
                  <button
                    type="button"
                    key={f.formatId}
                    role="radio"
                    aria-checked={isSelected}
                    className={`format-option${isSelected ? " is-selected" : ""}`}
                    onClick={() => onSelect(f)}
                  >
                    <span className="format-option-main">
                      <span className="format-option-label">{f.label}</span>
                      {f.recommended && <span className="format-badge">Recommended</span>}
                    </span>
                    <span className="format-option-details mono">{formatDetails(f)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p className="format-selector-error" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        className="btn btn-primary format-selector-download"
        onClick={onDownload}
        disabled={!selected || starting}
      >
        {starting ? "Starting…" : "Download"}
      </button>
    </div>
  );
}
