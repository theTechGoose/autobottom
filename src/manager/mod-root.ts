import { Module } from "@danet/core";
import { ManagerController } from "@manager/entrypoints/manager-controller.ts";

@Module({
  controllers: [ManagerController],
  injectables: [],
})
export class ManagerModule {}
