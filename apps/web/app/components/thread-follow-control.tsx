"use client";

import { SendArrowUpIcon } from "@/app/components/chat-composer";

type ThreadFollowControlProps = {
  generating: boolean;
  onClick: () => void;
  visible: boolean;
};

export function ThreadFollowControl({ generating, onClick, visible }: ThreadFollowControlProps) {
  if (!visible) return null;

  return (
    <button
      className={`thread-follow-control ${generating ? "is-generating" : "is-complete"}`}
      type="button"
      aria-label={generating ? "생성 중인 답변으로 이동" : "대화 맨 아래로 이동"}
      title={generating ? "생성 중인 답변으로 이동" : "맨 아래로 이동"}
      onClick={onClick}
    >
      {generating ? (
        <>
          <span className="thread-follow-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="thread-follow-arrow thread-follow-hover-arrow" aria-hidden="true">
            <SendArrowUpIcon />
          </span>
        </>
      ) : (
        <span className="thread-follow-arrow" aria-hidden="true"><SendArrowUpIcon /></span>
      )}
    </button>
  );
}
