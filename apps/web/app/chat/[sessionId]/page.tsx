"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { ChatComposer } from "@/app/components/chat-composer";
import { ChatSidebar } from "@/app/components/chat-sidebar";
import { MarkdownMessage } from "@/app/components/markdown-message";
import { useTransientScrollbar } from "@/app/components/use-transient-scrollbar";
import { VoiceMode } from "@/app/components/voice-mode";
import { apiCachedRequest, apiEventStream, apiRequest, invalidateApiCache, primeApiCache } from "@/lib/api";
import {
  deleteUploadedAttachments,
  releaseAttachmentPreviews,
  uploadPendingAttachments,
} from "@/lib/attachments";
import type {
  AuthUser,
  ChatAttachment,
  ChatProject,
  ChatMessage,
  ChatSessionDetail,
  ChatSessionSummary,
  PendingAttachment,
} from "@/lib/chat";

export default function ChatDetailPage() {
  const router = useRouter();
  const handleThreadScroll = useTransientScrollbar<HTMLDivElement>();
  const { sessionId } = useParams<{ sessionId: string }>();
  const generationStartedFor = useRef<string | null>(null);
  const voiceRequestedRef = useRef(false);
  const [session, setSession] = useState<ChatSessionDetail | null>(null);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceReply, setVoiceReply] = useState<{ id: string; text: string } | null>(null);
  const [selectedImage, setSelectedImage] = useState<{ src: string; alt: string } | null>(null);

  const generate = useCallback(async (inputMessage: ChatMessage): Promise<ChatMessage | null> => {
    if (generationStartedFor.current === inputMessage.id) return null;
    generationStartedFor.current = inputMessage.id;
    setError("");
    setIsGenerating(true);
    const placeholderId = `stream-${inputMessage.id}`;
    const placeholder: ChatMessage = {
      id: placeholderId,
      user_id: inputMessage.user_id,
      session_id: inputMessage.session_id,
      role: "assistant",
      content: "",
      created_at: new Date().toISOString(),
      attachments: [],
    };
    setStreamingMessageId(placeholderId);
    setSession((current) => current ? {
      ...current,
      messages: [...current.messages, placeholder],
    } : current);
    const completion: { output: ChatMessage | null } = { output: null };
    try {
      await apiEventStream(
        `/chat/sessions/${sessionId}/generate/stream`,
        ({ event, data }) => {
          if (event === "delta") {
            const chunk = (data as { content?: unknown }).content;
            if (typeof chunk !== "string") return;
            setSession((current) => current ? {
              ...current,
              messages: current.messages.map((message) => message.id === placeholderId
                ? { ...message, content: message.content + chunk }
                : message),
            } : current);
            return;
          }
          if (event === "error") {
            const detail = (data as { detail?: unknown }).detail;
            throw new Error(typeof detail === "string" ? detail : "답변 스트리밍에 실패했습니다.");
          }
          if (event === "complete") {
            const completeData = data as { output?: ChatMessage; session_title?: unknown };
            const output = completeData.output;
            if (!output) throw new Error("완료된 답변을 받지 못했습니다.");
            const sessionTitle = typeof completeData.session_title === "string"
              ? completeData.session_title
              : null;
            completion.output = output;
            setSession((current) => current ? {
              ...current,
              title: sessionTitle ?? current.title,
              messages: current.messages.map((message) => message.id === placeholderId ? output : message),
              updated_at: output.created_at,
            } : current);
            if (sessionTitle) {
              setSessions((current) => current.map((item) => item.id === sessionId
                ? { ...item, title: sessionTitle, updated_at: output.created_at }
                : item));
            }
          }
        },
        { method: "POST" },
      );
      if (!completion.output) throw new Error("답변 스트림이 완료되기 전에 종료됐습니다.");
    } catch (requestError) {
      generationStartedFor.current = null;
      setSession((current) => current ? {
        ...current,
        messages: current.messages.filter((message) => message.id !== placeholderId),
      } : current);
      setError(requestError instanceof Error ? requestError.message : "답변을 생성하지 못했습니다.");
    } finally {
      setStreamingMessageId(null);
      setIsGenerating(false);
    }
    return completion.output;
  }, [sessionId]);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("voice") === "1";
    voiceRequestedRef.current = requested;
    const timer = window.setTimeout(() => setVoiceOpen(requested), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    Promise.all([
      apiCachedRequest<AuthUser>("/auth/me"),
      apiCachedRequest<ChatSessionSummary[]>("/chat/sessions"),
      apiCachedRequest<ChatProject[]>("/chat/projects"),
    ])
      .then(([currentUser, recentSessions, currentProjects]) => {
        setUser(currentUser);
        setSessions(recentSessions);
        setProjects(currentProjects);
      })
      .catch((requestError) => {
        const message = requestError instanceof Error ? requestError.message : "대화를 불러오지 못했습니다.";
        if (message.includes("로그인") || message.includes("세션")) {
          router.replace(`/signin?next=${encodeURIComponent(`/chat/${sessionId}`)}`);
          return;
        }
        setError(message);
      });

    apiCachedRequest<ChatSessionDetail>(`/chat/sessions/${sessionId}`)
      .then((currentSession) => {
        setSession(currentSession);
        const lastMessage = currentSession.messages.at(-1);
        if (lastMessage?.role === "user") {
          void generate(lastMessage).then((output) => {
            if (voiceRequestedRef.current && output) {
              setVoiceReply({ id: output.id, text: output.content });
            }
          });
        }
      })
      .catch((requestError) => {
        const message = requestError instanceof Error ? requestError.message : "대화를 불러오지 못했습니다.";
        if (message.includes("로그인") || message.includes("세션")) {
          router.replace(`/signin?next=${encodeURIComponent(`/chat/${sessionId}`)}`);
          return;
        }
        setError(message);
      });
  }, [generate, router, sessionId]);

  useEffect(() => {
    if (session) primeApiCache(`/chat/sessions/${sessionId}`, session);
  }, [session, sessionId]);

  useEffect(() => {
    if (!selectedImage) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setSelectedImage(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedImage]);

  const sendMessage = useCallback(async (
    rawContent: string,
    pending: PendingAttachment[] = [],
  ): Promise<ChatMessage | null> => {
    const content = rawContent.trim();
    if ((!content && !pending.length) || isGenerating || isSending || !session) return null;
    setError("");
    setIsSending(true);
    let uploaded: ChatAttachment[] = [];
    let input: ChatMessage | null = null;
    try {
      uploaded = await uploadPendingAttachments(pending);
      const createdInput = await apiRequest<ChatMessage>(`/chat/sessions/${sessionId}/messages`, {
        method: "POST",
        body: JSON.stringify({ input: content, attachment_ids: uploaded.map((item) => item.id) }),
      });
      input = createdInput;
      releaseAttachmentPreviews(pending);
      if (pending.length) setAttachments([]);
      if (rawContent === draft) setDraft("");
      setSession((current) => current ? {
        ...current,
        messages: [...current.messages, createdInput],
      } : current);
      return await generate(createdInput);
    } catch (requestError) {
      if (!input && uploaded.length) await deleteUploadedAttachments(uploaded);
      setError(requestError instanceof Error ? requestError.message : "메시지를 보내지 못했습니다.");
      return null;
    } finally {
      setIsSending(false);
    }
  }, [draft, generate, isGenerating, isSending, session, sessionId]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft, attachments);
  }

  async function handleLogout() {
    await apiRequest<void>("/auth/logout", { method: "POST" });
    invalidateApiCache();
    router.replace("/signin");
  }

  const lastMessage = session?.messages.at(-1);

  return (
    <main className="chat-page">
      <ChatSidebar
        user={user}
        sessions={sessions}
        projects={projects}
        activeSessionId={sessionId}
        selectedProjectId={session?.project_id}
        onSessionsChange={setSessions}
        onProjectsChange={setProjects}
        onLogout={handleLogout}
        onError={setError}
      />

      <section className="chat-workspace">
        <header className="chat-header">
          <div><strong>{session?.title ?? "대화 불러오는 중"}</strong><span><i /> STAR</span></div>
          <Link href="/">홈으로</Link>
        </header>
        <div className="chat-thread-shell">
          <div className="chat-thread" onScroll={handleThreadScroll}>
            {session?.messages.map((message) => (
            <div className={`message-row ${message.role} ${message.id === streamingMessageId ? "pending-message" : ""}`} key={message.id}>
              {message.role === "assistant" && <Image src="/star-mark-black.png" alt="STAR" width={34} height={34} />}
              <div className="message-bubble">
                {message.role === "assistant" && <strong>STAR</strong>}
                {message.attachments.length > 0 && (
                  <div className="message-attachments">
                    {message.attachments.map((attachment) => attachment.kind === "image" ? (
                      <button
                        className="message-image"
                        type="button"
                        aria-label={`${attachment.original_filename} 크게 보기`}
                        onClick={() => setSelectedImage({
                          src: attachment.content_url,
                          alt: attachment.original_filename,
                        })}
                        key={attachment.id}
                      >
                        {/* Authenticated dynamic images cannot use Next's build-time image loader. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={attachment.content_url} alt={attachment.original_filename} />
                      </button>
                    ) : (
                      <a className="message-file" href={attachment.content_url} key={attachment.id}>
                        <span aria-hidden="true">↗</span>
                        <span><strong>{attachment.original_filename}</strong><small>{formatFileSize(attachment.size_bytes)}</small></span>
                      </a>
                    ))}
                  </div>
                )}
                {message.role === "assistant" ? (
                  <MarkdownMessage content={message.content} isStreaming={message.id === streamingMessageId} />
                ) : (
                  <p>{message.content}</p>
                )}
              </div>
            </div>
            ))}
            {error && (
              <div className="chat-generation-error" role="alert">
                <p>{error}</p>
                {lastMessage?.role === "user" && !isGenerating && (
                  <button type="button" onClick={() => void generate(lastMessage)}>답변 다시 생성</button>
                )}
              </div>
            )}
          </div>
          <div className="thread-scrollbar" aria-hidden="true"><span /></div>
        </div>
        <div className="composer-wrap">
          <ChatComposer
            draft={draft}
            setDraft={setDraft}
            attachments={attachments}
            setAttachments={setAttachments}
            disabled={isGenerating || isSending}
            buttonLabel={isSending ? "업로드 중" : isGenerating ? "생성 중" : "보내기"}
            onSubmit={handleSubmit}
            onError={setError}
            onVoiceOpen={() => {
              setVoiceReply(null);
              setVoiceOpen(true);
            }}
          />
          <p>관련 대화 3턴을 참고하며 답변을 실시간으로 표시합니다.</p>
        </div>
      </section>
      {selectedImage && (
        <div
          className="image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="첨부 이미지 크게 보기"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedImage(null);
          }}
        >
          <button
            className="image-lightbox-close"
            type="button"
            aria-label="이미지 닫기"
            onClick={() => setSelectedImage(null)}
          >
            ×
          </button>
          {/* Authenticated dynamic images cannot use Next's build-time image loader. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={selectedImage.src} alt={selectedImage.alt} />
        </div>
      )}
      <VoiceMode
        open={voiceOpen}
        ready={Boolean(session)}
        waiting={isGenerating || isSending}
        reply={voiceReply}
        onClose={() => {
          voiceRequestedRef.current = false;
          setVoiceOpen(false);
          window.history.replaceState(null, "", `/chat/${sessionId}`);
        }}
        onTranscript={async (text) => {
          const output = await sendMessage(text);
          return output?.content ?? null;
        }}
        onError={setError}
      />
    </main>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
