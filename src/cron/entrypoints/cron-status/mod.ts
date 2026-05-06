/** Cron status entrypoint — reports cron job health. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get } from "@danet/core";
import { ReturnedType } from "#danet/swagger-decorators";
import { OkResponse } from "@core/dto/responses.ts";

@Controller("cron")
export class CronStatusController {
  @Get("status") @ReturnedType(OkResponse)
  async status() { return { ok: true, crons: ["watchdog", "wire-deductions-weekly", "chargebacks-weekly", "email-reports"] }; }
}
