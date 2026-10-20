"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useCallback, useEffect, useRef, useState } from "react";

import { ChatComposer } from "@/app/components/chat-composer";
import { ChatSidebar } from "@/app/components/chat-sidebar";
import { useTransientScrollbar } from "@/app/components/use-transient-scrollbar";
import { VoiceMode } from "@/app/components/voice-mode";
import { apiCachedRequest, apiRequest, invalidateApiCache, primeApiCache } from "@/lib/api";
import {
  deleteUploadedAttachments,
  releaseAttachmentPreviews,
  uploadPendingAttachments,
} from "@/lib/attachments";
import type {
  AuthUser,
  ChatAttachment,
  ChatProject,
  ChatSessionDetail,
  ChatSessionSummary,
  PendingAttachment,
} from "@/lib/chat";

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

function NewChatContent() {
  const router = useRouter();
  const handleThreadScroll = useTransientScrollbar<HTMLDivElement>();
  const searchParams = useSearchParams();
  const incomingPrompt = searchParams.get("prompt")?.trim() ?? "";
  const selectedProjectId = searchParams.get("project");
  const autoStarted = useRef(false);
  const [draft, setDraft] = useState(incomingPrompt);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [error, setError] = useState("");
  const [expandedChildrenFor, setExpandedChildrenFor] = useState<string | null>(null);
  const [expandedSessionsFor, setExpandedSessionsFor] = useState<string | null>(null);

  function warmSession(sessionId: string) {
    router.prefetch(`/chat/${sessionId}`);
    void apiCachedRequest<ChatSessionDetail>(`/chat/sessions/${sessionId}`).catch(() => undefined);
  }

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
      .catch(() => router.replace(`/signin?next=${encodeURIComponent(`/chat${incomingPrompt ? `?prompt=${encodeURIComponent(incomingPrompt)}` : ""}`)}`));
  }, [incomingPrompt, router]);

  const startSession = useCallback(async (
    input: string,
    pending: PendingAttachment[] = [],
    continueInVoiceMode = false,
  ) => {
    const content = input.trim();
    if ((!content && !pending.length) || isSubmitting) return;
    setError("");
    setIsSubmitting(true);
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
      setError(requestError instanceof Error ? requestError.message : "대화를 시작하지 못했습니다.");
      setIsSubmitting(false);
    }
  }, [isSubmitting, router, selectedProjectId, sessions]);

  useEffect(() => {
    if (incomingPrompt && user && !autoStarted.current) {
      autoStarted.current = true;
      void startSession(incomingPrompt);
    }
  }, [incomingPrompt, startSession, user]);

  async function handleLogout() {
    await apiRequest<void>("/auth/logout", { method: "POST" });
    invalidateApiCache();
    router.replace("/signin");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
          <div><strong>{selectedProject?.name ?? "새 대화"}</strong><span><i /><b className="star-wordmark">STAR</b></span></div>
          <Link href="/">홈으로</Link>
        </header>
        <div className="chat-thread-shell">
          <div className="chat-scroll-viewport" onScroll={handleThreadScroll}>
          <div className={`chat-thread ${selectedProject ? "project-dashboard-thread" : ""}`}>
            {selectedProject ? (
            <section className="project-dashboard">
              <nav className="project-breadcrumb" aria-label="프로젝트 경로">
                {projectBreadcrumb(selectedProject).map((project, index) => (
                  <span key={project.id}>
                    {index > 0 && <i aria-hidden="true">›</i>}
                    <button type="button" onClick={() => router.push(`/chat?project=${project.id}`)}>{project.name}</button>
                  </span>
                ))}
              </nav>
              <div className="project-dashboard-heading">
                <p>PROJECT WORKSPACE</p>
                <h1>{selectedProject.name}</h1>
                <span>이 프로젝트에 직접 질문하거나 하위 프로젝트로 작업을 나눌 수 있습니다.</span>
              </div>

              <div className="project-dashboard-section">
                <div className="project-dashboard-section-title"><h2>하위 프로젝트</h2><span>{childProjects.length}</span></div>
                <div className="project-dashboard-list">
                  {visibleChildren.map((project) => (
                    <button className="project-dashboard-item" type="button" key={project.id} onClick={() => router.push(`/chat?project=${project.id}`)}>
                      <span className="project-dashboard-icon" aria-hidden="true">⌁</span>
                      <span><strong>{project.name}</strong><small>하위 프로젝트 열기</small></span>
                      <b aria-hidden="true">›</b>
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
                      <span className="project-dashboard-icon" aria-hidden="true">✦</span>
                      <span><strong>{session.title}</strong><small>{new Date(session.updated_at).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></span>
                      <b aria-hidden="true">›</b>
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
            ) : (
              <div className="chat-empty">
                <Image src="/star-mark-black.png" alt="STAR 심볼" width={76} height={76} />
                <h1>무엇을 함께 생각해 볼까요?</h1>
                <p>첫 질문을 보내면 새로운 대화 세션이 만들어집니다.</p>
                {error && <p className="chat-error" role="alert">{error}</p>}
              </div>
            )}
          </div>
          </div>
          <div className="thread-scrollbar" aria-hidden="true"><span /></div>
        </div>
        <div className="composer-wrap">
          <ChatComposer
            draft={draft}
            setDraft={setDraft}
            attachments={attachments}
            setAttachments={setAttachments}
            disabled={isSubmitting}
            buttonLabel={isSubmitting ? "업로드 중" : "질문하기"}
            onSubmit={handleSubmit}
            onError={setError}
            onVoiceOpen={() => setVoiceOpen(true)}
          />
          <p>{selectedProject ? `${selectedProject.name} 프로젝트에 새 대화로 저장됩니다.` : "질문을 보내면 session_id가 생성되고 상세 대화로 이동합니다."}</p>
        </div>
      </section>
      <VoiceMode
        open={voiceOpen}
        ready={Boolean(user)}
        waiting={isSubmitting}
        reply={null}
        onClose={() => setVoiceOpen(false)}
        onTranscript={async (text) => {
          await startSession(text, [], true);
          return null;
        }}
        onError={setError}
      />
    </main>
  );
}
