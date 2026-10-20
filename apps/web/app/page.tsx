import Image from "next/image";
import Link from "next/link";

import {
  LandingAuthActions,
  LandingAuthProvider,
  LandingFooterAuthAction,
  LandingPromptComposer,
} from "@/app/components/landing-auth-actions";

const lookbook = [
  { src: "/Justin Bieber.jpg", alt: "네이비 스웨트셔츠와 데님 룩", className: "look-justin" },
  { src: "/Ye 3.jpg", alt: "퍼플 후디와 워시드 데님 룩", className: "look-ye" },
  { src: "/다운로드 (2).jpg", alt: "레이어드 티셔츠와 카고 팬츠 룩", className: "look-pitt" },
  { src: "/Travis Scott.jpg", alt: "브라운 반다나 스트리트웨어 룩", className: "look-travis-seat" },
  { src: "/다운로드 (6).jpg", alt: "빈티지 리바이스 라벨 디테일", className: "look-levis" },
  { src: "/다운로드 (3).jpg", alt: "브라운 레이어드 빈티지 룩", className: "look-travis-walk" },
  { src: "/다운로드 (1).jpg", alt: "야간 스케이트보드 룩", className: "look-night-skate" },
  { src: "/Ye 3.jpg", alt: "퍼플 후디 스타일 디테일", className: "look-ye-detail" },
  { src: "/Skate.jpg", alt: "블루 스타 티셔츠 스케이트 룩", className: "look-day-skate" },
  { src: "/다운로드.jpg", alt: "워시드 워크 재킷 룩", className: "look-workwear" },
  { src: "/다운로드 (4).jpg", alt: "그레이 후디와 카고 팬츠 룩", className: "look-grey" },
  { src: "/다운로드 (5).jpg", alt: "오렌지 티셔츠와 카고 팬츠 룩", className: "look-orange" },
] as const;

export default function LandingPage() {
  return (
    <LandingAuthProvider>
      <main className="star-landing">
        <section className="star-hero" id="explore">
          <Image
            className="star-hero-photo"
            src="/star-hero.jpg"
            alt="야간 스케이트보드 스트리트웨어 룩"
            fill
            priority
            loading="eager"
            sizes="100vw"
          />
          <div className="star-hero-shade" />

          <header className="star-nav">
            <Link className="star-lockup star-lockup-light" href="/" aria-label="STAR 홈">
              <Image src="/star-mark-black.png" alt="" width={34} height={34} priority />
              <span>STAR</span>
            </Link>
            <nav aria-label="주요 메뉴">
              <a href="#explore">Explore</a>
              <a href="#archive">Archive</a>
              <Link href="/chat">Chat</Link>
            </nav>
            <LandingAuthActions />
          </header>

          <div className="star-hero-copy">
            <h1>STAR</h1>
            <LandingPromptComposer prompts={[]} />
            <div className="star-hero-index" aria-hidden="true">
              <span>EXPLORE</span>
              <span>ARCHIVE</span>
              <span>CHAT</span>
            </div>
          </div>

          <div className="star-hero-footer">
            <span>STAR</span>
            <span>01</span>
          </div>
        </section>

        <section className="star-archive" id="archive">
          <header className="star-section-head">
            <p>ARCHIVE / 01</p>
            <h2>LOOKBOOK</h2>
          </header>
          <div className="star-lookbook">
            {lookbook.map((image, index) => (
              <figure className={`star-look ${image.className}`} key={`${image.src}-${index}`}>
                <Image src={image.src} alt={image.alt} fill sizes="(max-width: 760px) 100vw, 50vw" />
                <figcaption>{String(index + 1).padStart(2, "0")}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="star-entry">
          <div className="star-entry-mark">
            <Image src="/star-mark-black.png" alt="" width={88} height={88} />
          </div>
          <h2>ASK<br />STAR</h2>
          <Link className="star-entry-link" href="/chat">Enter chat <span className="star-entry-arrow"><Image src="/star-arrow-icon-v2.png" alt="" width={21} height={21} /></span></Link>
        </section>

        <footer className="star-footer">
          <Link className="star-lockup" href="/">
            <Image src="/star-mark-black.png" alt="" width={30} height={30} />
            <span>STAR</span>
          </Link>
          <span>Fashion intelligence.</span>
          <div><LandingFooterAuthAction /><Link href="/chat">Chat</Link></div>
          <small>© 2026 STAR</small>
        </footer>
      </main>
    </LandingAuthProvider>
  );
}
