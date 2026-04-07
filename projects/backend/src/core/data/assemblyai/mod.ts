import "reflect-metadata";
import { Injectable } from "@danet/core";
import {
  transcribe,
  transcribeWithUtterances,
  identifyRoles,
} from "./impl.ts";

@Injectable()
export class AssemblyAiService {
  transcribe = transcribe;
  transcribeWithUtterances = transcribeWithUtterances;
  identifyRoles = identifyRoles;
}

export type { LabeledUtterance, TranscriptResult } from "./impl.ts";
