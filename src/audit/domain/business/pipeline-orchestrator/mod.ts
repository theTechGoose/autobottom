/** Pipeline orchestrator — delegates to the original step implementations.
 *
 *  The audit pipeline steps (init, transcribe, finalize, etc.) are complex
 *  orchestration functions that interleave KV reads, external API calls,
 *  S3 uploads, queue enqueuing, and state transitions. Rather than
 *  rewriting all 12 steps from scratch, this module re-exports the
 *  original step functions from steps/*.ts. They use the original
 *  lib/kv.ts data layer which shares the same Deno KV instance.
 *
 *  As the refactor matures, individual steps can be migrated to use
 *  the new repository classes. The function signatures are identical
 *  (req: Request → Response), so the controller doesn't change.
 */

// Re-export original step handlers — these are the production implementations
export { stepInit } from "@audit/domain/business/pipeline-steps/init.ts";
export { stepTranscribe } from "@audit/domain/business/pipeline-steps/transcribe.ts";
export { stepTranscribeCb } from "@audit/domain/business/pipeline-steps/transcribe-cb.ts";
export { stepPollTranscript } from "@audit/domain/business/pipeline-steps/poll-transcript.ts";
export { stepDiarizeAsync } from "@audit/domain/business/pipeline-steps/diarize-async.ts";
export { stepPineconeAsync } from "@audit/domain/business/pipeline-steps/pinecone-async.ts";
export { stepPrepare } from "@audit/domain/business/pipeline-steps/prepare.ts";
export { stepAskBatch } from "@audit/domain/business/pipeline-steps/ask-batch.ts";
export { stepAskAll } from "@audit/domain/business/pipeline-steps/ask-all.ts";
export { stepFinalize } from "@audit/domain/business/pipeline-steps/finalize.ts";
export { stepCleanup } from "@audit/domain/business/pipeline-steps/cleanup.ts";
export { stepBadWordCheck } from "@audit/domain/business/pipeline-steps/bad-word-check.ts";
