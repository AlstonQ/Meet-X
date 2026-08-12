export type AiGatewayPolicy = {
  organizationId: string;
  redactBeforeProvider: true;
  requireZeroRetention: boolean;
  requireCitations: true;
};

// TODO(phase-2): Implement provider routing, redaction, prompt versioning, schema repair, and token accounting. Tracking: docs/roadmap.md#phase-2--transcription-and-summarisation
