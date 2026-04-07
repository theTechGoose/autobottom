import "reflect-metadata";
import { Injectable } from "@danet/core";
import { AuditJobService } from "./impl.ts";

@Injectable()
export class AuditJobDomainService extends AuditJobService {}
