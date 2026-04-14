import { Module } from "@danet/core";
import { ChargebackController } from "@reporting/entrypoints/chargeback/mod.ts";
import { EmailReportController } from "@reporting/entrypoints/email-report/mod.ts";

export { queryChargebackReport, queryWireReport, queryAuditDoneIndex, getChargebackEntries, getWireDeductionEntries } from "@reporting/domain/business/chargeback-report/mod.ts";

@Module({
  controllers: [ChargebackController, EmailReportController],
  injectables: [],
})
export class ReportingModule {}
