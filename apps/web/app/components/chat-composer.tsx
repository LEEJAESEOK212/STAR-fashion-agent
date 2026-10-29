"use client";

import {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  SetStateAction,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { PendingAttachment } from "@/lib/chat";

type ChatComposerProps = {
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  attachments: PendingAttachment[];
  setAttachments: Dispatch<SetStateAction<PendingAttachment[]>>;
  disabled: boolean;
  inputDisabled?: boolean;
  allowSubmitWhileDisabled?: boolean;
  isGenerating?: boolean;
  isPaused?: boolean;
  buttonLabel: string;
  queuedPrompt?: string;
  onSendQueuedNow?: () => void;
  onCancelQueued?: () => void;
  onTogglePause?: () => void;
  onStopGeneration?: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onError: (message: string) => void;
  onVoiceOpen: () => void;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechRecognitionEventLike = {
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PASTE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PASTE_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function PaperclipIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M8.7 12.8 14.9 6.6a3 3 0 0 1 4.2 4.2l-8 8a5 5 0 0 1-7.1-7.1l8.4-8.4" />
    </svg>
  );
}

function MicrophoneIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="composer-plus-icon" aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function VoiceChatIcon() {
  return (
    <svg className="voice-chat-icon" aria-hidden="true" viewBox="0 0 24 24">
      <rect x="3" y="9" width="2" height="6" rx="1" />
      <rect x="7" y="6" width="2" height="12" rx="1" />
      <rect x="11" y="4" width="2" height="16" rx="1" />
      <rect x="15" y="7" width="2" height="10" rx="1" />
      <rect x="19" y="10" width="2" height="4" rx="1" />
    </svg>
  );
}

export function SendArrowUpIcon() {
  return (
    <svg className="composer-send-arrow" aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="composer-control-icon composer-stop-icon" aria-hidden="true" viewBox="0 0 24 24">
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg className="composer-control-icon composer-pause-icon" aria-hidden="true" viewBox="0 0 24 24">
      <rect x="7" y="6" width="3.5" height="12" rx="1" />
      <rect x="13.5" y="6" width="3.5" height="12" rx="1" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg className="composer-control-icon composer-play-icon" aria-hidden="true" viewBox="0 0 24 24">
      <path d="m9 7 9 5-9 5Z" />
    </svg>
  );
}

function EnterIcon() {
  return (
    <svg className="composer-control-icon" aria-hidden="true" viewBox="0 0 24 24">
      <path d="M19 5v7a4 4 0 0 1-4 4H6" />
      <path d="m9 12-4 4 4 4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="composer-control-icon" aria-hidden="true" viewBox="0 0 24 24">
      <path d="m7 7 10 10M17 7 7 17" />
    </svg>
  );
}

export function ChatComposer({
  draft,
  setDraft,
  attachments,
  setAttachments,
  disabled,
  inputDisabled = disabled,
  allowSubmitWhileDisabled = false,
  isGenerating = false,
  isPaused = false,
  buttonLabel,
  queuedPrompt,
  onSendQueuedNow,
  onCancelQueued,
  onTogglePause,
  onStopGeneration,
  onSubmit,
  onError,
  onVoiceOpen,
}: ChatComposerProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDictating, setIsDictating] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const dictationBaseRef = useRef("");

  function resizeTextarea() {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const maxHeight = Math.max(120, Math.floor(window.innerHeight * 0.46));
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    setIsExpanded(nextHeight > 44);
  }

  useLayoutEffect(() => {
    resizeTextarea();
  }, [draft]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    window.addEventListener("resize", resizeTextarea);
    return () => window.removeEventListener("resize", resizeTextarea);
  }, []);

  useEffect(() => () => {
    recognitionRef.current?.abort();
    recognitionRef.current = null;
  }, []);

  function toggleDictation() {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const speechWindow = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      onError("이 브라우저에서는 실시간 음성 전사를 지원하지 않습니다. Chrome 또는 Edge에서 이용해 주세요.");
      return;
    }

    const recognition = new Recognition();
    const base = draft && !/\s$/.test(draft) ? `${draft} ` : draft;
    dictationBaseRef.current = base;
    recognition.lang = "ko-KR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trimStart();
      setDraft(`${dictationBaseRef.current}${transcript}`);
    };
    recognition.onerror = (event) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        onError(event.error === "not-allowed"
          ? "마이크 권한이 필요합니다. 브라우저 설정에서 마이크 사용을 허용해 주세요."
          : "실시간 음성 전사를 시작하지 못했습니다.");
      }
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      setIsDictating(false);
      textareaRef.current?.focus();
    };

    try {
      recognitionRef.current = recognition;
      recognition.start();
      setIsDictating(true);
      onError("");
    } catch {
      recognitionRef.current = null;
      setIsDictating(false);
      onError("실시간 음성 전사를 시작하지 못했습니다.");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    onSubmit(event);
  }

  function appendFiles(selected: File[]) {
    if (!selected.length) return;
    if (attachments.length + selected.length > MAX_ATTACHMENTS) {
      onError(`첨부파일은 메시지당 최대 ${MAX_ATTACHMENTS}개까지 추가할 수 있습니다.`);
      return;
    }
    const oversized = selected.find((file) => file.size > MAX_FILE_BYTES);
    if (oversized) {
      onError(`${oversized.name}: 파일 하나의 최대 크기는 10MB입니다.`);
      return;
    }
    const next = selected.map((file) => {
      const kind = file.type.startsWith("image/") ? "image" as const : "file" as const;
      return {
        localId: crypto.randomUUID(),
        file,
        kind,
        previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined,
      };
    });
    setAttachments((current) => [...current, ...next]);
    setMenuOpen(false);
    onError("");
  }

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    appendFiles(selected);
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const itemImages = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    const pastedImages = itemImages.length
      ? itemImages
      : Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (!pastedImages.length) return;

    event.preventDefault();
    const unsupported = pastedImages.find((file) => !PASTE_IMAGE_TYPES.has(file.type));
    if (unsupported) {
      onError("붙여넣기는 JPG, PNG, WebP 이미지만 지원합니다.");
      return;
    }
    const timestamp = Date.now();
    appendFiles(pastedImages.map((file, index) => new File(
      [file],
      `붙여넣은-이미지-${timestamp}-${index + 1}.${PASTE_IMAGE_EXTENSIONS[file.type]}`,
      { type: file.type, lastModified: timestamp },
    )));
  }

  function removeAttachment(localId: string) {
    setAttachments((current) => {
      const removed = current.find((attachment) => attachment.localId === localId);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((attachment) => attachment.localId !== localId);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (queuedPrompt && !draft.trim() && !attachments.length && onSendQueuedNow) {
        onSendQueuedNow();
        return;
      }
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <>
      {queuedPrompt && (
        <aside className="queued-question" aria-live="polite">
          <div className="queued-question-copy">
            <span aria-hidden="true"><EnterIcon /></span>
            <p>{queuedPrompt}</p>
          </div>
          <div className="queued-question-actions">
            {onSendQueuedNow && (
              <button
                className="queued-question-send-now"
                type="button"
                aria-label="지금 전송하기"
                title="지금 전송하기 · Enter"
                onClick={onSendQueuedNow}
              >
                <EnterIcon />
              </button>
            )}
            {onCancelQueued && (
              <button
                className="queued-question-cancel"
                type="button"
                aria-label="대기 중인 질문 취소"
                title="대기 질문 취소"
                onClick={onCancelQueued}
              >
                <CloseIcon />
              </button>
            )}
          </div>
        </aside>
      )}
      <form
        className="composer composer-with-attachments"
        data-expanded={isExpanded ? "true" : undefined}
        onSubmit={handleSubmit}
      >
        {attachments.length > 0 && (
          <div className="pending-attachments" aria-label="첨부할 파일">
            {attachments.map((attachment) => (
              <div className={`pending-attachment ${attachment.kind}`} key={attachment.localId}>
                {attachment.previewUrl ? (
                  // A temporary object URL is required to preview a local file before upload.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={attachment.previewUrl} alt="" />
                ) : (
                  <span className="attachment-file-icon"><PaperclipIcon /></span>
                )}
                {attachment.kind === "file" && (
                  <span title={attachment.file.name}>{attachment.file.name}</span>
                )}
                <button
                  type="button"
                  aria-label={`${attachment.file.name} 첨부 취소`}
                  onClick={() => removeAttachment(attachment.localId)}
                  disabled={disabled}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="composer-row">
        <div className="attachment-menu-wrap" ref={menuRef}>
          {menuOpen && (
            <div className="attachment-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => fileInputRef.current?.click()}>
                <span><PaperclipIcon /></span>
                <strong>파일 및 폴더</strong>
              </button>
            </div>
          )}
          <button
            className={`attachment-toggle ${menuOpen ? "active" : ""}`}
            type="button"
            aria-label="파일 또는 이미지 첨부"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            disabled={disabled}
          >
            <PlusIcon />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            hidden
            multiple
            accept=".txt,.md,.csv,.json,.pdf,.docx,image/jpeg,image/png,image/webp"
            onChange={addFiles}
          />
        </div>
        <textarea
          ref={textareaRef}
          aria-label="메시지"
          placeholder="STAR에게 메시지 보내기"
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={inputDisabled}
        />
        {!isGenerating && (
          <button
            className={`voice-toggle ${isDictating ? "recording" : ""}`}
            type="button"
            aria-label={isDictating ? "음성 전사 종료" : "음성으로 입력"}
            title={isDictating ? "음성 전사 종료" : "음성으로 입력"}
            onClick={toggleDictation}
            disabled={disabled || inputDisabled}
          >
            <MicrophoneIcon />
          </button>
        )}
        {isGenerating && (
          <div className="composer-generation-controls" aria-label="답변 생성 제어">
            <button
              className="composer-pause-toggle"
              type="button"
              aria-label={isPaused ? "답변 생성 재생" : "답변 생성 일시정지"}
              title={isPaused ? "계속 재생" : "일시정지"}
              onClick={onTogglePause}
              disabled={!onTogglePause}
            >
              {isPaused ? <PlayIcon /> : <PauseIcon />}
            </button>
            <button
              className="composer-stop-toggle"
              type="button"
              aria-label="답변 생성 완전 정지"
              title="완전 정지"
              onClick={onStopGeneration}
              disabled={!onStopGeneration}
            >
              <StopIcon />
            </button>
          </div>
        )}
        {!isGenerating && !draft.trim() && !attachments.length ? (
          <button
            className="voice-chat-toggle"
            type="button"
            aria-label="상호 음성 채팅 시작"
            title="상호 음성 채팅 시작"
            onClick={onVoiceOpen}
            disabled={disabled}
          >
            <VoiceChatIcon />
          </button>
        ) : (
          <button
            className="composer-submit"
            type="submit"
            aria-label={buttonLabel}
            title={buttonLabel}
            disabled={(disabled && !allowSubmitWhileDisabled) || (!draft.trim() && !attachments.length)}
          >
            <SendArrowUpIcon />
          </button>
        )}
        </div>
      </form>
    </>
  );
}
