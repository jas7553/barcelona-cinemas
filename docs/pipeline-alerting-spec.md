# Spec: Pipeline failure alerting (SNS notifications for existing alarms + heartbeat alarm)

## Problem

The app's data pipeline is two scrapers (`providers/`) refreshed every 12h by
EventBridge. The dominant failure mode is **silent rot**: a source site changes
layout or moves domains, refresh fails, the cache goes stale, and the app keeps
serving old showtimes until the owner notices at the cinema. (This nearly
happened already: Verdi moved from `cines-verdi.com/barcelona` to
`barcelona.cines-verdi.com` in 2026.)

`template.yaml` already defines four CloudWatch alarms — but **none of them has
`AlarmActions`**, so they flip state silently. Nobody is notified. That is the
gap to close.

## Current state (verified 2026-06-12)

Alarms in `template.yaml` (all action-less):

| Alarm | Metric | Catches |
|---|---|---|
| `LambdaErrorAlarm` | `AWS/Lambda Errors` (per function) | unhandled exceptions |
| `RefreshFailureAlarm` | `BarcelonaMovieDatabase/RefreshFailure` | scheduled refresh raised |
| `CacheAgeAlarm` | `BarcelonaMovieDatabase/CacheAgeHours` > TTL | stale cache observed by a request |
| `ListingsStaleResponseAlarm` | `BarcelonaMovieDatabase/ListingsStaleResponse` | repeated stale API responses |

Metrics are emitted via EMF (`observability.emit_metric`, namespace
`BarcelonaMovieDatabase`, dimension `Environment=prod` plus optional
`Route`/`Trigger`). Emission sites: `pipeline.py` (`RefreshSuccess`,
`RefreshFailure`, `CacheAgeHours`, `ProviderFailure`, `ProviderSuccess`,
`CollectionFailure`, `MoviesCollected`), `app.py` (`ListingsRequest`,
`ListingsError`, `ListingsStaleResponse`), `enricher.py` (`TmdbLookupFailure`,
`MoviesEnriched`).

**Known blind spot:** every existing alarm uses `TreatMissingData:
notBreaching`, and every metric is only emitted *when code runs*. If the
EventBridge schedule is disabled/broken, or the Lambda is never invoked, no
metric is emitted and no alarm fires — `CacheAgeHours` is only emitted on
`GET /api/listings` cache reads and on refresh (the 5-minute warmup ping
returns before any metric, see `app.py` `{"source": "warmup"}` short-circuit;
CloudFront's 12h cache means the origin is rarely hit by users). Absence of
signal must itself be alarmable.

## Requirements

### 1. SNS topic + email subscription

- Add an `AWS::SNS::Topic` (e.g. `AlertTopic`) to `template.yaml`.
- Add an `AWS::SNS::Subscription` with `Protocol: email` and the endpoint taken
  from a new template parameter `NotificationEmail` (Type: String, **no
  default** — the address must not be committed; the repo may be public).
- Put the actual email value in `samconfig.toml` `parameter_overrides`
  (`samconfig.toml` is gitignored — verified). Document the parameter in the
  README deploy section if one exists.

### 2. Wire all four existing alarms to the topic

- Add `AlarmActions: [!Ref AlertTopic]` **and** `OKActions: [!Ref AlertTopic]`
  to each existing alarm (OK actions give recovery emails, so an alert thread
  has a visible end).
- Do not add `InsufficientDataActions` (noise).

### 3. New heartbeat alarm — "no successful refresh in 24h"

The absence-of-signal alarm. Catches: schedule disabled, Lambda misconfigured
after a deploy, refresh hanging/timing out, EMF logging broken.

- Metric: `RefreshSuccess` (`Environment=prod`, `Trigger=schedule` — confirm
  the dimension set actually emitted by `pipeline.force_refresh`; check a
  recent EMF log line rather than assuming).
- `Statistic: Sum`, `Period: 86400` (1 day — max standard period),
  `EvaluationPeriods: 1`, `Threshold: 1`,
  `ComparisonOperator: LessThanThreshold`.
- **`TreatMissingData: breaching`** — this is the entire point; missing data
  means the pipeline is dead.
- Wire to the topic like the others.
- Note: with a 12h schedule there are 2 expected successes/day, so Sum < 1 over
  24h means both runs were lost. Tolerates one flaky run without paging.

### 4. (Optional, low severity) Single-provider degradation alarm

A refresh "succeeds" even when one of the two providers fails — coverage
silently halves (e.g. all Mooby booking links vanish). If implemented:

- Metric: `ProviderFailure`, `Statistic: Sum`, `Period: 86400`,
  `EvaluationPeriods: 1`, `Threshold: 2`,
  `ComparisonOperator: GreaterThanOrEqualToThreshold`,
  `TreatMissingData: notBreaching`.
- Threshold 2 ≈ a provider failed in both daily runs — persistent breakage,
  not a transient timeout. Skip this alarm entirely if it can't be made
  non-noisy; the owner prefers fewer alerts over more.

## Constraints

- **Free tier only.** No CloudWatch Dashboards, no WAF, no X-Ray (existing
  CLAUDE.md rule). First 10 alarms and SNS email delivery are free; this change
  adds 1–2 alarms (total 5–6) and 1 topic — fine.
- No application code changes should be needed; this is template-only (plus
  samconfig). If a metric/dimension mismatch is discovered (e.g. heartbeat
  alarm dimensions don't match what's emitted), prefer fixing the **alarm**
  dimensions to match reality over changing emission code.
- YAML hygiene (owner's standing rule): quote any string containing a colon,
  and run `sam validate --lint` immediately after editing `template.yaml`,
  before attempting a deploy.
- `deploy.sh` must not gain a post-deploy `force_refresh` call (existing rule);
  the warmup ping at the end is intentional and must stay.

## Acceptance criteria

1. `sam validate --lint` passes.
2. `pytest tests/` still passes (includes `tests/test_template.py` — extend it:
   assert every `AWS::CloudWatch::Alarm` in the template has a non-empty
   `AlarmActions`, so a future alarm can't be added action-less again).
3. After `./deploy.sh` and confirming the SNS subscription email (manual step —
   call it out to the owner), forcing an alarm fires a real email:
   `aws cloudwatch set-alarm-state --alarm-name <stack>-... --state-value ALARM
   --state-reason test` (then OK email on recovery).
4. Heartbeat alarm sits in `OK` state after the next scheduled refresh (verify
   the day after deploy, or trigger the EventBridge rule manually once).

## Out of scope

- Dashboards, paging/escalation, Slack/Discord webhooks.
- Retry logic or provider-level fallbacks in application code.
- Any change to refresh cadence or cache TTL.
