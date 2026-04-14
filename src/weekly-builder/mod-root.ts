import { Module } from "@danet/core";
import { WeeklyBuilderController } from "@reporting/entrypoints/weekly-builder/mod.ts";
@Module({ controllers: [WeeklyBuilderController], injectables: [] })
export class WeeklyBuilderModule {}
