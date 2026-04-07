import "reflect-metadata";
import { Injectable } from "@danet/core";
import {
  chunkText,
  upload,
  query,
  deleteNamespace,
} from "./impl.ts";

@Injectable()
export class PineconeService {
  chunkText = chunkText;
  upload = upload;
  query = query;
  deleteNamespace = deleteNamespace;
}
