/**
 * Integration tests for quickbase/mod.ts.
 * Mocks fetch calls to the QuickBase API and verifies correct request
 * formatting, header construction, and response parsing.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { mockFetch, restoreFetch } from "../mock-fetch.ts";
import { queryRecords, getDateLegByRid, getQuestionsForDestination } from "./mod.ts";

// Required env vars
Deno.env.set("QB_REALM", "test-realm");
Deno.env.set("QB_USER_TOKEN", "test-qb-token");
Deno.env.set("QB_DATE_LEGS_TABLE", "tbl-date-legs");
Deno.env.set("QB_AUDIT_QUESTIONS_TABLE", "tbl-questions");
Deno.env.set("QB_AUDIT_QUESTIONS_DEST_FIELD", "11");
Deno.env.set("QB_AUDIT_QUESTIONS_LABEL_FIELD", "7");
Deno.env.set("QB_AUDIT_QUESTIONS_QUESTION_FIELD", "6");
Deno.env.set("QB_AUDIT_QUESTIONS_AUTOYES_FIELD", "14");

// ---------------------------------------------------------------------------
// queryRecords — sends correct request
// ---------------------------------------------------------------------------

Deno.test("queryRecords — sends correct headers and body to QuickBase API", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  mockFetch("api.quickbase.com/v1/records/query", (url, init) => {
    capturedUrl = url as string;
    capturedInit = init;
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  try {
    await queryRecords({
      tableId: "tbl-123",
      where: "{3.EX.'abc'}",
      select: [3, 6, 7],
    });

    assertEquals(capturedUrl, "https://api.quickbase.com/v1/records/query");
    assertEquals(capturedInit?.method, "POST");

    const headers = capturedInit?.headers as Record<string, string>;
    assertEquals(headers["QB-Realm-Hostname"], "test-realm.quickbase.com");
    assertEquals(headers["Authorization"], "QB-USER-TOKEN test-qb-token");
    assertEquals(headers["Content-Type"], "application/json");

    const body = JSON.parse(capturedInit?.body as string);
    assertEquals(body.from, "tbl-123");
    assertEquals(body.where, "{3.EX.'abc'}");
    assertEquals(body.select, [3, 6, 7]);
  } finally {
    restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// queryRecords — throws on non-ok response
// ---------------------------------------------------------------------------

Deno.test("queryRecords — throws on non-ok response", async () => {
  mockFetch("api.quickbase.com/v1/records/query", () => {
    return new Response("Unauthorized", { status: 401 });
  });

  try {
    await assertRejects(
      () =>
        queryRecords({
          tableId: "tbl-123",
          where: "{3.EX.'x'}",
          select: [3],
        }),
      Error,
      "QuickBase query failed: 401",
    );
  } finally {
    restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// getDateLegByRid — returns mapped record
// ---------------------------------------------------------------------------

Deno.test("getDateLegByRid — returns mapped field names from QB record", async () => {
  mockFetch("api.quickbase.com/v1/records/query", () => {
    return new Response(
      JSON.stringify({
        data: [
          {
            "3": { value: "RID-42" },
            "145": { value: "genie-url-here" },
            "292": { value: "dest-99" },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  try {
    const result = await getDateLegByRid("RID-42");
    assertEquals(result?.RecordId, "RID-42");
    assertEquals(result?.VoGenie, "genie-url-here");
    assertEquals(result?.RelatedDestinationId, "dest-99");
  } finally {
    restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// getDateLegByRid — returns null when no records
// ---------------------------------------------------------------------------

Deno.test("getDateLegByRid — returns null when no records found", async () => {
  mockFetch("api.quickbase.com/v1/records/query", () => {
    return new Response(
      JSON.stringify({ data: [] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  try {
    const result = await getDateLegByRid("nonexistent");
    assertEquals(result, null);
  } finally {
    restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// getQuestionsForDestination — returns mapped questions
// ---------------------------------------------------------------------------

Deno.test("getQuestionsForDestination — maps QB records to question objects", async () => {
  mockFetch("api.quickbase.com/v1/records/query", () => {
    return new Response(
      JSON.stringify({
        data: [
          {
            "7": { value: "Section A" },
            "6": { value: "Was the greeting correct?" },
            "14": { value: "true" },
          },
          {
            "7": { value: "Section B" },
            "6": { value: "Was hold time mentioned?" },
            "14": { value: "false" },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  try {
    const questions = await getQuestionsForDestination("dest-1");
    assertEquals(questions.length, 2);
    assertEquals(questions[0].header, "Section A");
    assertEquals(questions[0].question, "Was the greeting correct?");
    assertEquals(questions[0].autoYes, "true");
    assertEquals(questions[1].header, "Section B");
  } finally {
    restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// getQuestionsForDestination — empty destinationId returns []
// ---------------------------------------------------------------------------

Deno.test("getQuestionsForDestination — returns empty array for empty destinationId", async () => {
  // This should not make any fetch call
  const result = await getQuestionsForDestination("");
  assertEquals(result, []);
});
