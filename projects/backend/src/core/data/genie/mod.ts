import "reflect-metadata";
import { Injectable } from "@danet/core";
import {
  downloadRecording,
  getRecordingUrl,
} from "./impl.ts";

@Injectable()
export class GenieService {
  downloadRecording = downloadRecording;
  getRecordingUrl = getRecordingUrl;
}
