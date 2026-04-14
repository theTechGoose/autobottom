import { Module } from "@danet/core";
import { EventsController } from "@events/entrypoints/events/mod.ts";

@Module({
  controllers: [EventsController],
  injectables: [],
})
export class EventsModule {}
