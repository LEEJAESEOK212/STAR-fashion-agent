"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CSSProperties, FormEvent, KeyboardEvent, Suspense, UIEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { ChatComposer } from "@/app/components/chat-composer";
import { ChatHomeLink } from "@/app/components/chat-home-link";
import { ChatIcon, ChatSidebar, FolderIcon } from "@/app/components/chat-sidebar";
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
  ChatMessage,
  ChatProject,
  ChatSessionDetail,
  ChatSessionSummary,
  PendingAttachment,
} from "@/lib/chat";

type ChatAuthState = "checking" | "authenticated" | "anonymous";

const GUEST_CHAT_STORAGE_KEY = "star-guest-chat";
const GUEST_CHAT_MAX_TURNS = 3;

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function stablePauseContent(content: string) {
  if (!content || /\s$/.test(content) || /[.,!?;:)\]}\"'`…。，！？：；]$/.test(content)) return content;
  return content.replace(/[\p{L}\p{N}_-]+$/u, "");
}

function guestStoredMessages(): ChatMessage[] {
  try {
    const raw = window.sessionStorage.getItem(GUEST_CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const messages = parsed.filter((message): message is ChatMessage => Boolean(
      message
      && typeof message === "object"
      && "id" in message
      && "role" in message
      && "content" in message
      && typeof message.id === "string"
      && (message.role === "user" || message.role === "assistant")
      && typeof message.content === "string",
    )).map((message) => ({ ...message, attachments: [] }));
    return messages.map((message, index) => {
      if (message.role !== "assistant" || message.generation_duration_ms != null) return message;
      const previous = messages[index - 1];
      const estimated = previous?.role === "user"
        ? Date.parse(message.created_at) - Date.parse(previous.created_at)
        : Number.NaN;
      return {
        ...message,
        generation_duration_ms: Number.isFinite(estimated) ? Math.max(1000, estimated) : 1000,
      };
    });
  } catch {
    return [];
  }
}

function persistGuestMessages(messages: ChatMessage[]) {
  const serializable = messages
    .filter((message) => !message.id.startsWith("guest-stream-"))
    .map((message) => ({ ...message, attachments: [] }));
  window.sessionStorage.setItem(GUEST_CHAT_STORAGE_KEY, JSON.stringify(serializable));
}

export default function NewChatPage() {
  return (
    <Suspense fallback={null}>
      <NewChatContent />
    </Suspense>
  );
}

function sortProjectItems(projects: ChatProject[]) {
  return [...projects].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    return Date.parse(b.updated_at) - Date.parse(a.updated_at);
  });
}

function sortSessionItems(sessions: ChatSessionSummary[]) {
  return [...sessions].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    return Date.parse(b.updated_at) - Date.parse(a.updated_at);
  });
}

function EditIcon() {
  return (
    <svg className="project-edit-icon" aria-hidden="true" viewBox="0 0 20 20">
      <path d="M4.5 14.6v1.9h1.9l8.1-8.1-1.9-1.9-8.1 8.1Z" />
      <path d="m11.8 7.3 1.8 1.8" />
      <path d="M10.5 4.5H5.7a2.2 2.2 0 0 0-2.2 2.2v7.6a2.2 2.2 0 0 0 2.2 2.2h7.6a2.2 2.2 0 0 0 2.2-2.2V9.5" />
    </svg>
  );
}

function NewChatContent() {
  const router = useRouter();
  const handleThreadScroll = useTransientScrollbar<HTMLDivElement>();
  const searchParams = useSearchParams();
  const incomingPrompt = searchParams.get("prompt")?.trim() ?? "";
  const selectedProjectId = searchParams.get("project");
  const autoStarted = useRef(false);
  const guestAbortRef = useRef<AbortController | null>(null);
  const guestStopReasonRef = useRef<"pause" | "stop" | "send-now" | null>(null);
  const guestPausedRef = useRef(false);
  const guestPauseControlRef = useRef<((action: "resume" | "stop" | "send-now") => void) | null>(null);
  const guestGenerationStartedAtRef = useRef(0);
  const guestPausedAtRef = useRef<number | null>(null);
  const guestPausedDurationRef = useRef(0);
  const threadViewportRef = useRef<HTMLDivElement>(null);
  const threadScrollIntentRef = useRef(false);
  const hasLeftFocusedTurnRef = useRef(false);
  const followStreamingRef = useRef(true);
  const scrollAnimationFrameRef = useRef<number | null>(null);
  const [draft, setDraft] = useState(incomingPrompt);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authState, setAuthState] = useState<ChatAuthState>("checking");
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [guestMessages, setGuestMessages] = useState<ChatMessage[]>([]);
  const [guestStreamingMessageId, setGuestStreamingMessageId] = useState<string | null>(null);
  const [isTurnFocused, setIsTurnFocused] = useState(false);
  const [isAwayFromBottom, setIsAwayFromBottom] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGuestPaused, setIsGuestPaused] = useState(false);
  const [guestGenerationState, setGuestGenerationState] = useState<GenerationDisplayState>("idle");
  const [guestGenerationDuration, setGuestGenerationDuration] = useState<number | null>(null);
  const [queuedPrompt, setQueuedPrompt] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [error, setError] = useState("");
  const [expandedChildrenFor, setExpandedChildrenFor] = useState<string | null>(null);
  const [expandedSessionsFor, setExpandedSessionsFor] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [isRenamingProject, setIsRenamingProject] = useState(false);
  const projectNameEditorRef = useRef<HTMLElement>(null);
  const editingProjectNameRef = useRef("");

  useLayoutEffect(() => {
    if (!editingProjectId) return;
    const editor = projectNameEditorRef.current;
    if (!editor) return;
    const focusAtEnd = () => {
      editor.focus({ preventScroll: true });
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    };
    focusAtEnd();
    const frame = window.requestAnimationFrame(focusAtEnd);
    return () => window.cancelAnimationFrame(frame);
  }, [editingProjectId]);

  const guestUserTurns = guestMessages.filter((message) => message.role === "user").length;
  const guestCompletedTurns = guestMessages.filter((message) => (
    message.role === "assistant" && !message.id.startsWith("guest-stream-")
  )).length;
  const guestLimitReached = authState === "anonymous" && guestCompletedTurns >= GUEST_CHAT_MAX_TURNS;

  function warmSession(sessionId: string) {
    router.prefetch(`/chat/${sessionId}`);
    void apiCachedRequest<ChatSessionDetail>(`/chat/sessions/${sessionId}`).catch(() => undefined);
  }

  useEffect(() => {
    let active = true;
    setGuestMessages(guestStoredMessages());
    apiCachedRequest<AuthUser>("/auth/me")
      .then(async (currentUser) => {
        const [recentSessions, currentProjects] = await Promise.all([
          apiCachedRequest<ChatSessionSummary[]>("/chat/sessions"),
          apiCachedRequest<ChatProject[]>("/chat/projects"),
        ]);
        if (!active) return;
        setUser(currentUser);
        setSessions(recentSessions);
        setProjects(currentProjects);
        setAuthState("authenticated");
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setSessions([]);
        setProjects([]);
        setAuthState("anonymous");
      });
    return () => {
      active = false;
    };
  }, []);

  const sendGuestMessage = useCallback(async (
    rawInput: string,
    pending: PendingAttachment[] = [],
  ): Promise<ChatMessage | null> => {
    const content = rawInput.trim();
    if ((!content && !pending.length) || isSubmitting) return null;
    if (guestUserTurns >= GUEST_CHAT_MAX_TURNS) {
      setError("비로그인 체험은 3번까지 가능합니다. 로그인 후 계속해 주세요.");
      return null;
    }

    setError("");
    setIsTurnFocused(true);
    hasLeftFocusedTurnRef.current = false;
    setIsSubmitting(true);
    guestPausedRef.current = false;
    guestGenerationStartedAtRef.current = performance.now();
    guestPausedAtRef.current = null;
    guestPausedDurationRef.current = 0;
    setGuestGenerationState("thinking");
    setGuestGenerationDuration(null);
    setIsGuestPaused(false);
    if (rawInput === draft) setDraft("");
    if (pending.length) setAttachments([]);
    const now = new Date().toISOString();
    const inputId = `guest-user-${crypto.randomUUID()}`;
    const placeholderId = `guest-stream-${crypto.randomUUID()}`;
    const localAttachments: ChatAttachment[] = pending.map((attachment) => ({
      id: `guest-attachment-${attachment.localId}`,
      kind: attachment.kind,
      original_filename: attachment.file.name,
      content_type: attachment.file.type,
      size_bytes: attachment.file.size,
      created_at: now,
      content_url: attachment.previewUrl ?? "",
    }));
    const inputMessage: ChatMessage = {
      id: inputId,
      user_id: "guest",
      session_id: "guest-session",
      role: "user",
      content,
      created_at: now,
      attachments: localAttachments,
    };
    const placeholder: ChatMessage = {
      id: placeholderId,
      user_id: "guest",
      session_id: "guest-session",
      role: "assistant",
      content: "",
      generation_duration_ms: null,
      created_at: now,
      attachments: [],
    };
    const priorMessages = guestMessages.filter((message) => message.id !== guestStreamingMessageId);
    const requestMessages = [...priorMessages, inputMessage];
    threadScrollIntentRef.current = false;
    followStreamingRef.current = true;
    setIsAwayFromBottom(false);
    setGuestStreamingMessageId(placeholderId);
    setGuestMessages([...requestMessages, placeholder]);

    let visibleContent = "";
    let generatedOutput: ChatMessage | null = null;
    let pauseResolver: ((action: "resume" | "stop" | "send-now") => void) | null = null;
    let pendingPauseAction: "resume" | "stop" | "send-now" | null = null;
    guestPauseControlRef.current = (action) => {
      if (pauseResolver) pauseResolver(action);
      else pendingPauseAction = action;
    };
    try {
      while (true) {
        const form = new FormData();
        form.set("messages_json", JSON.stringify(requestMessages.map(({ role, content: messageContent, is_interrupted }) => ({
          role,
          content: messageContent,
          is_interrupted: Boolean(is_interrupted),
        }))));
        form.set("kinds_json", JSON.stringify(pending.map((attachment) => attachment.kind)));
        if (visibleContent.trim()) form.set("resume_from", visibleContent.trimEnd());
        pending.forEach((attachment) => form.append("files", attachment.file, attachment.file.name));
        const abortController = new AbortController();
        guestAbortRef.current = abortController;
        const completion: { output: ChatMessage | null } = { output: null };
        let awaitingFirstDelta = true;
        try {
          await apiEventStream(
            "/chat/guest/generate/stream",
            ({ event, data }) => {
              if (event === "delta") {
                const chunk = (data as { content?: unknown }).content;
                if (typeof chunk !== "string") return;
                if (awaitingFirstDelta) {
                  awaitingFirstDelta = false;
                  setGuestGenerationState("streaming");
                }
                visibleContent += chunk;
                setGuestMessages((current) => current.map((message) => message.id === placeholderId
                  ? { ...message, content: message.content + chunk }
                  : message));
                return;
              }
              if (event === "error") {
                const detail = (data as { detail?: unknown }).detail;
                throw new Error(typeof detail === "string" ? detail : "답변 생성에 실패했습니다.");
              }
              if (event === "complete") {
                const output = (data as { output?: ChatMessage }).output;
                if (!output) throw new Error("완료된 답변을 받지 못했습니다.");
                completion.output = output;
              }
            },
            { method: "POST", body: form, signal: abortController.signal },
          );
          if (guestStopReasonRef.current) throw new DOMException("Aborted", "AbortError");
          const completedOutput = completion.output as ChatMessage | null;
          if (!completedOutput) throw new Error("답변 스트림이 완료되기 전에 종료됐습니다.");
          const completedDuration = Math.max(
            0,
            Math.round(
              performance.now()
              - guestGenerationStartedAtRef.current
              - guestPausedDurationRef.current,
            ),
          );
          const timedOutput = {
            ...completedOutput,
            generation_duration_ms: completedOutput.generation_duration_ms ?? completedDuration,
          };
          generatedOutput = timedOutput;
          setGuestMessages((current) => {
            const completed = current.map((message) => message.id === placeholderId
              ? timedOutput
              : message);
            persistGuestMessages(completed);
            return completed;
          });
          setGuestGenerationDuration(timedOutput.generation_duration_ms);
          setGuestGenerationState("complete");
          break;
        } catch (requestError) {
          if (isAbortError(requestError) && guestStopReasonRef.current === "pause") {
            const stableContent = stablePauseContent(visibleContent);
            if (stableContent !== visibleContent) {
              visibleContent = stableContent;
              setGuestMessages((current) => current.map((message) => message.id === placeholderId
                ? { ...message, content: stableContent }
                : message));
            }
            const action = pendingPauseAction ?? await new Promise<"resume" | "stop" | "send-now">((resolve) => {
              pauseResolver = resolve;
            });
            pauseResolver = null;
            pendingPauseAction = null;
            if (action === "resume") {
              if (guestPausedAtRef.current !== null) {
                guestPausedDurationRef.current += performance.now() - guestPausedAtRef.current;
                guestPausedAtRef.current = null;
              }
              guestStopReasonRef.current = null;
              guestPausedRef.current = false;
              setIsGuestPaused(false);
              setGuestGenerationState("thinking");
              continue;
            }
            guestStopReasonRef.current = action;
          }
          if (isAbortError(requestError)) {
            const stoppedDuration = Math.max(
              0,
              Math.round(
                performance.now()
                - guestGenerationStartedAtRef.current
                - guestPausedDurationRef.current,
              ),
            );
            setGuestGenerationDuration(stoppedDuration);
            setGuestGenerationState(guestStopReasonRef.current === "stop" ? "stopped" : "idle");
            const interrupted = visibleContent.trim()
              && (guestStopReasonRef.current === "stop" || guestStopReasonRef.current === "send-now")
              ? {
                  ...placeholder,
                  id: `guest-interrupted-${crypto.randomUUID()}`,
                  content: visibleContent.trim(),
                  is_interrupted: true,
                  generation_duration_ms: stoppedDuration,
                }
              : null;
            generatedOutput = interrupted;
            setGuestMessages((current) => {
              const retained = current.flatMap((message) => message.id === placeholderId
                ? interrupted ? [interrupted] : []
                : [message]);
              persistGuestMessages(retained);
              return retained;
            });
          } else {
            setGuestGenerationState("idle");
            setGuestMessages((current) => current.filter((message) => message.id !== inputId && message.id !== placeholderId));
            setDraft((current) => current || rawInput);
            if (pending.length) setAttachments((current) => current.length ? current : pending);
            setError(requestError instanceof Error ? requestError.message : "답변을 생성하지 못했습니다.");
          }
          break;
        }
      }
    } finally {
      guestAbortRef.current = null;
      guestPauseControlRef.current = null;
      guestStopReasonRef.current = null;
      guestPausedRef.current = false;
      guestPausedAtRef.current = null;
      setIsGuestPaused(false);
      setGuestStreamingMessageId(null);
      setIsSubmitting(false);
    }
    return generatedOutput;
  }, [attachments, draft, guestMessages, guestStreamingMessageId, guestUserTurns, isSubmitting]);

  const startSession = useCallback(async (
    input: string,
    pending: PendingAttachment[] = [],
    continueInVoiceMode = false,
  ) => {
    const content = input.trim();
    if ((!content && !pending.length) || isSubmitting) return;
    if (authState === "anonymous") {
      await sendGuestMessage(input, pending);
      return;
    }
    if (authState !== "authenticated") return;
    setError("");
    setIsSubmitting(true);
    if (input === draft) setDraft("");
    if (pending.length) setAttachments([]);
    let uploaded: ChatAttachment[] = [];
    try {
      uploaded = await uploadPendingAttachments(pending);
      const session = await apiRequest<ChatSessionDetail>("/chat/sessions", {
        method: "POST",
        body: JSON.stringify({
          input: content,
          attachment_ids: uploaded.map((item) => item.id),
          project_id: selectedProjectId,
        }),
      });
      releaseAttachmentPreviews(pending);
      setAttachments([]);
      primeApiCache(`/chat/sessions/${session.id}`, session);
      const summary: ChatSessionSummary = {
        id: session.id,
        user_id: session.user_id,
        project_id: session.project_id,
        title: session.title,
        is_pinned: session.is_pinned,
        created_at: session.created_at,
        updated_at: session.updated_at,
      };
      primeApiCache("/chat/sessions", sortSessionItems([summary, ...sessions]));
      router.replace(`/chat/${session.id}${continueInVoiceMode ? "?voice=1" : ""}`);
    } catch (requestError) {
      if (uploaded.length) await deleteUploadedAttachments(uploaded);
      setDraft((current) => current || input);
      if (pending.length) setAttachments((current) => current.length ? current : pending);
      setError(requestError instanceof Error ? requestError.message : "대화를 시작하지 못했습니다.");
      setIsSubmitting(false);
    }
  }, [authState, draft, isSubmitting, router, selectedProjectId, sendGuestMessage, sessions]);

  useEffect(() => {
    if (!queuedPrompt || isSubmitting || authState !== "anonymous") return;
    if (guestUserTurns >= GUEST_CHAT_MAX_TURNS) {
      setQueuedPrompt("");
      setError("비로그인 체험은 3번까지 가능합니다. 로그인 후 계속해 주세요.");
      return;
    }
    const nextPrompt = queuedPrompt;
    setQueuedPrompt("");
    void sendGuestMessage(nextPrompt);
  }, [authState, guestUserTurns, isSubmitting, queuedPrompt, sendGuestMessage]);

  useEffect(() => () => guestAbortRef.current?.abort(), []);

  useLayoutEffect(() => {
    if (!guestStreamingMessageId) return;
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
  }, [guestStreamingMessageId]);

  useEffect(() => {
    if (!guestStreamingMessageId || isAwayFromBottom || !followStreamingRef.current) return;
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
  }, [guestStreamingMessageId, isAwayFromBottom]);

  useEffect(() => () => {
    if (scrollAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollAnimationFrameRef.current);
    }
  }, []);

  useEffect(() => {
    if (incomingPrompt && authState !== "checking" && !autoStarted.current) {
      autoStarted.current = true;
      void startSession(incomingPrompt);
    }
  }, [authState, incomingPrompt, startSession]);

  async function handleLogout() {
    if (!user) {
      router.push(`/signin?next=${encodeURIComponent("/chat")}`);
      return;
    }
    await apiRequest<void>("/auth/logout", { method: "POST" });
    invalidateApiCache();
    router.replace("/signin");
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authState === "anonymous" && isSubmitting) {
      const content = draft.trim();
      if (!content || guestUserTurns >= GUEST_CHAT_MAX_TURNS) return;
      setQueuedPrompt((current) => current ? `${current}\n\n${content}` : content);
      setDraft("");
      return;
    }
    void startSession(draft, attachments);
  }

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const childProjects = selectedProject
    ? sortProjectItems(projects.filter((project) => project.parent_id === selectedProject.id))
    : [];
  const projectSessions = selectedProject
    ? sortSessionItems(sessions.filter((session) => session.project_id === selectedProject.id))
    : [];
  const visibleChildren = expandedChildrenFor === selectedProjectId ? childProjects : childProjects.slice(0, 3);
  const visibleProjectSessions = expandedSessionsFor === selectedProjectId ? projectSessions : projectSessions.slice(0, 3);

  function projectBreadcrumb(project: ChatProject) {
    const byId = new Map(projects.map((item) => [item.id, item]));
    const result = [project];
    const visited = new Set([project.id]);
    let parent = project.parent_id ? byId.get(project.parent_id) : undefined;
    while (parent && !visited.has(parent.id)) {
      visited.add(parent.id);
      result.unshift(parent);
      parent = parent.parent_id ? byId.get(parent.parent_id) : undefined;
    }
    return result;
  }

  function beginProjectRename(project: ChatProject) {
    editingProjectNameRef.current = project.name;
    setEditingProjectId(project.id);
    setEditingProjectName(project.name);
  }

  function cancelProjectRename() {
    editingProjectNameRef.current = "";
    setEditingProjectId(null);
    setEditingProjectName("");
  }

  async function saveProjectName(project: ChatProject) {
    const name = editingProjectNameRef.current.trim();
    if (!name || isRenamingProject) return;
    if (name === project.name) {
      cancelProjectRename();
      return;
    }
    setIsRenamingProject(true);
    try {
      const updated = await apiRequest<ChatProject>(`/chat/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      setProjects((current) => sortProjectItems(current.map((item) => item.id === updated.id ? updated : item)));
      invalidateApiCache();
      cancelProjectRename();
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "프로젝트 이름을 바꾸지 못했습니다.");
    } finally {
      setIsRenamingProject(false);
    }
  }

  function handleProjectNameInput(event: FormEvent<HTMLElement>) {
    const name = (event.currentTarget.textContent ?? "").replace(/[\r\n]/g, "").slice(0, 80);
    if (event.currentTarget.textContent !== name) event.currentTarget.textContent = name;
    editingProjectNameRef.current = name;
  }

  function handleProjectRenameKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelProjectRename();
    }
  }

  return (
    <main className="chat-page">
      <ChatSidebar
        user={user}
        sessions={sessions}
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSessionsChange={setSessions}
        onProjectsChange={setProjects}
        onLogout={handleLogout}
        onError={setError}
      />

      <section className="chat-workspace">
        <header className="chat-header">
          <div className="chat-header-context">
            {selectedProject ? <FolderIcon /> : <ChatIcon />}
            <strong>{selectedProject?.name ?? (authState === "anonymous" && guestMessages.length ? "임시 대화" : "새 대화")}</strong>
          </div>
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
          <div className={`chat-thread ${selectedProject ? "project-dashboard-thread" : ""} ${!selectedProject && guestMessages.length ? "conversation-thread" : ""} ${!selectedProject && guestMessages.length && isTurnFocused ? "is-turn-focused" : ""}`}>
            {selectedProject ? (
            <section className="project-dashboard">
              <div className="project-dashboard-heading">
                <p>PROJECT WORKSPACE</p>
                <nav className="project-path-display" aria-label="프로젝트 경로">
                  {projectBreadcrumb(selectedProject).map((project, index, path) => {
                    const isCurrent = project.id === selectedProject.id;
                    const size = path.length === 1 ? 52 : 25 + Math.round((27 * index) / (path.length - 1));
                    return (
                      <span className={`project-path-step ${isCurrent ? "current" : ""}`} key={project.id} style={{ "--project-path-size": `${size}px` } as CSSProperties}>
                        {index > 0 && <i aria-hidden="true">›</i>}
                        <button
                          type="button"
                          className={editingProjectId === project.id ? "project-name-button-editing" : undefined}
                          onClick={() => {
                            if (editingProjectId !== project.id) router.push(`/chat?project=${project.id}`);
                          }}
                        >
                          {editingProjectId === project.id ? (
                            <span
                              ref={projectNameEditorRef}
                              className="project-name-inline-editor"
                              contentEditable={!isRenamingProject}
                              suppressContentEditableWarning
                              role="textbox"
                              aria-label="프로젝트 이름"
                              spellCheck={false}
                              onInput={handleProjectNameInput}
                              onKeyDown={handleProjectRenameKey}
                              onBlur={() => void saveProjectName(project)}
                            >{editingProjectName}</span>
                          ) : <span>{project.name}</span>}
                        </button>
                        {isCurrent && editingProjectId !== project.id && (
                          <button className="project-name-edit project-name-edit-heading" type="button" aria-label={`${project.name} 이름 수정`} onClick={() => beginProjectRename(project)}><EditIcon /></button>
                        )}
                      </span>
                    );
                  })}
                </nav>
                <span>이 프로젝트에 직접 질문하거나 하위 프로젝트로 작업을 나눌 수 있습니다.</span>
              </div>

              <div className="project-dashboard-section">
                <div className="project-dashboard-section-title"><h2>하위 프로젝트</h2><span>{childProjects.length}</span></div>
                <div className="project-dashboard-list">
                  {visibleChildren.map((project) => (
                    <button className="project-dashboard-item project-dashboard-project" type="button" key={project.id} onClick={() => router.push(`/chat?project=${project.id}`)}>
                      <FolderIcon />
                      <strong>{project.name}</strong>
                    </button>
                  ))}
                  {childProjects.length === 0 && <p className="project-dashboard-empty">아직 하위 프로젝트가 없습니다. 왼쪽의 + 버튼으로 추가할 수 있습니다.</p>}
                </div>
                {childProjects.length > 3 && (
                  <button className="project-dashboard-more" type="button" onClick={() => setExpandedChildrenFor((current) => current === selectedProject.id ? null : selectedProject.id)}>
                    {expandedChildrenFor === selectedProject.id ? "하위 프로젝트 접기" : `하위 프로젝트 더 보기 (${childProjects.length - 3})`}
                  </button>
                )}
              </div>

              <div className="project-dashboard-section">
                <div className="project-dashboard-section-title"><h2>최근 대화</h2><span>{projectSessions.length}</span></div>
                <div className="project-dashboard-list">
                  {visibleProjectSessions.map((session) => (
                    <button
                      className="project-dashboard-item conversation"
                      type="button"
                      key={session.id}
                      onPointerEnter={() => warmSession(session.id)}
                      onFocus={() => warmSession(session.id)}
                      onClick={() => router.push(`/chat/${session.id}`)}
                    >
                      <ChatIcon />
                      <span><strong>{session.title}</strong><small>{new Date(session.updated_at).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></span>
                    </button>
                  ))}
                  {projectSessions.length === 0 && <p className="project-dashboard-empty">아래 입력창에서 질문하면 이 프로젝트의 대화로 저장됩니다.</p>}
                </div>
                {projectSessions.length > 3 && (
                  <button className="project-dashboard-more" type="button" onClick={() => setExpandedSessionsFor((current) => current === selectedProject.id ? null : selectedProject.id)}>
                    {expandedSessionsFor === selectedProject.id ? "대화 접기" : `대화 더 보기 (${projectSessions.length - 3})`}
                  </button>
                )}
              </div>
              {error && <p className="chat-error" role="alert">{error}</p>}
            </section>
            ) : authState === "anonymous" && guestMessages.length > 0 ? (
              <section className="guest-chat-thread" aria-label="비로그인 임시 대화">
                {guestMessages.map((message) => (
                  <div className={`message-row ${message.role} ${message.id === guestStreamingMessageId ? "pending-message" : ""}`} key={message.id}>
                    {message.role === "assistant" && <Image src="/star-mark-black.png" alt="STAR" width={34} height={34} />}
                    <div className="message-bubble">
                      {message.role === "assistant" && <strong className="star-wordmark star-agent-name">STAR</strong>}
                      {message.attachments.length > 0 && (
                        <div className="message-attachments">
                          {message.attachments.map((attachment) => attachment.kind === "image" && attachment.content_url ? (
                            <span className="message-image guest-message-image" key={attachment.id}>
                              {/* Local object URLs are temporary previews and cannot use Next's image loader. */}
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={attachment.content_url} alt={attachment.original_filename} />
                            </span>
                          ) : (
                            <span className="message-attachment-file guest-message-file" key={attachment.id}>{attachment.original_filename}</span>
                          ))}
                        </div>
                      )}
                      {message.role === "assistant" ? (
                        <>
                          {message.content && <MarkdownMessage content={message.content} />}
                          <GenerationStatus
                            state={message.id === guestStreamingMessageId ? guestGenerationState : "complete"}
                            durationMs={message.id === guestStreamingMessageId
                              ? guestGenerationDuration
                              : message.generation_duration_ms ?? null}
                          />
                        </>
                      ) : (
                        <p>{message.content}</p>
                      )}
                    </div>
                  </div>
                ))}
                {error && <p className="chat-error" role="alert">{error}</p>}
              </section>
            ) : (
              <div className="chat-empty">
                <Image src="/star-mark-black.png" alt="STAR 심볼" width={76} height={76} />
                <h1>무엇을 함께 생각해 볼까요?</h1>
                <p>{authState === "anonymous" ? "로그인 없이 3번까지 바로 대화할 수 있습니다." : "첫 질문을 보내면 새로운 대화 세션이 만들어집니다."}</p>
                {error && <p className="chat-error" role="alert">{error}</p>}
              </div>
            )}
          </div>
          </div>
          <div className="thread-scrollbar" aria-hidden="true"><span /></div>
          <ThreadFollowControl
            visible={!selectedProject && isAwayFromBottom}
            generating={Boolean(guestStreamingMessageId)}
            onClick={scrollToThreadBottom}
          />
        </div>
        <div className="composer-wrap">
          {guestLimitReached && (
            <aside className="guest-limit-card" role="status">
              <div>
                <strong>무료 체험 3번을 모두 사용했습니다.</strong>
                <span>로그인하거나 회원가입하면 대화를 계속하고 기록을 보관할 수 있습니다.</span>
              </div>
              <div className="guest-limit-actions">
                <Link href={`/signin?next=${encodeURIComponent("/chat")}`}>Sign in</Link>
                <Link href={`/signin?mode=signup&next=${encodeURIComponent("/chat")}`}>회원가입</Link>
              </div>
            </aside>
          )}
          <ChatComposer
            draft={draft}
            setDraft={setDraft}
            attachments={attachments}
            setAttachments={setAttachments}
            disabled={isSubmitting || authState === "checking" || guestLimitReached}
            inputDisabled={authState === "checking" || guestLimitReached}
            allowSubmitWhileDisabled={authState === "anonymous" && isSubmitting && guestUserTurns < GUEST_CHAT_MAX_TURNS}
            isGenerating={authState === "anonymous" && isSubmitting}
            isPaused={isGuestPaused}
            buttonLabel={guestLimitReached ? "로그인 필요" : isSubmitting ? "대기열에 추가" : "질문하기"}
            queuedPrompt={queuedPrompt}
            onSendQueuedNow={() => {
              if (guestPausedRef.current) {
                guestPauseControlRef.current?.("send-now");
              } else {
                guestStopReasonRef.current = "send-now";
                guestAbortRef.current?.abort();
              }
            }}
            onCancelQueued={() => setQueuedPrompt("")}
            onTogglePause={() => {
              if (guestPausedRef.current) {
                guestPauseControlRef.current?.("resume");
              } else {
                guestStopReasonRef.current = "pause";
                guestPausedRef.current = true;
                guestPausedAtRef.current = performance.now();
                setIsGuestPaused(true);
                setGuestGenerationState("paused");
                guestAbortRef.current?.abort();
              }
            }}
            onStopGeneration={() => {
              setQueuedPrompt("");
              if (guestPausedRef.current) {
                guestPauseControlRef.current?.("stop");
              } else {
                guestStopReasonRef.current = "stop";
                guestAbortRef.current?.abort();
              }
            }}
            onSubmit={handleSubmit}
            onError={setError}
            onVoiceOpen={() => setVoiceOpen(true)}
          />
          {authState === "anonymous" && (
            <p>임시 대화 {guestCompletedTurns}/{GUEST_CHAT_MAX_TURNS} · 새로고침해도 유지되며 탭을 닫으면 삭제됩니다.</p>
          )}
        </div>
      </section>
      <VoiceMode
        open={voiceOpen}
        ready={authState !== "checking" && !guestLimitReached}
        waiting={isSubmitting}
        reply={null}
        onClose={() => setVoiceOpen(false)}
        onTranscript={async (text) => {
          if (authState === "anonymous") {
            const output = await sendGuestMessage(text);
            return output?.content ?? null;
          }
          await startSession(text, [], true);
          return null;
        }}
        onError={setError}
      />
    </main>
  );
}
