import type { AuditJob, AuditStub } from "../../../../dto/audit-job.ts";
import { nanoid } from "nanoid";

export class AuditJobService {
  createJob(
    owner: string,
    updateEndpoint: string,
    recordsToAudit: string[],
    customId?: string,
  ): AuditJob {
    return {
      id: customId ?? nanoid(),
      doneAuditIds: [],
      status: "pending",
      timestamp: new Date().toISOString(),
      owner,
      updateEndpoint,
      recordsToAudit,
    };
  }

  pickRecords(job: AuditJob, count = 0): string[] {
    const n = count === 0 ? job.recordsToAudit.length : count;
    const eligible = job.recordsToAudit.filter(
      (r) => !job.doneAuditIds.some((a) => a.auditRecord === r),
    );
    return eligible.slice(0, n);
  }

  markAuditDone(job: AuditJob, recordId: string, auditId: string): AuditJob {
    if (job.doneAuditIds.some((a) => a.auditId === auditId)) {
      throw new Error("Audit already done");
    }
    job.doneAuditIds.push({ auditId, auditRecord: recordId });
    if (job.doneAuditIds.length === job.recordsToAudit.length) {
      job.status = "finished";
    }
    return job;
  }
}

// Old API preserved as wrappers
const _svc = new AuditJobService();
export function createJob(
  ...args: Parameters<AuditJobService["createJob"]>
): AuditJob {
  return _svc.createJob(...args);
}
export function pickRecords(
  ...args: Parameters<AuditJobService["pickRecords"]>
): string[] {
  return _svc.pickRecords(...args);
}
export function markAuditDone(
  ...args: Parameters<AuditJobService["markAuditDone"]>
): AuditJob {
  return _svc.markAuditDone(...args);
}
