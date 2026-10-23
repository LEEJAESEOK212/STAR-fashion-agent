"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  FormEvent,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

import { apiRequest } from "@/lib/api";

type AuthState = "checking" | "authenticated" | "anonymous";
type LandingAuthContextValue = {
  authState: AuthState;
  isLoggingOut: boolean;
  logout: () => Promise<void>;
  openChat: (prompt?: string) => void;
};

const LandingAuthContext = createContext<LandingAuthContextValue | null>(null);

export function ArrowUpRightIcon() {
  return (
    <svg className="hero-submit-arrow" aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}

function useLandingAuth() {
  const context = useContext(LandingAuthContext);
  if (!context) throw new Error("LandingAuthProvider가 필요합니다.");
  return context;
}

export function LandingAuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    let isActive = true;

    apiRequest("/auth/me")
      .then(() => {
        if (isActive) setAuthState("authenticated");
      })
      .catch(() => {
        if (isActive) setAuthState("anonymous");
      });

    return () => {
      isActive = false;
    };
  }, []);

  async function logout() {
    setIsLoggingOut(true);
    try {
      await apiRequest<void>("/auth/logout", { method: "POST" });
      setAuthState("anonymous");
      router.refresh();
    } finally {
      setIsLoggingOut(false);
    }
  }

  function openChat(prompt?: string) {
    if (authState === "checking") return;
    const normalizedPrompt = prompt?.trim();
    const chatPath = normalizedPrompt
      ? `/chat?prompt=${encodeURIComponent(normalizedPrompt)}`
      : "/chat";
    router.push(chatPath);
  }

  return (
    <LandingAuthContext.Provider value={{ authState, isLoggingOut, logout, openChat }}>
      {children}
    </LandingAuthContext.Provider>
  );
}

export function LandingAuthActions() {
  const { authState, isLoggingOut, logout, openChat } = useLandingAuth();

  return (
    <div className="nav-actions">
      {authState === "checking" ? (
        <button className="login-button" type="button" disabled aria-label="로그인 상태 확인 중">
          확인 중
        </button>
      ) : authState === "authenticated" ? (
        <button className="login-button" type="button" onClick={logout} disabled={isLoggingOut}>
          {isLoggingOut ? "로그아웃 중" : "로그아웃"}
        </button>
      ) : (
        <Link className="login-button" href="/signin">Sign in</Link>
      )}
      <button
        className="button button-small"
        type="button"
        onClick={() => openChat()}
        disabled={authState === "checking"}
      >
        Chat
      </button>
    </div>
  );
}

export function LandingPromptComposer({ prompts }: { prompts: readonly string[] }) {
  const { authState, openChat } = useLandingAuth();
  const [prompt, setPrompt] = useState("");
  const isChecking = authState === "checking";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (prompt.trim()) openChat(prompt);
  }

  return (
    <>
      <form className="hero-composer" onSubmit={handleSubmit}>
        <Image src="/star-mark-black.png" alt="" width={23} height={23} />
        <input
          aria-label="질문"
          placeholder="Search"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          disabled={isChecking}
          required
        />
        <button type="submit" disabled={isChecking} aria-label="검색하고 대화 시작하기">
          <ArrowUpRightIcon />
        </button>
      </form>
      <div className="prompt-list" aria-label="추천 질문">
        {prompts.map((suggestedPrompt) => (
          <button
            type="button"
            key={suggestedPrompt}
            onClick={() => openChat(suggestedPrompt)}
            disabled={isChecking}
          >
            {suggestedPrompt}
          </button>
        ))}
      </div>
    </>
  );
}

export function LandingStartButton() {
  const { authState, openChat } = useLandingAuth();
  return (
    <button className="button" type="button" onClick={() => openChat()} disabled={authState === "checking"}>
      STAR 시작하기
    </button>
  );
}

export function LandingFooterAuthAction() {
  const { authState, isLoggingOut, logout } = useLandingAuth();
  if (authState === "checking") return <span>Checking</span>;
  if (authState === "anonymous") return <Link href="/signin">Sign in</Link>;
  return (
    <button type="button" onClick={logout} disabled={isLoggingOut}>
      {isLoggingOut ? "Signing out" : "Sign out"}
    </button>
  );
}
