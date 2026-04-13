/** SSE events controller — wired to real events repository. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { getEvents, getBroadcastEvents } from "@events/domain/data/events-repository/mod.ts";

const ORG = () => "default";

@SwaggerDescription("Events — Server-Sent Events for real-time updates")
@Controller("api")
export class EventsController {

  @Get("events")
  async events(@Query("email") email: string, @Query("since") since: string) {
    if (!email) return { events: [], broadcasts: [] };
    const s = parseInt(since || "0");
    const [personal, broadcasts] = await Promise.all([
      getEvents(ORG(), email, s),
      getBroadcastEvents(ORG(), s),
    ]);
    return { events: personal, broadcasts };
    // Note: full SSE streaming (ReadableStream) requires raw Response access
    // which danet controllers don't support via return values. For SSE,
    // a custom route outside the controller framework would be needed.
  }
}
