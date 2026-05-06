import { Module } from "@danet/core";
import { ManagerController } from "@manager/entrypoints/manager/mod.ts";

@Module({
  controllers: [ManagerController],
  injectables: [],
})
export class ManagerModule {}
