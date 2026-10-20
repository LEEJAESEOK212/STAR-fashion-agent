import { apiRequest } from "@/lib/api";
import type { ChatAttachment, PendingAttachment } from "@/lib/chat";

export async function uploadPendingAttachments(
  attachments: PendingAttachment[],
): Promise<ChatAttachment[]> {
  const uploaded: ChatAttachment[] = [];
  try {
    return await Promise.all(attachments.map(async (attachment) => {
      const body = new FormData();
      body.append("kind", attachment.kind);
      body.append("file", attachment.file);
      const result = await apiRequest<ChatAttachment>("/chat/attachments", { method: "POST", body });
      uploaded.push(result);
      return result;
    }));
  } catch (error) {
    await Promise.allSettled(
      uploaded.map((attachment) =>
        apiRequest<void>(`/chat/attachments/${attachment.id}`, { method: "DELETE" }),
      ),
    );
    throw error;
  }
}

export function releaseAttachmentPreviews(attachments: PendingAttachment[]) {
  for (const attachment of attachments) {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  }
}

export async function deleteUploadedAttachments(attachments: ChatAttachment[]) {
  await Promise.allSettled(
    attachments.map((attachment) =>
      apiRequest<void>(`/chat/attachments/${attachment.id}`, { method: "DELETE" }),
    ),
  );
}
