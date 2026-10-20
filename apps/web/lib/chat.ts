export type ChatMessage = {
  id: string;
  user_id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  attachments: ChatAttachment[];
};

export type ChatAttachment = {
  id: string;
  kind: "image" | "file";
  original_filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  content_url: string;
};

export type PendingAttachment = {
  localId: string;
  file: File;
  kind: "image" | "file";
  previewUrl?: string;
};

export type ChatSessionSummary = {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
};

export type ChatProject = {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
};

export type ChatSessionDetail = ChatSessionSummary & {
  messages: ChatMessage[];
};

export type ChatGeneration = {
  session_id: string;
  session_title: string;
  input: ChatMessage;
  output: ChatMessage;
};

export type AuthUser = {
  display_name: string;
  email: string | null;
};
