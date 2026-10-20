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
  buttonLabel: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onError: (message: string) => void;
  onVoiceOpen: () => void;
};

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

export function ChatComposer({
  draft,
  setDraft,
  attachments,
  setAttachments,
  disabled,
  buttonLabel,
  onSubmit,
  onError,
  onVoiceOpen,
}: ChatComposerProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
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
            +
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
          disabled={disabled}
        />
        <button
          className="voice-toggle"
          type="button"
          aria-label="음성 대화 시작"
          title="음성 대화 시작"
          onClick={onVoiceOpen}
          disabled={disabled}
        >
          <MicrophoneIcon />
        </button>
        <button
          className="composer-submit"
          type="submit"
          disabled={disabled || (!draft.trim() && !attachments.length)}
        >
          {buttonLabel}
        </button>
      </div>
    </form>
  );
}
