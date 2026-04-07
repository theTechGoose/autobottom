import "reflect-metadata";
import { Injectable } from "@danet/core";
import {
  queryRecords,
  getDateLegByRid,
  getQuestionsForDestination,
} from "./impl.ts";

@Injectable()
export class QuickBaseService {
  queryRecords = queryRecords;
  getDateLegByRid = getDateLegByRid;
  getQuestionsForDestination = getQuestionsForDestination;
}
