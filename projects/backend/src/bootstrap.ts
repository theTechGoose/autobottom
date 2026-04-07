import "reflect-metadata";
import { DanetApplication } from "@danet/core";
import { Module } from "@danet/core";
import { CoreModule } from "./core/core.module.ts";
import { AuthModule } from "./auth/auth.module.ts";
import { AuditModule } from "./audit/audit.module.ts";
import { AuditProcessModule } from "./audit-process/audit-process.module.ts";
import { ReviewModule } from "./review/review.module.ts";
import { JudgeModule } from "./judge/judge.module.ts";
import { ManagerModule } from "./manager/manager.module.ts";
import { AgentModule } from "./agent/agent.module.ts";
import { GamificationModule } from "./gamification/gamification.module.ts";
import { AdminModule } from "./admin/admin.module.ts";
import { MessagingModule } from "./messaging/messaging.module.ts";
import { QuestionLabModule } from "./question-lab/question-lab.module.ts";

@Module({
  imports: [
    CoreModule,
    AuthModule,
    AuditModule,
    AuditProcessModule,
    ReviewModule,
    JudgeModule,
    ManagerModule,
    AgentModule,
    GamificationModule,
    AdminModule,
    MessagingModule,
    QuestionLabModule,
  ],
})
export class AppModule {}

const app = new DanetApplication();
await app.init(AppModule);

const port = Number(Deno.env.get("PORT") ?? 8000);
await app.listen(port);
