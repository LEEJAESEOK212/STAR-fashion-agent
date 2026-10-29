export type GenerationDisplayState = "idle" | "thinking" | "streaming" | "paused" | "stopped" | "complete";

type GenerationStatusProps = {
  state: GenerationDisplayState;
  durationMs: number | null;
};

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!minutes) return `${seconds}초 동안 작업함`;
  if (!seconds) return `${minutes}분 동안 작업함`;
  return `${minutes}분 ${seconds}초 동안 작업함`;
}

export function GenerationStatus({ state, durationMs }: GenerationStatusProps) {
  let label = "";
  if (state === "thinking") label = "답변 생성 중...";
  if (state === "paused") label = "답변 일시 정지됨";
  if (state === "stopped") label = durationMs === null
    ? "답변 중지됨"
    : formatDuration(durationMs);
  if (state === "complete" && durationMs !== null) label = formatDuration(durationMs);
  if (!label) return null;

  return (
    <div className="generation-status" role="status" aria-live="polite">
      <span>
        {label}
        {(state === "complete" || (state === "stopped" && durationMs !== null)) && <i aria-hidden="true">›</i>}
      </span>
    </div>
  );
}
