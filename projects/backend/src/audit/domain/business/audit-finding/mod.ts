import "reflect-metadata";
import { Injectable } from "@danet/core";
import { AuditFindingService } from "./impl.ts";

@Injectable()
export class AuditFindingDomainService extends AuditFindingService {}
