/**
 * Smoke test for env/mod.ts.
 * Verifies the env export exists and exposes the expected getter properties.
 * Does NOT call the getters (env vars are not set in test).
 */

import { assert } from "@std/assert";
import { env } from "./mod.ts";

Deno.test("env — exports an object with expected property names", () => {
  const descriptor = Object.getOwnPropertyDescriptors(env);

  const expectedKeys = [
    "qstashUrl",
    "qstashToken",
    "qstashSigningKey",
    "awsAccessKeyId",
    "awsSecretAccessKey",
    "awsRegion",
    "s3Bucket",
    "assemblyaiKey",
    "groqKey",
    "openaiKey",
    "pineconeKey",
    "pineconeIndex",
    "qbRealm",
    "qbToken",
    "postmarkToken",
    "genieAuth",
    "genieAuthTwo",
    "genieBaseUrl",
    "geniePrimaryAccount",
    "genieSecondaryAccount",
    "selfUrl",
    "kvServiceUrl",
    "denoKvUrl",
    "alertEmail",
    "fromEmail",
  ];

  for (const key of expectedKeys) {
    assert(key in descriptor, `Missing property: ${key}`);
    assert(typeof descriptor[key].get === "function", `${key} should be a getter`);
  }
});
