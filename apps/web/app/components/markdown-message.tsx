"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownMessageProps = {
  content: string;
  isStreaming?: boolean;
};

export function MarkdownMessage({ content, isStreaming = false }: MarkdownMessageProps) {
  if (!content) {
    return (
      <p className="markdown-placeholder">
        답변을 준비하고 있습니다…
        {isStreaming && <span className="streaming-cursor" aria-hidden="true" />}
      </p>
    );
  }

  return (
    <div className={`markdown-content ${isStreaming ? "streaming" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener">{children}</a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      {isStreaming && <span className="streaming-cursor" aria-hidden="true" />}
    </div>
  );
}
