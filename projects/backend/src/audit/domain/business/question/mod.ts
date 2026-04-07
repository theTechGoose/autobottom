import "reflect-metadata";
import { Injectable } from "@danet/core";
import { QuestionService } from "./impl.ts";

@Injectable()
export class QuestionDomainService extends QuestionService {}
