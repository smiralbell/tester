export type QaContextInventoryEntry = {
  index: number;
  description: string;
  fileName?: string;
  mimeType?: string;
  textExpandedInPrompt: boolean;
  binaryAttachmentNote: boolean;
};

export type QaContextInventory = {
  format: "bundle" | "plain" | "empty";
  entries: QaContextInventoryEntry[];
  plainPreview?: string;
};

export type QaKnowledgePreviewResponse = {
  projectId: string;
  documentation: {
    asPromptText: string;
    truncated: boolean;
    inventory: QaContextInventory;
  };
  instructions: {
    asPromptText: string;
    truncated: boolean;
    inventory: QaContextInventory;
  };
  meta: {
    explanation: string;
  };
};
