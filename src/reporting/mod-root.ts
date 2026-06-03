import { Module } from "@danet/core";
import { ChargebackController } from "@reporting/entrypoints/chargeback/mod.ts";
import { EmailReportController } from "@reporting/entrypoints/email-report/mod.ts";
import { FailedAuditsController } from "@reporting/entrypoints/failed-audits/mod.ts";

export { queryChargebackReport, queryWireReport, queryAuditDoneIndex, getChargebackEntries, getWireDeductionEntries } from "@reporting/domain/business/chargeback-report/mod.ts";

@Module({
  controllers: [ChargebackController, EmailReportController, FailedAuditsController],
  injectables: [],
})
export class ReportingModule {}
