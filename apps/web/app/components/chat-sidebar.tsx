"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CSSProperties, FormEvent, MouseEvent, PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

import { ChatProfileMenu } from "@/app/components/chat-profile-menu";
import { useTransientScrollbar } from "@/app/components/use-transient-scrollbar";
import { apiCachedRequest, apiRequest, primeApiCache } from "@/lib/api";
import type { AuthUser, ChatProject, ChatSessionDetail, ChatSessionSummary } from "@/lib/chat";

type ChatSidebarProps = {
  user: AuthUser | null;
  sessions: ChatSessionSummary[];
  projects: ChatProject[];
  activeSessionId?: string;
  selectedProjectId?: string | null;
  onSessionsChange: (sessions: ChatSessionSummary[]) => void;
  onProjectsChange: (projects: ChatProject[]) => void;
  onLogout: () => Promise<void>;
  onError: (message: string) => void;
};

type MenuPosition = { top: number; left: number };

const SIDEBAR_RAIL_WIDTH = 58;
const SIDEBAR_PINNED_WIDTH = 338;
const SIDEBAR_PIN_THRESHOLD = 96;

function sortSessions(sessions: ChatSessionSummary[]) {
  return [...sessions].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    return Date.parse(b.updated_at) - Date.parse(a.updated_at);
  });
}

function sortProjects(projects: ChatProject[]) {
  return [...projects].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    return Date.parse(b.updated_at) - Date.parse(a.updated_at);
  });
}

function sortProjectsByUpdated(projects: ChatProject[]) {
  return [...projects].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

function FolderIcon() {
  return <svg className="thread-type-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M3.5 7.5h6l2-2h3.5l2 2h3.5v11h-17z" /></svg>;
}

function ChatIcon() {
  return <svg className="thread-type-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M5 5.5h14v10H9l-4 3z" /></svg>;
}

function PinIcon() {
  return <svg className="thread-type-icon pin" aria-hidden="true" viewBox="0 0 24 24"><path d="m9 4 6 1-1 5 3 3-5 1-3 6-.5-6L5 11l5-1z" /></svg>;
}

export function ChatSidebar({
  user,
  sessions,
  projects,
  activeSessionId,
  selectedProjectId,
  onSessionsChange,
  onProjectsChange,
  onLogout,
  onError,
}: ChatSidebarProps) {
  const router = useRouter();
  const handleSidebarScroll = useTransientScrollbar<HTMLDivElement>(
    ".sidebar-scroll-shell",
    "sidebar-scroll",
  );
  const menuRootRef = useRef<HTMLElement>(null);
  const sidebarDragRef = useRef<{
    pointerId: number;
    startX: number;
    lastDeltaX: number;
    moved: boolean;
    initiallyCollapsed: boolean;
    initiallyPinned: boolean;
  } | null>(null);
  const sidebarPreviewCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressSidebarClickUntilRef = useRef(0);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({ top: 0, left: 0 });
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set(selectedProjectId ? [selectedProjectId] : []),
  );
  const [manuallyCollapsedProjects, setManuallyCollapsedProjects] = useState<Set<string>>(() => new Set());
  const [creatingParentId, setCreatingParentId] = useState<string | "root" | null>(null);
  const [projectName, setProjectName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showAllProjectChildren, setShowAllProjectChildren] = useState<Set<string>>(() => new Set());
  const [showAllProjectSessions, setShowAllProjectSessions] = useState<Set<string>>(() => new Set());
  const [showAllRootProjects, setShowAllRootProjects] = useState(false);
  const [showAllRecentSessions, setShowAllRecentSessions] = useState(false);
  const [moveProjectTrail, setMoveProjectTrail] = useState<string[]>([]);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === "undefined") return true;
    const pinned = window.localStorage.getItem("brown-chat-sidebar-pinned") === "true";
    return !pinned || window.localStorage.getItem("brown-chat-sidebar-collapsed") === "true";
  });
  const [isSidebarPinned, setIsSidebarPinned] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem("brown-chat-sidebar-pinned") === "true",
  );
  const [isSidebarDragging, setIsSidebarDragging] = useState(false);
  const [sidebarHandleDragX, setSidebarHandleDragX] = useState(0);
  const [sidebarDockProgress, setSidebarDockProgress] = useState(0);

  const projectById = new Map(projects.map((project) => [project.id, project]));

  useEffect(() => {
    function closeMenus(event: PointerEvent) {
      if (!menuRootRef.current?.contains(event.target as Node)) setOpenMenu(null);
    }
    document.addEventListener("pointerdown", closeMenus);
    return () => document.removeEventListener("pointerdown", closeMenus);
  }, []);

  useEffect(() => () => {
    if (sidebarPreviewCloseTimerRef.current) clearTimeout(sidebarPreviewCloseTimerRef.current);
  }, []);

  useEffect(() => {
    if (!user) return;
    primeApiCache("/chat/sessions", sessions);
    primeApiCache("/chat/projects", projects);
  }, [projects, sessions, user]);

  function openMenuAt(menuId: string, event: MouseEvent<HTMLButtonElement>) {
    if (openMenu === menuId) {
      setOpenMenu(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 210;
    const gap = 8;
    const fitsRight = rect.right + gap + menuWidth <= window.innerWidth - 8;
    setMenuPosition({
      top: Math.max(8, Math.min(rect.top, window.innerHeight - 360)),
      left: fitsRight ? rect.right + gap : Math.max(8, rect.left - menuWidth - gap),
    });
    setMoveProjectTrail([]);
    setOpenMenu(menuId);
  }

  function navigate(href: string, replace = false) {
    setMobileOpen(false);
    router.prefetch(href);
    if (replace) router.replace(href);
    else router.push(href);
  }

  function warmSession(sessionId: string) {
    router.prefetch(`/chat/${sessionId}`);
    void apiCachedRequest<ChatSessionDetail>(`/chat/sessions/${sessionId}`).catch(() => undefined);
  }

  function saveSidebarState(collapsed: boolean) {
    setIsCollapsed(collapsed);
    window.localStorage.setItem("brown-chat-sidebar-collapsed", String(collapsed));
  }

  function saveSidebarPinned(pinned: boolean) {
    setIsSidebarPinned(pinned);
    window.localStorage.setItem("brown-chat-sidebar-pinned", String(pinned));
  }

  function sidebarPageElement() {
    return menuRootRef.current?.closest<HTMLElement>(".chat-page") ?? null;
  }

  function setSidebarPageWidth(width: number | null) {
    const page = sidebarPageElement();
    if (!page) return;
    if (width === null) page.style.removeProperty("--chat-sidebar-width");
    else page.style.setProperty("--chat-sidebar-width", `${width}px`);
  }

  function cancelSidebarPreviewClose() {
    if (!sidebarPreviewCloseTimerRef.current) return;
    clearTimeout(sidebarPreviewCloseTimerRef.current);
    sidebarPreviewCloseTimerRef.current = null;
  }

  function openSidebarPreview() {
    cancelSidebarPreviewClose();
    if (isSidebarPinned || isSidebarDragging) return;
    setIsCollapsed(false);
  }

  function scheduleSidebarPreviewClose() {
    cancelSidebarPreviewClose();
    if (isSidebarPinned || isSidebarDragging || sidebarDragRef.current) return;
    sidebarPreviewCloseTimerRef.current = setTimeout(() => {
      setIsCollapsed(true);
      setOpenMenu(null);
      sidebarPreviewCloseTimerRef.current = null;
    }, 160);
  }

  function handleSidebarPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    if (isSidebarPinned && !isCollapsed) return;
    sidebarDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      lastDeltaX: 0,
      moved: false,
      initiallyCollapsed: isCollapsed,
      initiallyPinned: isSidebarPinned && !isCollapsed,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsSidebarDragging(true);
    setSidebarPageWidth(isSidebarPinned && !isCollapsed ? SIDEBAR_PINNED_WIDTH : SIDEBAR_RAIL_WIDTH);
    setSidebarDockProgress(isCollapsed ? 0 : 1);
  }

  function handleSidebarPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = sidebarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    drag.lastDeltaX = deltaX;
    if (Math.abs(deltaX) >= 5) drag.moved = true;
    const startWidth = drag.initiallyPinned ? SIDEBAR_PINNED_WIDTH : SIDEBAR_RAIL_WIDTH;
    const width = Math.min(SIDEBAR_PINNED_WIDTH, Math.max(SIDEBAR_RAIL_WIDTH, startWidth + deltaX));
    setSidebarPageWidth(width);
    setSidebarHandleDragX(drag.initiallyPinned ? 0 : Math.min(140, Math.max(0, deltaX)));
    const dockProgress = (width - SIDEBAR_RAIL_WIDTH) / (SIDEBAR_PINNED_WIDTH - SIDEBAR_RAIL_WIDTH);
    setSidebarDockProgress(drag.initiallyCollapsed ? dockProgress : 1);
  }

  function finishSidebarDrag(event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) {
    const drag = sidebarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const shouldPin = !cancelled && !drag.initiallyPinned && drag.lastDeltaX >= SIDEBAR_PIN_THRESHOLD;
    const pinned = shouldPin ? true : drag.initiallyPinned;
    const collapsed = shouldPin ? false : drag.initiallyCollapsed;
    sidebarDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setIsSidebarDragging(false);
    setSidebarHandleDragX(0);
    setSidebarDockProgress(pinned && !collapsed ? 1 : 0);
    if (drag.moved) {
      suppressSidebarClickUntilRef.current = performance.now() + 300;
      saveSidebarPinned(pinned);
      saveSidebarState(collapsed);
    }
    setSidebarPageWidth(pinned && !collapsed ? SIDEBAR_PINNED_WIDTH : SIDEBAR_RAIL_WIDTH);
    window.requestAnimationFrame(() => setSidebarPageWidth(null));
  }

  function handleSidebarClick() {
    if (performance.now() < suppressSidebarClickUntilRef.current) return;
    if (!isSidebarPinned || isCollapsed) return;
    cancelSidebarPreviewClose();
    saveSidebarPinned(false);
    saveSidebarState(true);
  }

  function toggleSidebarPinned() {
    const next = !isSidebarPinned;
    saveSidebarPinned(next);
    if (next) saveSidebarState(false);
  }

  function toggleShowAll(setter: typeof setShowAllProjectChildren, projectId: string) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = projectName.trim();
    if (!name || isSaving || creatingParentId === null) return;
    const parentId = creatingParentId === "root" ? null : creatingParentId;
    setIsSaving(true);
    try {
      const project = await apiRequest<ChatProject>("/chat/projects", {
        method: "POST",
        body: JSON.stringify({ name, parent_id: parentId }),
      });
      onProjectsChange(sortProjects([project, ...projects]));
      setExpandedProjects((current) => {
        const next = new Set(current).add(project.id);
        if (parentId) next.add(parentId);
        return next;
      });
      if (parentId) {
        setManuallyCollapsedProjects((current) => {
          const next = new Set(current);
          next.delete(parentId);
          return next;
        });
      }
      setProjectName("");
      setCreatingParentId(null);
      navigate(`/chat?project=${project.id}`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "프로젝트를 만들지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  function startCreatingProject(parentId: string | "root") {
    setProjectName("");
    setCreatingParentId(parentId);
    setOpenMenu(null);
    if (parentId !== "root") {
      setExpandedProjects((current) => new Set(current).add(parentId));
      setManuallyCollapsedProjects((current) => {
        const next = new Set(current);
        next.delete(parentId);
        return next;
      });
    }
  }

  function projectCreateForm(parentName?: string) {
    return (
      <form className="project-create-form" onSubmit={createProject}>
        <input
          value={projectName}
          onChange={(event) => setProjectName(event.target.value)}
          placeholder={parentName ? `${parentName} 하위 프로젝트` : "프로젝트 이름"}
          maxLength={80}
          autoFocus
        />
        <button type="submit" disabled={!projectName.trim() || isSaving}>{isSaving ? "…" : "추가"}</button>
        <button className="cancel" type="button" aria-label="취소" onClick={() => setCreatingParentId(null)}>×</button>
      </form>
    );
  }

  async function toggleProjectPin(project: ChatProject) {
    try {
      const updated = await apiRequest<ChatProject>(`/chat/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_pinned: !project.is_pinned }),
      });
      onProjectsChange(sortProjects(projects.map((item) => item.id === updated.id ? updated : item)));
      setOpenMenu(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : "프로젝트를 고정하지 못했습니다.");
    }
  }

  async function deleteProject(project: ChatProject) {
    const destination = project.parent_id ? "상위 프로젝트" : "일반 목록";
    if (!window.confirm(`‘${project.name}’ 프로젝트를 삭제할까요? 내부 항목은 ${destination}으로 이동합니다.`)) return;
    try {
      await apiRequest<void>(`/chat/projects/${project.id}`, { method: "DELETE" });
      onProjectsChange(projects
        .filter((item) => item.id !== project.id)
        .map((item) => item.parent_id === project.id ? { ...item, parent_id: project.parent_id } : item));
      onSessionsChange(sessions.map((session) => session.project_id === project.id
        ? { ...session, project_id: project.parent_id }
        : session));
      setOpenMenu(null);
      if (selectedProjectId === project.id) {
        navigate(project.parent_id ? `/chat?project=${project.parent_id}` : "/chat");
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "프로젝트를 삭제하지 못했습니다.");
    }
  }

  async function updateSession(session: ChatSessionSummary, changes: object) {
    try {
      const updated = await apiRequest<ChatSessionSummary>(`/chat/sessions/${session.id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      onSessionsChange(sortSessions(sessions.map((item) => item.id === updated.id ? updated : item)));
      setOpenMenu(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : "대화를 변경하지 못했습니다.");
    }
  }

  async function deleteSession(session: ChatSessionSummary) {
    if (!window.confirm(`‘${session.title}’ 대화를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
    try {
      await apiRequest<void>(`/chat/sessions/${session.id}`, { method: "DELETE" });
      onSessionsChange(sessions.filter((item) => item.id !== session.id));
      setOpenMenu(null);
      if (activeSessionId === session.id) navigate("/chat", true);
    } catch (error) {
      onError(error instanceof Error ? error.message : "대화를 삭제하지 못했습니다.");
    }
  }

  function toggleProject(projectId: string) {
    const isExpanded = !manuallyCollapsedProjects.has(projectId)
      && (expandedProjects.has(projectId) || isInSelectedPath(projectId));
    if (isExpanded) {
      setManuallyCollapsedProjects((current) => new Set(current).add(projectId));
      return;
    }
    setManuallyCollapsedProjects((current) => {
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
    setExpandedProjects((current) => new Set(current).add(projectId));
  }

  function isInSelectedPath(projectId: string) {
    let project = selectedProjectId ? projectById.get(selectedProjectId) : undefined;
    const visited = new Set<string>();
    while (project && !visited.has(project.id)) {
      if (project.id === projectId) return true;
      visited.add(project.id);
      project = project.parent_id ? projectById.get(project.parent_id) : undefined;
    }
    return false;
  }

  function projectMoveBrowser(session: ChatSessionSummary) {
    const trail = moveProjectTrail
      .map((projectId) => projectById.get(projectId))
      .filter((project): project is ChatProject => Boolean(project));
    const paneParents: Array<ChatProject | null> = [null, ...trail];

    return (
      <div className="project-move-browser">
        {paneParents.map((parent, paneIndex) => {
          const parentId = parent?.id ?? null;
          const paneProjects = sortProjectsByUpdated(projects.filter((project) => project.parent_id === parentId));
          return (
            <div
              className={`project-move-pane ${paneIndex === 0 ? "root" : "child"}`}
              key={parentId ?? "root"}
              style={paneIndex === 0 ? undefined : { left: paneIndex * 218 }}
            >
              {paneIndex > 0 && <strong className="project-move-pane-title">{parent?.name}</strong>}
              {paneProjects.map((project) => {
                const children = projects.filter((item) => item.parent_id === project.id);
                const isOpen = moveProjectTrail[paneIndex] === project.id;
                return (
                  <div className="project-move-row" key={project.id}>
                    <button
                      className="project-move-target"
                      type="button"
                      role="menuitem"
                      title={`${project.name}(으)로 이동`}
                      onClick={() => void updateSession(session, { project_id: project.id })}
                    >
                      <FolderIcon />
                      <span>{project.name}</span>
                    </button>
                    {children.length > 0 && (
                      <button
                        className="project-move-next"
                        type="button"
                        aria-label={`${project.name} 하위 프로젝트 ${isOpen ? "닫기" : "열기"}`}
                        aria-expanded={isOpen}
                        onClick={() => setMoveProjectTrail((current) => (
                          isOpen
                            ? current.slice(0, paneIndex)
                            : [...current.slice(0, paneIndex), project.id]
                        ))}
                      >
                        {isOpen ? "‹" : "›"}
                      </button>
                    )}
                  </div>
                );
              })}
              {paneProjects.length === 0 && <span className="project-move-empty">하위 프로젝트가 없습니다.</span>}
            </div>
          );
        })}
      </div>
    );
  }

  function sessionMenu(session: ChatSessionSummary, menuId: string) {
    if (openMenu !== menuId) return null;
    return (
      <div className={`sidebar-item-menu ${projects.length > 0 ? "has-project-browser" : ""}`} role="menu" style={menuPosition}>
        <button type="button" role="menuitem" onClick={() => void updateSession(session, { is_pinned: !session.is_pinned })}>
          {session.is_pinned ? "고정 해제" : "고정"}
        </button>
        {projects.length > 0 && <p>프로젝트로 이동</p>}
        {projects.length > 0 && projectMoveBrowser(session)}
        {session.project_id && <button type="button" role="menuitem" onClick={() => void updateSession(session, { project_id: null })}>프로젝트에서 제거</button>}
        <button className="danger" type="button" role="menuitem" onClick={() => void deleteSession(session)}>삭제</button>
      </div>
    );
  }

  function projectMenu(project: ChatProject, menuId: string) {
    if (openMenu !== menuId) return null;
    return (
      <div className="sidebar-item-menu" role="menu" style={menuPosition}>
        <button type="button" role="menuitem" onClick={() => void toggleProjectPin(project)}>{project.is_pinned ? "고정 해제" : "고정"}</button>
        <button className="danger" type="button" role="menuitem" onClick={() => void deleteProject(project)}>프로젝트 삭제</button>
      </div>
    );
  }

  function sessionRow(session: ChatSessionSummary, depth = 0) {
    const menuId = `session-${session.id}`;
    return (
      <div className={`conversation-row ${session.id === activeSessionId ? "active" : ""}`} key={session.id} style={{ paddingLeft: depth * 12 }}>
        <button
          className="conversation-link"
          type="button"
          onPointerEnter={() => warmSession(session.id)}
          onFocus={() => warmSession(session.id)}
          onClick={() => navigate(`/chat/${session.id}`)}
        >
          {session.is_pinned ? <PinIcon /> : <ChatIcon />}
          <span className="thread-title-fade">{session.title}</span>
        </button>
        <button className="conversation-more" type="button" aria-label={`${session.title} 대화 메뉴`} aria-expanded={openMenu === menuId} onClick={(event) => openMenuAt(menuId, event)}>•••</button>
        {sessionMenu(session, menuId)}
      </div>
    );
  }

  function projectNode(project: ChatProject, depth = 0) {
    const expanded = !manuallyCollapsedProjects.has(project.id)
      && (expandedProjects.has(project.id) || isInSelectedPath(project.id));
    const menuId = `project-${project.id}`;
    const children = sortProjects(projects.filter((item) => item.parent_id === project.id));
    const projectSessions = sortSessions(sessions.filter((session) => session.project_id === project.id));
    const visibleChildren = showAllProjectChildren.has(project.id) ? children : children.slice(0, 3);
    const visibleSessions = showAllProjectSessions.has(project.id) ? projectSessions : projectSessions.slice(0, 3);
    const hasContents = children.length > 0 || projectSessions.length > 0;
    return (
      <div className="project-group" key={project.id}>
        <div className={`project-row ${selectedProjectId === project.id ? "active" : ""}`} style={{ paddingLeft: depth * 12 }}>
          <button className="project-expand" type="button" onClick={() => toggleProject(project.id)} aria-label={`${project.name} ${expanded ? "접기" : "펼치기"}`} aria-expanded={expanded}>
            <span aria-hidden="true">{hasContents ? (expanded ? "⌄" : "›") : "·"}</span>
          </button>
          <button className="project-open" type="button" onClick={() => navigate(`/chat?project=${project.id}`)}>
            <FolderIcon />
            <strong className="thread-title-fade">{project.name}</strong>
          </button>
          <button className="project-new-chat" type="button" aria-label={`${project.name}에 하위 프로젝트 추가`} onClick={() => startCreatingProject(project.id)}>＋</button>
          <button className="conversation-more" type="button" aria-label={`${project.name} 프로젝트 메뉴`} aria-expanded={openMenu === menuId} onClick={(event) => openMenuAt(menuId, event)}>•••</button>
          {projectMenu(project, menuId)}
        </div>
        {creatingParentId === project.id && <div style={{ paddingLeft: (depth + 1) * 12 }}>{projectCreateForm(project.name)}</div>}
        {expanded && (
          <div className="project-contents">
            {visibleChildren.map((child) => projectNode(child, depth + 1))}
            {children.length > 3 && (
              <button className="project-more" type="button" style={{ paddingLeft: 8 + (depth + 1) * 12 }} onClick={() => toggleShowAll(setShowAllProjectChildren, project.id)}>
                {showAllProjectChildren.has(project.id) ? "하위 프로젝트 접기" : `하위 프로젝트 더 보기 (${children.length - 3})`}
              </button>
            )}
            {visibleSessions.map((session) => sessionRow(session, depth + 1))}
            {projectSessions.length > 3 && (
              <button className="project-more" type="button" style={{ paddingLeft: 8 + (depth + 1) * 12 }} onClick={() => toggleShowAll(setShowAllProjectSessions, project.id)}>
                {showAllProjectSessions.has(project.id) ? "대화 접기" : `대화 더 보기 (${projectSessions.length - 3})`}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  const ungrouped = sortSessions(sessions.filter((session) => !session.project_id));
  const recentUngrouped = ungrouped.filter((session) => !session.is_pinned);
  const visibleRecentUngrouped = showAllRecentSessions ? recentUngrouped : recentUngrouped.slice(0, 3);
  const rootProjects = sortProjects(projects.filter((project) => !project.parent_id || !projectById.has(project.parent_id)));
  const visibleRootProjects = showAllRootProjects ? rootProjects : rootProjects.slice(0, 3);
  const pinnedProjects = sortProjects(projects.filter((project) => project.is_pinned));
  const pinnedSessions = sortSessions(sessions.filter((session) => session.is_pinned));

  return (
    <>
      <button className="mobile-sidebar-toggle" type="button" aria-label="대화 목록 열기" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}>☰</button>
      {mobileOpen && <button className="mobile-sidebar-backdrop" type="button" aria-label="대화 목록 닫기" onClick={() => setMobileOpen(false)} />}
      <aside
        className={`chat-sidebar ${mobileOpen ? "mobile-open" : ""} ${isCollapsed && !mobileOpen ? "collapsed" : ""} ${isSidebarPinned && !isCollapsed && !mobileOpen ? "pinned" : ""} ${isSidebarDragging ? "dragging" : ""}`}
        ref={menuRootRef}
        style={{
          "--sidebar-handle-drag-x": `${sidebarHandleDragX}px`,
          "--sidebar-dock-opacity": Math.min(1, sidebarDockProgress * 2.25),
          "--sidebar-dock-x": `${Math.round((1 - sidebarDockProgress) * -18)}px`,
        } as CSSProperties}
        onMouseLeave={scheduleSidebarPreviewClose}
      >
        <button
          className="sidebar-collapse"
          type="button"
          aria-label={isSidebarPinned ? "클릭해 사이드바 숨기기" : "마우스를 올려 사이드바 미리보기 또는 오른쪽으로 드래그해 고정"}
          aria-expanded={!isCollapsed}
          onClick={handleSidebarClick}
          onMouseEnter={openSidebarPreview}
          onFocus={openSidebarPreview}
          onBlur={scheduleSidebarPreviewClose}
          onPointerDown={handleSidebarPointerDown}
          onPointerMove={handleSidebarPointerMove}
          onPointerUp={(event) => finishSidebarDrag(event)}
          onPointerCancel={(event) => finishSidebarDrag(event, true)}
        >
          <Image src="/star-mark-black.png" alt="" width={28} height={28} draggable={false} priority />
        </button>
        <button className="mobile-sidebar-close" type="button" aria-label="대화 목록 닫기" onClick={() => setMobileOpen(false)}>×</button>
        <div className="sidebar-panel-content" onMouseEnter={cancelSidebarPreviewClose}>
          <div className="sidebar-panel-header">
            <Link className="brand-lockup" href="/"><span>STAR</span></Link>
            <button
              className={`sidebar-pin-toggle ${isSidebarPinned ? "active" : ""}`}
              type="button"
              aria-label={isSidebarPinned ? "사이드바 고정 해제" : "사이드바 고정"}
              aria-pressed={isSidebarPinned}
              onClick={toggleSidebarPinned}
            ><PinIcon /></button>
          </div>
          <button className="new-chat-button" type="button" onClick={() => navigate(selectedProjectId ? `/chat?project=${selectedProjectId}` : "/chat")}><ChatIcon /><span>새 대화</span></button>

          <div className="sidebar-scroll-shell">
          <div className="sidebar-scroll-content" onScroll={handleSidebarScroll}>
            {(pinnedProjects.length > 0 || pinnedSessions.length > 0) && (
              <div className="pinned-threads">
                <p>고정된 스레드</p>
                {pinnedProjects.map((project) => {
                  const menuId = `pinned-project-${project.id}`;
                  return (
                    <div className="pinned-thread-row" key={menuId}>
                      <button className="pinned-thread-link" type="button" onClick={() => navigate(`/chat?project=${project.id}`)}>
                        <span className="pinned-thread-icons"><PinIcon /><FolderIcon /></span>
                        <span className="thread-title-fade">{project.name}</span>
                      </button>
                      <button className="conversation-more" type="button" aria-label={`${project.name} 프로젝트 메뉴`} aria-expanded={openMenu === menuId} onClick={(event) => openMenuAt(menuId, event)}>•••</button>
                      {projectMenu(project, menuId)}
                    </div>
                  );
                })}
                {pinnedSessions.map((session) => {
                  const menuId = `pinned-session-${session.id}`;
                  return (
                    <div className="pinned-thread-row" key={menuId}>
                      <button
                        className="pinned-thread-link"
                        type="button"
                        onPointerEnter={() => warmSession(session.id)}
                        onFocus={() => warmSession(session.id)}
                        onClick={() => navigate(`/chat/${session.id}`)}
                      >
                        <span className="pinned-thread-icons"><PinIcon /><ChatIcon /></span>
                        <span className="thread-title-fade">{session.title}</span>
                      </button>
                      <button className="conversation-more" type="button" aria-label={`${session.title} 대화 메뉴`} aria-expanded={openMenu === menuId} onClick={(event) => openMenuAt(menuId, event)}>•••</button>
                      {sessionMenu(session, menuId)}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="sidebar-projects">
              <div className="sidebar-section-heading">
                <p>프로젝트</p>
                <button type="button" aria-label="프로젝트 만들기" onClick={() => creatingParentId === "root" ? setCreatingParentId(null) : startCreatingProject("root")}>＋</button>
              </div>
              {creatingParentId === "root" && projectCreateForm()}
              {visibleRootProjects.map((project) => projectNode(project))}
              {rootProjects.length > 3 && (
                <button className="project-more root-project-more" type="button" onClick={() => setShowAllRootProjects((current) => !current)}>
                  {showAllRootProjects ? "프로젝트 접기" : `프로젝트 더 보기 (${rootProjects.length - 3})`}
                </button>
              )}
            </div>

            <div className="conversation-list">
              <p>최근 대화</p>
              {visibleRecentUngrouped.map((session) => sessionRow(session))}
              {recentUngrouped.length > 3 && (
                <button className="project-more" type="button" onClick={() => setShowAllRecentSessions((current) => !current)}>
                  {showAllRecentSessions ? "대화 접기" : `대화 더 보기 (${recentUngrouped.length - 3})`}
                </button>
              )}
            </div>
          </div>
            <div className="sidebar-scrollbar" aria-hidden="true"><span /></div>
          </div>
          <ChatProfileMenu user={user} onLogout={onLogout} />
        </div>
      </aside>
    </>
  );
}
