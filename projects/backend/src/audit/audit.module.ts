import "reflect-metadata";
import { Module } from "@danet/core";

import { AuditJobDomainService } from "./domain/business/audit-job/mod.ts";
import { AuditFindingDomainService } from "./domain/business/audit-finding/mod.ts";
import { QuestionDomainService } from "./domain/business/question/mod.ts";
import { QuestionExprDomainService } from "./domain/business/question-expr/mod.ts";

import { AuditApiController } from "./entrypoints/api/mod.ts";

@Module({
  injectables: [
    AuditJobDomainService,
    AuditFindingDomainService,
    QuestionDomainService,
    QuestionExprDomainService,
  ],
  controllers: [
    AuditApiController,
  ],
})
export class AuditModule {}
