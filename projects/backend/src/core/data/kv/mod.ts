import "reflect-metadata";
import { Injectable } from "@danet/core";
import {
  getFinding,
  saveFinding,
  getJob,
  saveJob,
  getCachedAnswer,
  cacheAnswer,
  getCachedQuestions,
  cacheQuestions,
  setBatchCounter,
  decrementBatchCounter,
  savePopulatedQuestions,
  getPopulatedQuestions,
  saveBatchAnswers,
  getAllBatchAnswers,
  getAllAnswersForFinding,
  trackActive,
  trackCompleted,
  trackError,
  trackRetry,
  getStats,
  saveTranscript,
  getTranscript,
  getPipelineConfig,
  setPipelineConfig,
  getWebhookConfig,
  saveWebhookConfig,
  fireWebhook,
  listEmailReportConfigs,
  getEmailReportConfig,
  saveEmailReportConfig,
  deleteEmailReportConfig,
  listSoundPacks,
  getSoundPack,
  saveSoundPack,
  deleteSoundPack,
  getGamificationSettings,
  saveGamificationSettings,
  getJudgeGamificationOverride,
  saveJudgeGamificationOverride,
  getReviewerGamificationOverride,
  saveReviewerGamificationOverride,
  resolveGamificationSettings,
  listCustomStoreItems,
  saveCustomStoreItem,
  deleteCustomStoreItem,
  getEarnedBadges,
  awardBadge,
  hasBadge,
  getBadgeStats,
  updateBadgeStats,
  getGameState,
  saveGameState,
  awardXp,
  purchaseStoreItem,
  emitEvent,
  getEvents,
  deleteEvents,
  getPrefabSubscriptions,
  savePrefabSubscriptions,
  emitBroadcastEvent,
  getBroadcastEvents,
  checkAndEmitPrefab,
  sendMessage,
  getConversation,
  getUnreadCount,
  markConversationRead,
  getConversationList,
} from "./impl.ts";

@Injectable()
export class KvService {
  // Finding CRUD
  getFinding = getFinding;
  saveFinding = saveFinding;

  // Job CRUD
  getJob = getJob;
  saveJob = saveJob;

  // Question Cache
  getCachedAnswer = getCachedAnswer;
  cacheAnswer = cacheAnswer;
  getCachedQuestions = getCachedQuestions;
  cacheQuestions = cacheQuestions;

  // Batch Counter
  setBatchCounter = setBatchCounter;
  decrementBatchCounter = decrementBatchCounter;

  // Populated Questions
  savePopulatedQuestions = savePopulatedQuestions;
  getPopulatedQuestions = getPopulatedQuestions;

  // Batch Answers
  saveBatchAnswers = saveBatchAnswers;
  getAllBatchAnswers = getAllBatchAnswers;
  getAllAnswersForFinding = getAllAnswersForFinding;

  // Pipeline Stats
  trackActive = trackActive;
  trackCompleted = trackCompleted;
  trackError = trackError;
  trackRetry = trackRetry;
  getStats = getStats;

  // Transcript
  saveTranscript = saveTranscript;
  getTranscript = getTranscript;

  // Pipeline Config
  getPipelineConfig = getPipelineConfig;
  setPipelineConfig = setPipelineConfig;

  // Webhook Config
  getWebhookConfig = getWebhookConfig;
  saveWebhookConfig = saveWebhookConfig;
  fireWebhook = fireWebhook;

  // Email Report Config
  listEmailReportConfigs = listEmailReportConfigs;
  getEmailReportConfig = getEmailReportConfig;
  saveEmailReportConfig = saveEmailReportConfig;
  deleteEmailReportConfig = deleteEmailReportConfig;

  // Sound Packs
  listSoundPacks = listSoundPacks;
  getSoundPack = getSoundPack;
  saveSoundPack = saveSoundPack;
  deleteSoundPack = deleteSoundPack;

  // Gamification Settings
  getGamificationSettings = getGamificationSettings;
  saveGamificationSettings = saveGamificationSettings;
  getJudgeGamificationOverride = getJudgeGamificationOverride;
  saveJudgeGamificationOverride = saveJudgeGamificationOverride;
  getReviewerGamificationOverride = getReviewerGamificationOverride;
  saveReviewerGamificationOverride = saveReviewerGamificationOverride;
  resolveGamificationSettings = resolveGamificationSettings;

  // Custom Store Items
  listCustomStoreItems = listCustomStoreItems;
  saveCustomStoreItem = saveCustomStoreItem;
  deleteCustomStoreItem = deleteCustomStoreItem;

  // Badge + Game State
  getEarnedBadges = getEarnedBadges;
  awardBadge = awardBadge;
  hasBadge = hasBadge;
  getBadgeStats = getBadgeStats;
  updateBadgeStats = updateBadgeStats;
  getGameState = getGameState;
  saveGameState = saveGameState;
  awardXp = awardXp;
  purchaseStoreItem = purchaseStoreItem;

  // SSE Events
  emitEvent = emitEvent;
  getEvents = getEvents;
  deleteEvents = deleteEvents;

  // Prefab Broadcast Events
  getPrefabSubscriptions = getPrefabSubscriptions;
  savePrefabSubscriptions = savePrefabSubscriptions;
  emitBroadcastEvent = emitBroadcastEvent;
  getBroadcastEvents = getBroadcastEvents;
  checkAndEmitPrefab = checkAndEmitPrefab;

  // Messaging
  sendMessage = sendMessage;
  getConversation = getConversation;
  getUnreadCount = getUnreadCount;
  markConversationRead = markConversationRead;
  getConversationList = getConversationList;
}

// Re-export types for consumers
export type {
  PipelineConfig,
  WebhookConfig,
  WebhookKind,
  ReportSection,
  DetailLevel,
  SectionConfig,
  ReportCadence,
  EmailReportConfig,
  SoundSlot,
  SoundPackId,
  SoundPackMeta,
  GamificationSettings,
  ResolvedGamificationSettings,
  EventType,
  AppEvent,
  BroadcastEvent,
  Message,
} from "./impl.ts";
