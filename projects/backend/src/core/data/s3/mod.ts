import "reflect-metadata";
import { Injectable } from "@danet/core";
import { S3Ref } from "./impl.ts";

@Injectable()
export class S3Service {
  /** Create a new S3Ref for the given bucket and key. */
  createRef(bucket: string, key: string): S3Ref {
    return new S3Ref(bucket, key);
  }
}

export { S3Ref } from "./impl.ts";
