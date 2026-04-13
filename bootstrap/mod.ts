import "npm:reflect-metadata@0.1.13";
import { bootstrapServer } from "@mrg-keystone/danet";
import { Module } from "@danet/core";

// Module imports
import { CoreModule } from "@core/mod-root.ts";
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
// Swagger disabled during development — re-enable after all controllers have typed DTOs
const server = await bootstrapServer(AppModule, { port, swagger: false });
console.log(`🚀 Autobottom API running on port ${port}`);
await server.listen();
