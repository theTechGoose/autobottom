import type { AuditFinding, FeedbackCardData } from "../../../../dto/audit-finding.ts";
import type { AuditJob } from "../../../../dto/audit-job.ts";
import { nanoid } from "nanoid";

export class AuditFindingService {
  createFinding(
    job: AuditJob,
    record: Record<string, unknown>,
    recordingIdField: string,
    customId?: string,
  ): AuditFinding {
    const id = customId ?? nanoid();
    const recordingId = record[recordingIdField]
      ? String(record[recordingIdField])
      : undefined;

    return {
      id,
      auditJobId: job.id,
      findingStatus: "pending",
      feedback: {} as FeedbackCardData,
      job,
      record,
      recordingIdField,
      recordingId,
      owner: job.owner,
      updateEndpoint: job.updateEndpoint,
    };
  }
}

// Old API preserved as wrapper
const _svc = new AuditFindingService();
export function createFinding(
  ...args: Parameters<AuditFindingService["createFinding"]>
): AuditFinding {
  return _svc.createFinding(...args);
}
