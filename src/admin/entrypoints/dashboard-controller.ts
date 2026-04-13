/** Admin dashboard data controller. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";

@SwaggerDescription("Dashboard — admin analytics data, audit history, review queue data")
@Controller("admin")
export class DashboardController {

  @Get("dashboard/data")
  async dashboardData() { return { message: "dashboard data pending port" }; }

  @Get("dashboard/section")
  async dashboardSection(@Query("section") section: string) { return { section, data: [] }; }

  @Get("audits/data")
  async auditsData(@Query("since") since: string, @Query("until") until: string) { return { audits: [] }; }

  @Get("review-queue/data")
  async reviewQueueData() { return { findings: [] }; }

  @Get("delete-finding")
  async deleteFinding(@Query("findingId") findingId: string) { return { ok: true, findingId }; }

  @Get("audits-by-record")
  async auditsByRecord(@Query("recordId") recordId: string) { return { audits: [] }; }
}
