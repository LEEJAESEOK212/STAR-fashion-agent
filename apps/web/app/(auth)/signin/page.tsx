"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";

import { API_BASE_URL, apiRequest, invalidateApiCache } from "@/lib/api";

type AuthMode = "login" | "signup" | "master";
type AuthResponse = { message: string };

const socialProviders = [
  { id: "google", label: "Google로 계속하기", mark: "G" },
  { id: "kakao", label: "카카오로 계속하기", mark: "K" },
  { id: "naver", label: "네이버로 계속하기", mark: "N" },
] as const;

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInContent />
    </Suspense>
  );
}

function SignInContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<AuthMode>("login");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const displayedError = error ?? searchParams.get("oauth_error") ?? "";
  const requestedNextPath = searchParams.get("next") ?? "/chat";
  const safeNextPath = requestedNextPath.startsWith("/") && !requestedNextPath.startsWith("//")
    ? requestedNextPath
    : "/chat";
  const kakaoLoginUrl = `${API_BASE_URL}/auth/oauth/kakao?${new URLSearchParams({ next: safeNextPath })}`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    const form = new FormData(event.currentTarget);

    try {
      const endpoint = mode === "login"
        ? "/auth/login"
        : mode === "signup"
          ? "/auth/signup"
          : "/auth/master-login";
      const payload = mode === "login"
        ? { email: form.get("email"), password: form.get("password") }
        : mode === "signup"
          ? {
            display_name: form.get("displayName"),
            email: form.get("email"),
            password: form.get("password"),
            password_confirm: form.get("passwordConfirm"),
          }
          : { access_key: form.get("accessKey") };
      await apiRequest<AuthResponse>(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      invalidateApiCache();
      router.push(safeNextPath);
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "로그인에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handlePendingSocialLogin() {
    setError("기능 준비중입니다. 조금만 기다려주세요!");
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError("");
  }

  return (
    <main className="signin-page">
      <section className="signin-panel">
        <Link className="brand-lockup" href="/">
          <Image src="/star-mark-black.png" alt="" width={32} height={32} priority />
          <span>STAR</span>
        </Link>

        <div className="signin-content">
          <p className="eyebrow">WELCOME TO STAR</p>
          <h1>{mode === "login" ? "다시, 더 선명하게." : mode === "signup" ? "좋은 질문의 시작." : "키 하나로 바로 시작."}</h1>
          <p>{mode === "login" ? "로그인하고 이전 대화를 이어가세요." : mode === "signup" ? "계정을 만들고 첫 대화를 시작하세요." : "공유받은 마스터키를 입력하면 게스트로 입장합니다."}</p>

          <div className="auth-mode-tabs" role="tablist" aria-label="계정 방식">
            <button className={mode === "login" ? "active" : ""} type="button" role="tab" aria-selected={mode === "login"} onClick={() => changeMode("login")}>로그인</button>
            <button className={mode === "signup" ? "active" : ""} type="button" role="tab" aria-selected={mode === "signup"} onClick={() => changeMode("signup")}>회원가입</button>
            <button className={mode === "master" ? "active" : ""} type="button" role="tab" aria-selected={mode === "master"} onClick={() => changeMode("master")}>마스터키</button>
          </div>

          <form className="signin-form" onSubmit={handleSubmit}>
            {mode === "master" ? (
              <>
                <label htmlFor="accessKey">공용 마스터키</label>
                <input id="accessKey" name="accessKey" type="password" placeholder="공유받은 키를 입력하세요" autoComplete="off" minLength={12} required autoFocus />
                <p className="master-key-note">같은 키를 사용해도 대화 기록은 브라우저별로 분리됩니다.</p>
              </>
            ) : (
              <>
            {mode === "signup" && (
              <>
                <label htmlFor="displayName">이름</label>
                <input id="displayName" name="displayName" type="text" placeholder="어떻게 불러드릴까요?" autoComplete="name" required />
              </>
            )}
            <label htmlFor="email">이메일</label>
            <input id="email" name="email" type="email" placeholder="name@example.com" autoComplete="email" required />
            <div className="label-row">
              <label htmlFor="password">비밀번호</label>
              {mode === "login" && <button type="button" onClick={() => setError("비밀번호 재설정 메일 서비스 결정이 필요합니다. devel-QA.md를 확인해 주세요.")}>비밀번호 찾기</button>}
            </div>
            <input id="password" name="password" type="password" placeholder="8자 이상 입력하세요" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "signup" ? 8 : 1} required />
            {mode === "signup" && (
              <>
                <label htmlFor="passwordConfirm">비밀번호 확인</label>
                <input id="passwordConfirm" name="passwordConfirm" type="password" placeholder="비밀번호를 한 번 더 입력하세요" autoComplete="new-password" minLength={8} required />
              </>
            )}
              </>
            )}
            {displayedError && <p className="auth-error" role="alert">{displayedError}</p>}
            <button className="button signin-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "처리 중..." : mode === "login" ? "이메일로 로그인" : mode === "signup" ? "이메일로 회원가입" : "마스터키로 입장"}
            </button>
          </form>

          <div className="signin-divider"><span>소셜 계정으로 계속하기</span></div>
          <div className="social-login-list">
            {socialProviders.map((provider) => provider.id === "kakao" ? (
              <a className="social-button social-kakao" href={kakaoLoginUrl} key={provider.id}>
                <span aria-hidden="true">{provider.mark}</span>{provider.label}
              </a>
            ) : (
              <button className={`social-button social-${provider.id}`} type="button" key={provider.id} onClick={handlePendingSocialLogin}>
                <span aria-hidden="true">{provider.mark}</span>{provider.label}
              </button>
            ))}
          </div>
        </div>
        <p className="signin-legal">계속하면 이용약관과 개인정보 처리방침에 동의하게 됩니다.</p>
      </section>

      <aside className="signin-visual">
        <Image src="/다운로드 (1).jpg" alt="STAR 스케이트 룩북" fill priority loading="eager" sizes="(max-width: 820px) 0px, 50vw" />
        <div className="signin-quote">
          <p>FIND YOUR<br />NEXT PIECE.</p>
          <span>STAR / 01</span>
        </div>
      </aside>
    </main>
  );
}
