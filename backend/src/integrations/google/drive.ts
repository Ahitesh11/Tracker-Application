// Metadata contract only. Attachments are not uploaded or downloaded in Phase 1.
export interface AttachmentReference { fileId: string; name: string; mimeType: string; }
export interface AttachmentStore { getMetadata(fileId: string): Promise<AttachmentReference>; }