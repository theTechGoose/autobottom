/** Chargeback/Wire deduction API controller. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";

@SwaggerDescription("Chargebacks & Wire Deductions — report data for dashboard and sheets")
@Controller("admin")
export class ChargebackController {

  @Get("chargebacks")
  async getChargebacks(@Query("since") since: string, @Query("until") until: string) {
    if (!since) return { error: "since required" };
    // TODO: wire up to queryChargebackReport with auth orgId
    return { chargebacks: [], omissions: [], message: "pending full port with auth" };
  }

  @Get("wire-deductions")
  async getWireDeductions(@Query("since") since: string, @Query("until") until: string) {
    if (!since) return { error: "since required" };
    return { items: [], message: "pending full port with auth" };
  }

  @Post("post-to-sheet")
  async postToSheet(@Body() body: { since: number; until: number; tabs: string }) {
    if (!body.since || !body.until || !body.tabs) return { error: "since, until, tabs required" };
    return { ok: true, posted: [], message: "pending full port" };
  }

  @Get("trigger-weekly-sheets")
  async triggerWeeklySheets() {
    return { ok: true, message: "weekly sheets trigger pending port" };
  }
}
