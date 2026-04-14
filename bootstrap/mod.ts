import "npm:reflect-metadata@0.1.13";
import { bootstrapServer } from "@mrg-keystone/danet";
import { Module } from "@danet/core";

// Initialize Datadog OTel before any module loads so every subsequent
// console.* call gets auto-mirrored to DD Logs and every withSpan has a tracer.
import { initOtel } from "@core/data/datadog-otel/mod.ts";
initOtel();
import { registerCrons } from "@cron/domain/business/cron-core/mod.ts";
registerCrons();

// Module imports
import { AuthController } from "@core/business/auth/mod.ts";
@Module({ controllers: [AuthController], injectables: [] })
class CoreModule {}
import { AuditModule } from "@audit/mod-root.ts";
import { ReviewModule } from "@review/mod-root.ts";
import { JudgeModule } from "@judge/mod-root.ts";
import { ManagerModule } from "@manager/mod-root.ts";
import { ReportingModule } from "@reporting/mod-root.ts";
import { QuestionLabModule } from "@question-lab/mod-root.ts";
import { GamificationModule } from "@gamification/mod-root.ts";
import { AgentModule } from "@agent/mod-root.ts";
import { ChatModule } from "@chat/mod-root.ts";
import { WeeklyBuilderModule } from "@weekly-builder/mod-root.ts";
import { AdminModule } from "@admin/mod-root.ts";
import { CronModule } from "@cron/mod-root.ts";
import { EventsModule } from "@events/mod-root.ts";

@Module({
  imports: [
    CoreModule,
    AuditModule,
    ReviewModule,
    JudgeModule,
    ManagerModule,
    ReportingModule,
    QuestionLabModule,
    GamificationModule,
    AgentModule,
    ChatModule,
    WeeklyBuilderModule,
    AdminModule,
    CronModule,
    EventsModule,
  ],
})
class AppModule {}

const port = Number(Deno.env.get("PORT") ?? 3000);
// Swagger disabled on Deno Deploy — @mrg-keystone/danet's JSR version crashes
// on Deno.readTextFileSync for the index page template (JSR URLs aren't file URLs).
// Enable locally with the local danet fork for development.
const enableSwagger = Deno.env.get("ENABLE_SWAGGER") === "true";
const server = await bootstrapServer(AppModule, { port, swagger: enableSwagger });
console.log(`🚀 Autobottom API running on port ${port}`);
if (enableSwagger) console.log(`📖 Swagger UI at http://localhost:${port}/docs`);
await server.listen();
