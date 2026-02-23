/** Centralized environment variable access. Throws on missing required vars. */

function required(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  // QStash
  get qstashUrl() { return required("QSTASH_URL"); },
  get qstashToken() { return required("QSTASH_TOKEN"); },
  get qstashSigningKey() { return Deno.env.get("QSTASH_CURRENT_SIGNING_KEY") ?? ""; },

  // AWS S3
  get awsAccessKeyId() { return required("AWS_ACCESS_KEY_ID"); },
  get awsSecretAccessKey() { return required("AWS_SECRET_ACCESS_KEY"); },
  get awsRegion() { return Deno.env.get("AWS_REGION") ?? "us-east-1"; },
  get s3Bucket() { return Deno.env.get("S3_BUCKET") ?? "dooks-recordings"; },

  // AssemblyAI
  get assemblyaiKey() { return required("ASSEMBLYAI_API_KEY"); },

  // Groq
  get groqKey() { return required("GROQ_API_KEY"); },

  // OpenAI (embeddings)
  get openaiKey() { return required("OPEN_AI_KEY"); },

  // Pinecone
  get pineconeKey() { return required("PINECONE_DB_KEY"); },
  get pineconeIndex() { return Deno.env.get("PINECONE_INDEX") ?? "auto-bot"; },

  // QuickBase
  get qbRealm() { return required("QB_REALM"); },
  get qbToken() { return required("QB_USER_TOKEN"); },

  // Postmark
  get postmarkToken() { return required("POSTMARK_SERVER"); },

  // Genie (dual account auth)
  get genieAuth() { return required("GENIE_AUTH"); },
  get genieAuthTwo() { return required("GENIE_AUTH_TWO"); },

  // App
  get selfUrl() { return Deno.env.get("SELF_URL") ?? "https://auto-bot-serverless.deno.dev"; },
  get kvServiceUrl() { return Deno.env.get("KV_SERVICE_URL") ?? "https://google-sheets-kv.thetechgoose.deno.net"; },
  get denoKvUrl() { return Deno.env.get("DENO_KV_URL") ?? "https://ai-audits.thetechgoose.deno.net"; },
};
