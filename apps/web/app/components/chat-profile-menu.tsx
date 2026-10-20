"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import type { AuthUser } from "@/lib/chat";

type ChatProfileMenuProps = {
  user: AuthUser | null;
  onLogout: () => Promise<void>;
};

export function ChatProfileMenu({ user, onLogout }: ChatProfileMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        setIsSettingsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  async function handleLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await onLogout();
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="profile-control" ref={containerRef}>
      {isOpen && (
        <div className="profile-menu" role="menu" aria-label="계정 메뉴">
          <div className="profile-menu-account">
            <span className="profile-avatar profile-avatar-large">
              <Image src="/star-mark-black.png" alt="기본 프로필" width={34} height={34} />
            </span>
            <span>
              <strong>{user?.display_name ?? "계정 확인 중"}</strong>
              <small>{user?.email ?? "STAR 계정"}</small>
            </span>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              setIsSettingsOpen(true);
            }}
          >
            내 정보 및 설정
          </button>
          <button
            className="profile-menu-logout"
            type="button"
            role="menuitem"
            onClick={() => void handleLogout()}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? "로그아웃 중" : "로그아웃"}
          </button>
        </div>
      )}

      <button
        className="sidebar-profile"
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="profile-avatar">
          <Image src="/star-mark-black.png" alt="기본 프로필" width={30} height={30} />
        </span>
        <span className="profile-summary">
          <strong>{user?.display_name ?? "계정 확인 중"}</strong>
          <small>{user?.email ?? "불러오는 중"}</small>
        </span>
      </button>

      {isSettingsOpen && (
        <div className="settings-modal-backdrop" role="presentation" onMouseDown={() => setIsSettingsOpen(false)}>
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="settings-modal-heading">
              <div>
                <p>계정</p>
                <h2 id="settings-title">내 정보 및 설정</h2>
              </div>
              <button type="button" onClick={() => setIsSettingsOpen(false)}>닫기</button>
            </div>
            <div className="settings-profile">
              <span className="profile-avatar settings-avatar">
                <Image src="/star-mark-black.png" alt="기본 프로필" width={48} height={48} />
              </span>
              <div>
                <strong>{user?.display_name ?? "계정 확인 중"}</strong>
                <span>{user?.email ?? "등록된 이메일이 없습니다."}</span>
              </div>
            </div>
            <dl className="settings-detail-list">
              <div><dt>표시 이름</dt><dd>{user?.display_name ?? "-"}</dd></div>
              <div><dt>이메일</dt><dd>{user?.email ?? "등록되지 않음"}</dd></div>
              <div><dt>응답 언어</dt><dd>한국어</dd></div>
            </dl>
            <p className="settings-note">프로필 편집과 대화 환경 설정은 다음 단계에서 연결할 수 있습니다.</p>
          </section>
        </div>
      )}
    </div>
  );
}
