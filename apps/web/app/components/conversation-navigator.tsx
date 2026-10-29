"use client";

import { CSSProperties, RefObject, useEffect, useMemo, useState } from "react";

import type { ChatMessage } from "@/lib/chat";

type ConversationNavigatorProps = {
  messages: ChatMessage[];
  viewportRef: RefObject<HTMLDivElement | null>;
  onNavigateStart?: () => void;
};

type QuestionItem = {
  id: string;
  title: string;
  summary: string;
  number: number;
};

const MINIMUM_QUESTION_COUNT = 5;

function cleanPreviewText(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[\s>*#-]+/gm, "")
    .replace(/[*_~`|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactPreview(value: string, limit: number, fallback: string) {
  const cleaned = cleanPreviewText(value);
  if (!cleaned) return fallback;
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit).trimEnd()}…`;
}

export function ConversationNavigator({ messages, viewportRef, onNavigateStart }: ConversationNavigatorProps) {
  const questions = useMemo<QuestionItem[]>(() => {
    const result: QuestionItem[] = [];

    messages.forEach((message, messageIndex) => {
      if (message.role !== "user") return;
      const response = messages.slice(messageIndex + 1).find((candidate) => candidate.role === "assistant");
      result.push({
        id: message.id,
        number: result.length + 1,
        title: compactPreview(message.content, 42, message.attachments.length ? "첨부파일 질문" : "질문"),
        summary: response
          ? compactPreview(response.content, 122, "답변을 생성하고 있습니다.")
          : "아직 답변이 없습니다.",
      });
    });

    return result;
  }, [messages]);

  const questionKey = questions.map((question) => question.id).join("|");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    if (questions.length < MINIMUM_QUESTION_COUNT) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    const questionIds = questionKey.split("|").filter(Boolean);
    let animationFrame: number | null = null;

    const update = () => {
      animationFrame = null;
      const viewportRect = viewport.getBoundingClientRect();
      const viewportFocusY = viewportRect.top + Math.min(viewportRect.height * 0.34, 280);
      let nextActiveId: string | null = questionIds[0] ?? null;
      let closestDistance = Number.POSITIVE_INFINITY;

      questionIds.forEach((questionId) => {
        const row = viewport.querySelector<HTMLElement>(`[data-question-id="${CSS.escape(questionId)}"]`);
        if (!row) return;
        const rowRect = row.getBoundingClientRect();
        const distance = Math.abs(rowRect.top - viewportFocusY);
        if (distance < closestDistance) {
          closestDistance = distance;
          nextActiveId = questionId;
        }
      });

      setActiveId((current) => current === nextActiveId ? current : nextActiveId);
    };

    const scheduleUpdate = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(update);
    };

    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(viewport);
    if (viewport.firstElementChild) resizeObserver.observe(viewport.firstElementChild);
    viewport.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    update();

    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      viewport.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [questionKey, questions.length, viewportRef]);

  if (questions.length < MINIMUM_QUESTION_COUNT) return null;

  const hoveredQuestion = hoveredIndex === null ? null : questions[hoveredIndex];
  const centeredGap = Math.min(1.8, 56 / Math.max(1, questions.length - 1));

  function centeredPosition(index: number) {
    return 50 + (index - (questions.length - 1) / 2) * centeredGap;
  }

  function navigateToQuestion(questionId: string) {
    const viewport = viewportRef.current;
    const row = viewport?.querySelector<HTMLElement>(`[data-question-id="${CSS.escape(questionId)}"]`);
    if (!viewport || !row) return;
    const viewportRect = viewport.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const targetTop = viewport.scrollTop + rowRect.top - viewportRect.top - 24;
    onNavigateStart?.();
    viewport.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
  }

  return (
    <nav className="conversation-navigator" aria-label="대화 질문 탐색">
      <div className="conversation-navigator-track">
        {questions.map((question, index) => {
          const distance = hoveredIndex === null ? Number.POSITIVE_INFINITY : Math.abs(index - hoveredIndex);
          const width = distance === 0 ? 28 : distance === 1 ? 20 : distance === 2 ? 12 : 7;
          const isActive = hoveredIndex === null && activeId === question.id;
          const isHovered = hoveredIndex === index;
          const style = {
            "--conversation-tick-top": `${centeredPosition(index)}%`,
            "--conversation-tick-width": `${width}px`,
          } as CSSProperties;

          return (
            <button
              className={`conversation-navigator-tick ${isActive ? "is-active" : ""} ${isHovered ? "is-hovered" : ""}`}
              style={style}
              type="button"
              aria-label={`${question.number}번째 질문: ${question.title}`}
              onPointerEnter={() => setHoveredIndex(index)}
              onFocus={() => setHoveredIndex(index)}
              onPointerLeave={() => setHoveredIndex(null)}
              onBlur={() => setHoveredIndex(null)}
              onClick={() => navigateToQuestion(question.id)}
              key={question.id}
            >
              <span aria-hidden="true" />
            </button>
          );
        })}
      </div>

      {hoveredQuestion && (
        <aside
          className="conversation-navigator-preview"
          style={{
            "--conversation-preview-top": `${centeredPosition(hoveredQuestion.number - 1)}%`,
          } as CSSProperties}
          aria-live="polite"
        >
          <strong>{hoveredQuestion.title}</strong>
          <small>질문 {hoveredQuestion.number}</small>
          <p>{hoveredQuestion.summary}</p>
        </aside>
      )}
    </nav>
  );
}
