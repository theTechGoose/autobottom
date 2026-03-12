/** DTOs for pipeline stats and tracking. */

export class ActiveTracking {
  findingId = "";
  step = "";
  ts = 0;
  recordId?: string;
  isPackage?: boolean;
  startedAt?: number;
  genieRetryAt?: number;
  genieAttempts?: number;
}

export class WatchdogActive {
  orgId = "";
  findingId = "";
  step = "";
  ts = 0;
}

export class CompletedAuditStat {
  findingId = "";
  ts = 0;
  recordId?: string;
  isPackage?: boolean;
  startedAt?: number;
  durationMs?: number;
  score?: number;
  owner?: string;
  department?: string;
}

export class ErrorTracking {
  findingId = "";
  step = "";
  error = "";
  ts = 0;
}

export class RetryTracking {
  findingId = "";
  step = "";
  attempt = 0;
  ts = 0;
}
