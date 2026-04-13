/** SSE events controller. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";

@SwaggerDescription("Events — Server-Sent Events for real-time updates")
@Controller("api")
export class EventsController {

  @Get("events")
  async events() {
    // TODO: port SSE streaming — for now return placeholder
    // The actual implementation will use ReadableStream with TextEncoder
    return { message: "SSE endpoint pending port — requires streaming response" };
  }
}
