import { Module } from "@danet/core";
import { WeeklyBuilderController } from "@weekly-builder/entrypoints/weekly-builder-controller.ts";

@Module({
  controllers: [WeeklyBuilderController],
  injectables: [],
})
export class WeeklyBuilderModule {}
