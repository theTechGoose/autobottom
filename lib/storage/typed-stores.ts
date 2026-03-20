/**
 * Store accessor functions for review/judge queues.
 * DTOs live in ./dtos/; this file just wires them to TypedStore instances.
 */

import { TypedStore, initStores } from "./typed-kv.ts";
import type { ReviewItem, ReviewDecision } from "../../review/kv.ts";
import type { JudgeItem, JudgeDecision, AppealRecord } from "../../judge/kv.ts";
import {
  ReviewPending, ReviewDecisionDto,
  JudgePending, JudgeDecisionDto,
  AppealRecordDto, AuditTranscript,
} from "./dtos/mod.ts";

let _db: Deno.Kv | undefined;
let _stores: ReturnType<typeof initStores> | undefined;

async function getStore<T>(dto: new () => T): Promise<TypedStore<T>> {
  if (!_db) _db = await Deno.openKv(Deno.env.get("KV_URL") ?? undefined);
  if (!_stores) _stores = initStores(_db);
  return _stores(dto);
}

export async function reviewPendingStore(): Promise<TypedStore<ReviewItem>> {
  return await getStore(ReviewPending) as unknown as TypedStore<ReviewItem>;
}

export async function reviewDecisionStore(): Promise<TypedStore<ReviewDecision>> {
  return await getStore(ReviewDecisionDto) as unknown as TypedStore<ReviewDecision>;
}

export async function judgePendingStore(): Promise<TypedStore<JudgeItem>> {
  return await getStore(JudgePending) as unknown as TypedStore<JudgeItem>;
}

export async function judgeDecisionStore(): Promise<TypedStore<JudgeDecision>> {
  return await getStore(JudgeDecisionDto) as unknown as TypedStore<JudgeDecision>;
}

export async function appealRecordStore(): Promise<TypedStore<AppealRecord>> {
  return await getStore(AppealRecordDto) as unknown as TypedStore<AppealRecord>;
}

export async function auditTranscriptStore(): Promise<TypedStore<{ raw: string; diarized: string; utteranceTimes: number[] }>> {
  return await getStore(AuditTranscript);
}
