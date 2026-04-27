/** Question Lab controller — wired to real question repository. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, BodyType } from "#danet/swagger-decorators";
import { OkResponse, OkMessageResponse, MessageResponse, QLConfigListResponse, QLConfigResponse, QLQuestionResponse, QLQuestionNamesResponse, BulkUpdateResponse, QLAssignmentsResponse, SoundPackListResponse, GamificationSettingsResponse, StoreItemListResponse, PurchaseResponse, BadgeListResponse, UnreadCountResponse, ConversationListResponse, UserListResponse, MessageSentResponse, EventsResponse, WeeklyDataResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest, CreateConfigRequest, IdRequest, CreateQuestionRequest, RestoreVersionRequest, BulkEgregiousRequest, CreateTestRequest, AssignmentRequest } from "@core/dto/requests.ts";
import * as repo from "@question-lab/domain/data/question-repository/mod.ts";

import { defaultOrgId } from "@core/business/auth/mod.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Question Lab — audit question configuration, editing, testing")
@Controller("api")
export class QuestionLabController {

  @Get("qlab/configs") @ReturnedType(QLConfigListResponse)
  async listConfigs() { return { configs: await repo.listConfigs(ORG()) }; }

  @Post("qlab/configs") @ReturnedType(QLConfigResponse) @BodyType(CreateConfigRequest)
  async createConfig(@Body() body: { name: string; type?: string }) {
    return repo.createConfig(ORG(), body.name, (body.type as "internal" | "partner") ?? "internal");
  }

  @Post("qlab/configs/update") @ReturnedType(QLConfigResponse) @BodyType(GenericBodyRequest)
  async updateConfig(@Body() body: any) {
    const { id, ...patch } = body;
    return (await repo.updateConfig(ORG(), id, patch)) ?? { error: "not found" };
  }

  @Post("qlab/configs/delete") @ReturnedType(OkResponse) @BodyType(IdRequest)
  async deleteConfig(@Body() body: { id: string }) { await repo.deleteConfig(ORG(), body.id); return { ok: true }; }

  @Post("qlab/configs/clone") @ReturnedType(QLConfigResponse) @BodyType(IdRequest)
  async cloneConfig(@Body() body: { id: string }) {
    const src = await repo.getConfig(ORG(), body.id);
    if (!src) return { error: "not found" };
    const clone = await repo.createConfig(ORG(), `${src.name} (copy)`, src.type);
    const questions = await repo.getQuestionsForConfig(ORG(), body.id);
    for (const q of questions) await repo.createQuestion(ORG(), clone.id, q.name, q.text);
    return clone;
  }

  @Post("qlab/configs/import") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async importConfig(@Body() body: any) {
    const { name, type, questions, dupeMode = "skip" } = body;
    if (!name || !Array.isArray(questions)) return { error: "name and questions required" };
    const configs = await repo.listConfigs(ORG());
    const existing = configs.find((c) => c.name === name);
    if (existing && dupeMode === "skip") return { ok: true, skipped: true, configName: name };
    const config = existing && dupeMode === "overwrite"
      ? existing
      : await repo.createConfig(ORG(), name, type ?? "internal");
    let imported = 0;
    for (const q of questions) {
      await repo.createQuestion(ORG(), config.id, q.name, q.text);
      imported++;
    }
    return { ok: true, configId: config.id, imported };
  }

  @Get("qlab/question") @ReturnedType(QLQuestionResponse)
  async getQuestion(@Query("id") id: string) { return (await repo.getQuestion(ORG(), id)) ?? { error: "not found" }; }

  @Post("qlab/questions") @ReturnedType(QLQuestionResponse) @BodyType(CreateQuestionRequest)
  async createQuestion(@Body() body: { configId: string; name: string; text: string }) {
    return repo.createQuestion(ORG(), body.configId, body.name, body.text);
  }

  @Post("qlab/questions/update") @ReturnedType(QLQuestionResponse) @BodyType(GenericBodyRequest)
  async updateQuestion(@Body() body: any) {
    const { id, ...patch } = body;
    return (await repo.updateQuestion(ORG(), id, patch)) ?? { error: "not found" };
  }

  @Post("qlab/questions/delete") @ReturnedType(OkResponse) @BodyType(IdRequest)
  async deleteQuestion(@Body() body: { id: string }) { await repo.deleteQuestion(ORG(), body.id); return { ok: true }; }

  @Post("qlab/questions/restore") @ReturnedType(QLQuestionResponse) @BodyType(RestoreVersionRequest)
  async restoreVersion(@Body() body: { id: string; versionIndex: number }) {
    return (await repo.restoreVersion(ORG(), body.id, body.versionIndex)) ?? { error: "not found" };
  }

  @Get("qlab/question-names") @ReturnedType(QLQuestionNamesResponse)
  async getQuestionNames() { return { names: await repo.getAllQuestionNames(ORG()) }; }

  @Post("qlab/questions/bulk-egregious") @ReturnedType(BulkUpdateResponse) @BodyType(BulkEgregiousRequest)
  async bulkSetEgregious(@Body() body: { name: string; egregious: boolean }) {
    const count = await repo.bulkSetEgregious(ORG(), body.name, body.egregious);
    return { ok: true, updated: count };
  }

  @Post("qlab/tests") @ReturnedType(OkResponse) @BodyType(CreateTestRequest)
  async createTest(@Body() body: { questionId: string; input: string; expectedAnswer: string }) {
    return repo.createTest(ORG(), body.questionId, body.input, body.expectedAnswer);
  }

  @Post("qlab/tests/update") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async updateTest(@Body() body: any) {
    const { id, result, answer, thinking, defense, configId, questionId } = body ?? {};
    if (!result || (result !== "pass" && result !== "fail")) {
      return { error: "result must be 'pass' or 'fail'" };
    }
    let resolvedConfigId = configId as string | undefined;
    let resolvedQuestionId = questionId as string | undefined;
    let expectedAnswer = "";
    if (id) {
      const tests = await repo.getTestsForQuestion(ORG(), resolvedQuestionId ?? "");
      const t = tests.find((x) => x.id === id);
      if (t) {
        resolvedQuestionId = t.questionId;
        expectedAnswer = t.expectedAnswer;
      }
    }
    if (!resolvedQuestionId) return { error: "questionId required" };
    if (!resolvedConfigId) {
      const q = await repo.getQuestion(ORG(), resolvedQuestionId);
      if (!q) return { error: "question not found" };
      resolvedConfigId = q.configId;
    }
    const run = await repo.addTestRun(ORG(), {
      testId: id,
      configId: resolvedConfigId!,
      questionId: resolvedQuestionId,
      result,
      expectedAnswer,
      actualAnswer: String(answer ?? ""),
      thinking: thinking ? String(thinking) : undefined,
      defense: defense ? String(defense) : undefined,
    });
    return { ok: true, runId: run.id };
  }

  @Post("qlab/tests/delete") @ReturnedType(OkResponse) @BodyType(IdRequest)
  async deleteTest(@Body() body: { id: string }) { await repo.deleteTest(ORG(), body.id); return { ok: true }; }

  @Post("qlab/simulate") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async simulate(@Body() body: any) {
    let questionText = body.question as string | undefined;
    let temperature = body.temperature as number | undefined;
    let questionId = body.questionId as string | undefined;
    if (questionId) {
      const q = await repo.getQuestion(ORG(), questionId);
      if (!q) return { error: "question not found" };
      questionText = q.text;
      temperature = temperature ?? q.temperature ?? 0.8;
    }
    if (!questionText || !body.transcript) return { error: "question (or questionId) and transcript required" };
    const { askQuestion } = await import("@audit/domain/data/groq/mod.ts");
    const result = await askQuestion(questionText, body.transcript, 0, temperature ?? 0.8);
    return { result };
  }

  @Get("qlab/snippet") @ReturnedType(MessageResponse)
  async getSnippet(@Query("findingId") findingId: string) {
    if (!findingId) return { error: "findingId required" };
    const { getTranscript } = await import("@audit/domain/data/audit-repository/mod.ts");
    const transcript = await getTranscript(ORG(), findingId);
    return { snippet: transcript?.diarized?.slice(0, 2000) ?? transcript?.raw?.slice(0, 2000) ?? "" };
  }

  @Post("qlab/test-audit") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async runTestAudit(@Body() body: any) {
    if (!body.rid || !body.configName) return { error: "rid and configName required" };
    const { enqueueStep } = await import("@core/data/qstash/mod.ts");
    const { nanoid } = await import("https://deno.land/x/nanoid@v3.0.0/mod.ts");
    const findingId = nanoid();
    // Create test finding and enqueue
    const { saveFinding } = await import("@audit/domain/data/audit-repository/mod.ts");
    await saveFinding(ORG(), {
      id: findingId, auditJobId: nanoid(), findingStatus: "pending",
      feedback: { heading: "", text: "", viewUrl: "" },
      record: { RecordId: body.rid }, recordingIdField: body.recordingIdField ?? "VoGenie",
      qlabConfig: body.configName, isTest: true,
      testEmailRecipients: body.testEmailRecipients ?? [],
      owner: "test", startedAt: Date.now(),
    });
    await enqueueStep("init", { findingId, orgId: ORG() });
    return { ok: true, findingId };
  }

  @Get("qlab/test-runs") @ReturnedType(OkResponse)
  async getTestRuns(
    @Query("configId") configId: string,
    @Query("questionId") questionId: string,
    @Query("limit") limit: string,
  ) {
    const lim = limit ? Math.max(1, Math.min(500, parseInt(limit, 10) || 200)) : 200;
    const runs = await repo.getTestRuns(ORG(), {
      configId: configId || undefined,
      questionId: questionId || undefined,
      limit: lim,
    });
    return { runs };
  }

  @Post("qlab/test-emails") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async updateTestEmails(@Body() body: any) {
    if (!body.configId || !body.emails) return { error: "configId, emails required" };
    const config = await repo.updateConfig(ORG(), body.configId, { testEmailRecipients: body.emails } as any);
    return config ? { ok: true } : { error: "config not found" };
  }

  @Get("qlab-assignments") @ReturnedType(QLAssignmentsResponse)
  async getAssignments() {
    const [internal, partner] = await Promise.all([repo.getInternalAssignments(ORG()), repo.getPartnerAssignments(ORG())]);
    return { internal, partner };
  }

  @Post("qlab-assignments") @ReturnedType(OkResponse) @BodyType(AssignmentRequest)
  async setAssignment(@Body() body: { type: string; key: string; value: string | null }) {
    if (body.type === "internal") await repo.setInternalAssignment(ORG(), body.key, body.value);
    else await repo.setPartnerAssignment(ORG(), body.key, body.value);
    return { ok: true };
  }

  @Get("qlab/serve") @ReturnedType(MessageResponse)
  async serveConfig(@Query("name") name: string) {
    if (!name) return { error: "name required" };
    const configs = await repo.listConfigs(ORG());
    const config = configs.find((c) => c.name === name) ?? configs.find((c) => c.id === name);
    if (!config) return { error: "config not found" };
    const questions = await repo.getQuestionsForConfig(ORG(), config.id);
    return { config, questions };
  }
}
