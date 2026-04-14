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
export { stepInit } from "../pipeline-steps/init.ts";
export { stepTranscribe } from "../pipeline-steps/transcribe.ts";
export { stepTranscribeCb } from "../pipeline-steps/transcribe-cb.ts";
export { stepPollTranscript } from "../pipeline-steps/poll-transcript.ts";
export { stepDiarizeAsync } from "../pipeline-steps/diarize-async.ts";
export { stepPineconeAsync } from "../pipeline-steps/pinecone-async.ts";
export { stepPrepare } from "../pipeline-steps/prepare.ts";
export { stepAskBatch } from "../pipeline-steps/ask-batch.ts";
export { stepAskAll } from "../pipeline-steps/ask-all.ts";
export { stepFinalize } from "../pipeline-steps/finalize.ts";
export { stepCleanup } from "../pipeline-steps/cleanup.ts";
export { stepBadWordCheck } from "../pipeline-steps/bad-word-check.ts";
