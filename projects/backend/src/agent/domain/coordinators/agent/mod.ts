import "reflect-metadata";
import { Injectable } from "@danet/core";
import {
  getAgentDashboardData,
} from "./impl.ts";

@Injectable()
export class AgentCoordinator {
  getAgentDashboardData = getAgentDashboardData;
}

// Re-export types for consumers
export type {
  AgentDashboardData,
} from "./impl.ts";
