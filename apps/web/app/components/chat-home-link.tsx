import Link from "next/link";

export function ChatHomeLink() {
  return (
    <Link className="chat-home-link" href="/" aria-label="홈으로" title="홈으로">
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4.5 10.5 12 4l7.5 6.5v8.25a1.25 1.25 0 0 1-1.25 1.25H5.75a1.25 1.25 0 0 1-1.25-1.25z" />
        <path d="M9.25 20v-6h5.5v6" />
      </svg>
    </Link>
  );
}
