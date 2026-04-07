import "reflect-metadata";
import { Controller, Get, Post, Put, Delete, Req } from "@danet/core";
import {
  handleListConfigs, handleCreateConfig, handleUpdateConfig, handleDeleteConfig,
  handleGetQuestion, handleCreateQuestion, handleUpdateQuestion, handleDeleteQuestion,
  handleRestoreVersion,
  handleCreateTest, handleUpdateTest, handleDeleteTest,
  handleSimulate,
  handleGetSnippet, handleServeConfig,
} from "../../../entrypoints/question-lab.ts";

@Controller("question-lab/api")
export class QuestionLabController {

  // -- Config API --

  @Get("configs")
  listConfigs(@Req() req: Request): Promise<Response> {
    return handleListConfigs(req);
  }

  @Post("configs")
  createConfig(@Req() req: Request): Promise<Response> {
    return handleCreateConfig(req);
  }

  @Put("configs/:id")
  updateConfig(@Req() req: Request): Promise<Response> {
    return handleUpdateConfig(req);
  }

  @Delete("configs/:id")
  deleteConfig(@Req() req: Request): Promise<Response> {
    return handleDeleteConfig(req);
  }

  // -- Question API --

  @Get("questions/:id")
  getQuestion(@Req() req: Request): Promise<Response> {
    return handleGetQuestion(req);
  }

  @Post("configs/:configId/questions")
  createQuestion(@Req() req: Request): Promise<Response> {
    return handleCreateQuestion(req);
  }

  @Put("questions/:id")
  updateQuestion(@Req() req: Request): Promise<Response> {
    return handleUpdateQuestion(req);
  }

  @Delete("questions/:id")
  deleteQuestion(@Req() req: Request): Promise<Response> {
    return handleDeleteQuestion(req);
  }

  @Post("questions/:id/restore/:versionIndex")
  restoreVersion(@Req() req: Request): Promise<Response> {
    return handleRestoreVersion(req);
  }

  // -- Test API --

  @Post("questions/:questionId/tests")
  createTest(@Req() req: Request): Promise<Response> {
    return handleCreateTest(req);
  }

  @Put("tests/:id")
  updateTest(@Req() req: Request): Promise<Response> {
    return handleUpdateTest(req);
  }

  @Delete("tests/:id")
  deleteTest(@Req() req: Request): Promise<Response> {
    return handleDeleteTest(req);
  }

  // -- Simulate (SSE) --

  @Post("simulate")
  simulate(@Req() req: Request): Promise<Response> {
    return handleSimulate(req);
  }

  // -- Snippet + Serve --

  @Get("snippet")
  getSnippet(@Req() req: Request): Promise<Response> {
    return handleGetSnippet(req);
  }

  @Get("serve/:configNameOrId")
  serveConfig(@Req() req: Request): Promise<Response> {
    return handleServeConfig(req);
  }
}
