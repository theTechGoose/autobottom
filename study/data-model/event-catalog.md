# Event Catalog

All `emit()` calls in the app -- dispatched via `waitUntil()`, matched by EventConfig.

---

## AuditConfig

- `audit.config.created`
- `audit.config.modified`
- `audit.config.deleted`
- `audit.config.versionPublished`

## AuditQuestion

- `audit.question.created`
- `audit.question.modified`
- `audit.question.deleted`
- `audit.question.testPassed`
- `audit.question.testFailed`

## AuditInstance

- `audit.instance.created`
- `audit.instance.transcribing`
- `audit.instance.transcribed`
- `audit.instance.transcriptionFailed`
- `audit.instance.asking`
- `audit.instance.completed`
- `audit.instance.failed`
- `audit.instance.retrying`
- `audit.instance.resolved`

## AuditResult

- `audit.result.appended.llm`
- `audit.result.appended.reviewer`
- `audit.result.appended.judge`

## Appeal

- `appeal.filed`
- `appeal.assigned`
- `appeal.decided`

## Coaching

- `coaching.pending`
- `coaching.completed`

## Team

- `team.created`
- `team.modified`
- `team.deleted`
- `team.memberAdded`
- `team.memberRemoved`
- `team.leaderChanged`

## RoleDef

- `role.created`
- `role.modified`
- `role.deleted`

## User

- `user.created`
- `user.modified`
- `user.deactivated`
- `user.reactivated`
- `user.passwordChanged`
- `user.login`
- `user.loginFailed`

## Session

- `session.created`
- `session.expired`

## Dashboard

- `dashboard.created`
- `dashboard.modified`
- `dashboard.shared`
- `dashboard.deleted`

## Report

- `report.created`
- `report.modified`
- `report.deleted`

## Player

- `player.xpEarned`
- `player.xpSpent`
- `player.levelUp`
- `player.streakIncremented`
- `player.streakBroken`

## Badge

- `badge.earned`
- `badge.progressUpdated`

## Store

- `store.itemPurchased`
- `store.themeEquipped`
- `store.comboPackEquipped`

## Message

- `message.sent`
- `message.read`

## Broadcast

- `broadcast.saleCompleted`
- `broadcast.perfectScore`
- `broadcast.levelUp`

## EventConfig

- `eventConfig.created`
- `eventConfig.modified`
- `eventConfig.deleted`
- `eventConfig.triggered`
- `eventConfig.deliveryFailed`

## Schedule

- `schedule.report`

## Provider

- `provider.created`
- `provider.modified`
- `provider.deleted`

## ProviderConfig

- `providerConfig.created`
- `providerConfig.modified`
- `providerConfig.deactivated`
- `providerConfig.reactivated`

## ServiceBinding

- `serviceBinding.created`
- `serviceBinding.modified`
- `serviceBinding.deleted`
- `serviceBinding.fallbackTriggered`
- `serviceBinding.circuitBreakerOpened`
- `serviceBinding.circuitBreakerClosed`
- `serviceBinding.referenceOrphaned`

## Generic CRUD

- `record.created`
- `record.modified`
- `record.deleted`

## Unscoped

- `breakingChange`
