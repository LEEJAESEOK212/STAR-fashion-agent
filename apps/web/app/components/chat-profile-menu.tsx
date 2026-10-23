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
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [menuNotice, setMenuNotice] = useState("");

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        setIsSettingsOpen(false);
        setIsHelpOpen(false);
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

  async function handleInvite() {
    const shareData = {
      title: "STAR",
      text: "사진 한 장으로 제품 정보와 시세를 찾아보세요.",
      url: window.location.origin,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        setMenuNotice("공유 창을 열었습니다.");
      } else {
        await navigator.clipboard.writeText(shareData.url);
        setMenuNotice("초대 링크를 복사했습니다.");
      }
    } catch {
      setMenuNotice("");
    }
  }

  return (
    <div className="profile-control rail-profile-control" ref={containerRef}>
      {isOpen && (
        <div className="profile-menu rail-profile-menu" role="menu" aria-label="계정 메뉴">
          <div className="profile-menu-account">
            <span className="profile-avatar profile-avatar-large">
              <Image src="/star-mark-black.png" alt="기본 프로필" width={34} height={34} />
            </span>
            <span>
              <strong>{user?.display_name ?? "게스트"}</strong>
              <small>{user?.email ?? "로그인하지 않음"}</small>
            </span>
          </div>
          <button type="button" role="menuitem" onClick={() => void handleInvite()}>
            친구 초대
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              setIsSettingsOpen(true);
            }}
          >
            설정
          </button>
          <div className="profile-menu-separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              setIsHelpOpen(true);
            }}
          >
            도움말
          </button>
          <button
            className="profile-menu-logout"
            type="button"
            role="menuitem"
            onClick={() => void handleLogout()}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? "처리 중" : user ? "로그아웃" : "로그인"}
          </button>
          {menuNotice && <p className="profile-menu-notice" role="status">{menuNotice}</p>}
        </div>
      )}

      <button
        className="rail-profile-trigger"
        type="button"
        aria-label="계정 메뉴 열기"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="profile-avatar">
          <Image src="/star-mark-black.png" alt="기본 프로필" width={30} height={30} />
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
                <strong>{user?.display_name ?? "게스트"}</strong>
                <span>{user?.email ?? "로그인하면 대화를 계속 보관할 수 있습니다."}</span>
              </div>
            </div>
            <dl className="settings-detail-list">
              <div><dt>표시 이름</dt><dd>{user?.display_name ?? "게스트"}</dd></div>
              <div><dt>이메일</dt><dd>{user?.email ?? "로그인하지 않음"}</dd></div>
              <div><dt>응답 언어</dt><dd>한국어</dd></div>
            </dl>
            <p className="settings-note">프로필 편집과 대화 환경 설정은 다음 단계에서 연결할 수 있습니다.</p>
          </section>
        </div>
      )}
      {isHelpOpen && (
        <div className="settings-modal-backdrop" role="presentation" onMouseDown={() => setIsHelpOpen(false)}>
          <section
            className="settings-modal profile-help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="settings-modal-heading">
              <div><p>SUPPORT</p><h2 id="help-title">도움말</h2></div>
              <button type="button" onClick={() => setIsHelpOpen(false)}>닫기</button>
            </div>
            <p className="settings-note">사진이나 파일을 첨부한 뒤 제품 정보, 유사 상품 또는 시세를 질문해 보세요. 비로그인 대화는 탭을 닫으면 사라지며 3턴까지 이용할 수 있습니다.</p>
          </section>
        </div>
      )}
    </div>
  );
}
