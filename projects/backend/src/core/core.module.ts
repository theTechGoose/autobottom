import "reflect-metadata";
import { Module } from "@danet/core";

// Data services
import { KvService } from "./data/kv/mod.ts";
import { EnvService } from "./data/env/mod.ts";
import { S3Service } from "./data/s3/mod.ts";
import { GroqService } from "./data/groq/mod.ts";
import { AssemblyAiService } from "./data/assemblyai/mod.ts";
import { PineconeService } from "./data/pinecone/mod.ts";
import { GenieService } from "./data/genie/mod.ts";
import { QuickBaseService } from "./data/quickbase/mod.ts";
import { PostmarkService } from "./data/postmark/mod.ts";
import { QueueService } from "./data/queue/mod.ts";

// Controllers
import { HealthController } from "./entrypoints/health/mod.ts";

@Module({
  injectables: [
    KvService,
    EnvService,
    S3Service,
    GroqService,
    AssemblyAiService,
    PineconeService,
    GenieService,
    QuickBaseService,
    PostmarkService,
    QueueService,
  ],
  controllers: [HealthController],
})
export class CoreModule {}
