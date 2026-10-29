"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, UIEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { ChatComposer } from "@/app/components/chat-composer";
import { ChatHomeLink } from "@/app/components/chat-home-link";
import { ChatIcon, ChatSidebar } from "@/app/components/chat-sidebar";
import { GenerationStatus, type GenerationDisplayState } from "@/app/components/generation-status";
import { MarkdownMessage } from "@/app/components/markdown-message";
import { ThreadFollowControl } from "@/app/components/thread-follow-control";
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

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function stablePauseContent(content: string) {
  if (!content || /\s$/.test(content) || /[.,!?;:)\]}\"'`…。，！？：；]$/.test(content)) return content;
  return content.replace(/[\p{L}\p{N}_-]+$/u, "");
}

export default function ChatDetailPage() {
  const router = useRouter();
  const handleThreadScroll = useTransientScrollbar<HTMLDivElement>();
  const { sessionId } = useParams<{ sessionId: string }>();
  const generationStartedFor = useRef<string | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const generationStopReasonRef = useRef<"pause" | "stop" | "send-now" | null>(null);
  const generationPausedRef = useRef(false);
  const generationPauseControlRef = useRef<((action: "resume" | "stop" | "send-now") => void) | null>(null);
  const generationStartedAtRef = useRef(0);
  const generationPausedAtRef = useRef<number | null>(null);
  const generationPausedDurationRef = useRef(0);
  const voiceRequestedRef = useRef(false);
  const threadViewportRef = useRef<HTMLDivElement>(null);
  const threadScrollIntentRef = useRef(false);
  const hasLeftFocusedTurnRef = useRef(false);
  const followStreamingRef = useRef(true);
  const scrollAnimationFrameRef = useRef<number | null>(null);
  const [session, setSession] = useState<ChatSessionDetail | null>(null);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGenerationPaused, setIsGenerationPaused] = useState(false);
  const [generationState, setGenerationState] = useState<GenerationDisplayState>("idle");
  const [generationDuration, setGenerationDuration] = useState<number | null>(null);
  const [queuedPrompt, setQueuedPrompt] = useState("");
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [isTurnFocused, setIsTurnFocused] = useState(false);
  const [isAwayFromBottom, setIsAwayFromBottom] = useState(false);
  const [error, setError] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceReply, setVoiceReply] = useState<{ id: string; text: string } | null>(null);
  const [selectedImage, setSelectedImage] = useState<{ src: string; alt: string } | null>(null);

  const generate = useCallback(async (inputMessage: ChatMessage): Promise<ChatMessage | null> => {
    if (generationStartedFor.current === inputMessage.id) return null;
    generationStartedFor.current = inputMessage.id;
    setError("");
    setIsTurnFocused(true);
    hasLeftFocusedTurnRef.current = false;
    setIsGenerating(true);
    generationPausedRef.current = false;
    generationStartedAtRef.current = performance.now();
    generationPausedAtRef.current = null;
    generationPausedDurationRef.current = 0;
    setGenerationState("thinking");
    setGenerationDuration(null);
    setIsGenerationPaused(false);
    const placeholderId = `stream-${inputMessage.id}`;
    const placeholder: ChatMessage = {
      id: placeholderId,
      user_id: inputMessage.user_id,
      session_id: inputMessage.session_id,
      role: "assistant",
      content: "",
      generation_duration_ms: null,
      created_at: new Date().toISOString(),
      attachments: [],
    };
    threadScrollIntentRef.current = false;
    followStreamingRef.current = true;
    setIsAwayFromBottom(false);
    setStreamingMessageId(placeholderId);
    setSession((current) => current ? {
      ...current,
      messages: [...current.messages, placeholder],
    } : current);
    const completion: { output: ChatMessage | null; sessionTitle: string | null } = {
      output: null,
      sessionTitle: null,
    };
    let visibleContent = "";
    let pauseResolver: ((action: "resume" | "stop" | "send-now") => void) | null = null;
    let pendingPauseAction: "resume" | "stop" | "send-now" | null = null;
    generationPauseControlRef.current = (action) => {
      if (pauseResolver) pauseResolver(action);
      else pendingPauseAction = action;
    };
    try {
      while (true) {
        const abortController = new AbortController();
        generationAbortRef.current = abortController;
        completion.output = null;
        let awaitingFirstDelta = true;
        try {
          await apiEventStream(
            `/chat/sessions/${sessionId}/generate/stream`,
            ({ event, data }) => {
              if (event === "delta") {
                const chunk = (data as { content?: unknown }).content;
                if (typeof chunk !== "string") return;
                if (awaitingFirstDelta) {
                  awaitingFirstDelta = false;
                  setGenerationState("streaming");
                }
                visibleContent += chunk;
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
                completion.sessionTitle = sessionTitle;
                if (sessionTitle) {
                  setSessions((current) => current.map((item) => item.id === sessionId
                    ? { ...item, title: sessionTitle, updated_at: output.created_at }
                    : item));
                }
              }
            },
            {
              method: "POST",
              signal: abortController.signal,
              body: visibleContent.trim()
                ? JSON.stringify({
                    resume_from: visibleContent.trimEnd(),
                    elapsed_ms: Math.max(0, Math.round(
                      performance.now()
                      - generationStartedAtRef.current
                      - generationPausedDurationRef.current,
                    )),
                  })
                : undefined,
            },
          );
          if (generationStopReasonRef.current) throw new DOMException("Aborted", "AbortError");
          const completedOutput = completion.output as ChatMessage | null;
          if (!completedOutput) throw new Error("답변 스트림이 완료되기 전에 종료됐습니다.");
          setSession((current) => current ? {
            ...current,
            title: completion.sessionTitle ?? current.title,
            messages: current.messages.map((message) => message.id === placeholderId
              ? completedOutput
              : message),
            updated_at: completedOutput.created_at,
          } : current);
          setGenerationDuration(completedOutput.generation_duration_ms ?? Math.max(
            0,
            performance.now() - generationStartedAtRef.current - generationPausedDurationRef.current,
          ));
          setGenerationState("complete");
          break;
        } catch (requestError) {
          if (isAbortError(requestError) && generationStopReasonRef.current === "pause") {
            const stableContent = stablePauseContent(visibleContent);
            if (stableContent !== visibleContent) {
              visibleContent = stableContent;
              setSession((current) => current ? {
                ...current,
                messages: current.messages.map((message) => message.id === placeholderId
                  ? { ...message, content: stableContent }
                  : message),
              } : current);
            }
            const action = pendingPauseAction ?? await new Promise<"resume" | "stop" | "send-now">((resolve) => {
              pauseResolver = resolve;
            });
            pauseResolver = null;
            pendingPauseAction = null;
            if (action === "resume") {
              if (generationPausedAtRef.current !== null) {
                generationPausedDurationRef.current += performance.now() - generationPausedAtRef.current;
                generationPausedAtRef.current = null;
              }
              generationStopReasonRef.current = null;
              generationPausedRef.current = false;
              setIsGenerationPaused(false);
              setGenerationState("thinking");
              continue;
            }
            generationStopReasonRef.current = action;
          }
          generationStartedFor.current = null;
          const wasStopped = isAbortError(requestError) && generationStopReasonRef.current !== null;
          const stoppedDuration = Math.max(
            0,
            Math.round(
              performance.now()
              - generationStartedAtRef.current
              - generationPausedDurationRef.current,
            ),
          );
          if (isAbortError(requestError)) {
            setGenerationDuration(stoppedDuration);
            setGenerationState(generationStopReasonRef.current === "stop" ? "stopped" : "idle");
          } else {
            setGenerationState("idle");
          }
          if (
            wasStopped
            && (generationStopReasonRef.current === "stop" || generationStopReasonRef.current === "send-now")
            && visibleContent.trim()
          ) {
            try {
              const interrupted = await apiRequest<ChatMessage>(
                `/chat/sessions/${sessionId}/messages/interrupted`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    output: visibleContent.trim(),
                    generation_duration_ms: stoppedDuration,
                  }),
                },
              );
              completion.output = interrupted;
              setSession((current) => current ? {
                ...current,
                messages: current.messages.map((message) => message.id === placeholderId
                  ? interrupted
                  : message),
                updated_at: interrupted.created_at,
              } : current);
            } catch (persistError) {
              setSession((current) => current ? {
                ...current,
                messages: current.messages.filter((message) => message.id !== placeholderId),
              } : current);
              setError(persistError instanceof Error
                ? persistError.message
                : "중단된 답변을 저장하지 못했습니다.");
            }
          } else {
            setSession((current) => current ? {
              ...current,
              messages: current.messages.filter((message) => message.id !== placeholderId),
            } : current);
          }
          if (!isAbortError(requestError)) {
            setError(requestError instanceof Error ? requestError.message : "답변을 생성하지 못했습니다.");
          }
          break;
        }
      }
    } finally {
      generationAbortRef.current = null;
      generationPauseControlRef.current = null;
      generationStopReasonRef.current = null;
      generationPausedRef.current = false;
      generationPausedAtRef.current = null;
      setIsGenerationPaused(false);
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

  useLayoutEffect(() => {
    if (!streamingMessageId) return;
    threadScrollIntentRef.current = false;
    followStreamingRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      const viewport = threadViewportRef.current;
      if (!viewport) return;
      viewport.scrollTo({
        top: Math.max(0, viewport.scrollHeight - viewport.clientHeight),
        behavior: "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [streamingMessageId]);

  useEffect(() => {
    if (!streamingMessageId || isAwayFromBottom || !followStreamingRef.current) return;
    if (scrollAnimationFrameRef.current !== null) return;
    let cancelled = false;
    const followBottom = () => {
      scrollAnimationFrameRef.current = null;
      if (cancelled || !followStreamingRef.current) return;
      const viewport = threadViewportRef.current;
      if (!viewport) return;
      const target = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const distance = target - viewport.scrollTop;
      if (Math.abs(distance) <= 0.5) {
        viewport.scrollTo({ top: target, behavior: "instant" });
      } else {
        viewport.scrollTo({ top: viewport.scrollTop + distance * 0.2, behavior: "instant" });
      }
      scrollAnimationFrameRef.current = window.requestAnimationFrame(followBottom);
    };
    scrollAnimationFrameRef.current = window.requestAnimationFrame(followBottom);
    return () => {
      cancelled = true;
      if (scrollAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollAnimationFrameRef.current);
        scrollAnimationFrameRef.current = null;
      }
    };
  }, [isAwayFromBottom, streamingMessageId]);

  useEffect(() => () => {
    if (scrollAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollAnimationFrameRef.current);
    }
  }, []);

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
    if (rawContent === draft) setDraft("");
    if (pending.length) setAttachments([]);
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
      setSession((current) => current ? {
        ...current,
        messages: [...current.messages, createdInput],
      } : current);
      return await generate(createdInput);
    } catch (requestError) {
      if (!input && uploaded.length) await deleteUploadedAttachments(uploaded);
      setDraft((current) => current || rawContent);
      if (!input && pending.length) setAttachments((current) => current.length ? current : pending);
      setError(requestError instanceof Error ? requestError.message : "메시지를 보내지 못했습니다.");
      return null;
    } finally {
      setIsSending(false);
    }
  }, [draft, generate, isGenerating, isSending, session, sessionId]);

  useEffect(() => {
    if (!queuedPrompt || isGenerating || isSending || !session) return;
    const nextPrompt = queuedPrompt;
    setQueuedPrompt("");
    void sendMessage(nextPrompt);
  }, [isGenerating, isSending, queuedPrompt, sendMessage, session]);

  useEffect(() => () => generationAbortRef.current?.abort(), []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isGenerating || isSending) {
      const content = draft.trim();
      if (!content) return;
      setQueuedPrompt((current) => current ? `${current}\n\n${content}` : content);
      setDraft("");
      return;
    }
    void sendMessage(draft, attachments);
  }

  function handleVisibleThreadScroll(event: UIEvent<HTMLDivElement>) {
    const hadUserIntent = threadScrollIntentRef.current;
    threadScrollIntentRef.current = false;
    const viewport = event.currentTarget;
    const distanceFromBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;

    if (distanceFromBottom <= 32) {
      followStreamingRef.current = true;
      setIsAwayFromBottom(false);
      if (hasLeftFocusedTurnRef.current) {
        hasLeftFocusedTurnRef.current = false;
        setIsTurnFocused(false);
      }
      if (hadUserIntent) handleThreadScroll(event);
      return;
    }

    if (!hadUserIntent) return;
    hasLeftFocusedTurnRef.current = true;
    followStreamingRef.current = false;
    setIsAwayFromBottom(true);
    handleThreadScroll(event);
  }

  function markThreadScrollIntent() {
    threadScrollIntentRef.current = true;
    if (scrollAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollAnimationFrameRef.current);
      scrollAnimationFrameRef.current = null;
    }
  }

  function scrollToThreadBottom() {
    const viewport = threadViewportRef.current;
    if (!viewport) return;
    if (scrollAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollAnimationFrameRef.current);
      scrollAnimationFrameRef.current = null;
    }
    followStreamingRef.current = true;
    hasLeftFocusedTurnRef.current = false;
    setIsTurnFocused(false);
    setIsAwayFromBottom(false);
    viewport.scrollTo({
      top: Math.max(0, viewport.scrollHeight - viewport.clientHeight),
      behavior: "smooth",
    });
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
          <div className="chat-header-context"><ChatIcon /><strong>{session?.title ?? "대화 불러오는 중"}</strong></div>
          <ChatHomeLink />
        </header>
        <div className="chat-thread-shell">
          <div
            className="chat-scroll-viewport"
            ref={threadViewportRef}
            onScroll={handleVisibleThreadScroll}
            onWheel={markThreadScrollIntent}
            onTouchMove={markThreadScrollIntent}
          >
          <div className={`chat-thread ${session?.messages.length ? "conversation-thread" : ""} ${session?.messages.length && isTurnFocused ? "is-turn-focused" : ""}`}>
            {session?.messages.map((message) => (
            <div className={`message-row ${message.role} ${message.id === streamingMessageId ? "pending-message" : ""}`} key={message.id}>
              {message.role === "assistant" && <Image src="/star-mark-black.png" alt="STAR" width={34} height={34} />}
              <div className="message-bubble">
                {message.role === "assistant" && <strong className="star-wordmark star-agent-name">STAR</strong>}
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
                  <>
                    {message.content && <MarkdownMessage content={message.content} />}
                    <GenerationStatus
                      state={message.id === streamingMessageId ? generationState : "complete"}
                      durationMs={message.id === streamingMessageId
                        ? generationDuration
                        : message.generation_duration_ms ?? null}
                    />
                  </>
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
          </div>
          <div className="thread-scrollbar" aria-hidden="true"><span /></div>
          <ThreadFollowControl
            visible={isAwayFromBottom}
            generating={Boolean(streamingMessageId)}
            onClick={scrollToThreadBottom}
          />
        </div>
        <div className="composer-wrap">
          <ChatComposer
            draft={draft}
            setDraft={setDraft}
            attachments={attachments}
            setAttachments={setAttachments}
            disabled={isGenerating || isSending}
            inputDisabled={false}
            allowSubmitWhileDisabled={isGenerating || isSending}
            isGenerating={isGenerating}
            isPaused={isGenerationPaused}
            buttonLabel={isGenerating || isSending ? "대기열에 추가" : "보내기"}
            queuedPrompt={queuedPrompt}
            onSendQueuedNow={() => {
              if (generationPausedRef.current) {
                generationPauseControlRef.current?.("send-now");
              } else {
                generationStopReasonRef.current = "send-now";
                generationAbortRef.current?.abort();
              }
            }}
            onCancelQueued={() => setQueuedPrompt("")}
            onTogglePause={() => {
              if (generationPausedRef.current) {
                generationPauseControlRef.current?.("resume");
              } else {
                generationStopReasonRef.current = "pause";
                generationPausedRef.current = true;
                generationPausedAtRef.current = performance.now();
                setIsGenerationPaused(true);
                setGenerationState("paused");
                generationAbortRef.current?.abort();
              }
            }}
            onStopGeneration={() => {
              setQueuedPrompt("");
              if (generationPausedRef.current) {
                generationPauseControlRef.current?.("stop");
              } else {
                generationStopReasonRef.current = "stop";
                generationAbortRef.current?.abort();
              }
            }}
            onSubmit={handleSubmit}
            onError={setError}
            onVoiceOpen={() => {
              setVoiceReply(null);
              setVoiceOpen(true);
            }}
          />
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
