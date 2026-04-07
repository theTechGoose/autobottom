import "reflect-metadata";
import { Injectable } from "@danet/core";
import { QuestionExprService } from "./impl.ts";

@Injectable()
export class QuestionExprDomainService extends QuestionExprService {}
