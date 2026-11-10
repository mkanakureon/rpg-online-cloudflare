// routes-reports.ts — 管理の読み取りの口のうち、監査のログを読む口と集計の口（/v1/admin/analytics/players・grants）。
//
// 読み取りの口は監査に残さない。集計は数と日付（と品目・クエストの ID）だけでプレイヤー ID を返さない（関数と SQL は src/core/analytics.ts）。
// 正は docs/guides/working/admin-design.md §5 と docs/guides/working/analytics-design.md §5。
//
// 概要記述: Claude Opus 5.5 — 2026-11-10
import { activityDay } from '../activity';
import {
  cohortRetentionSql, dailyActivitySql, fillDays, grantsSql, parseAnalyticsRange, questClaimsSql, rangeSeconds, shapeCohorts, shapeGrants,
  type CohortRow, type DailyRow, type GrantRow, type QuestClaimCountRow,
} from '../analytics';
import { error, json } from '../http';
import type { Route } from '../module';
import { type AuditRow, isoSeconds, listAuditSql, shapeAuditRow } from './audit';
import { checkAdmin, serverNow } from './common';
import { parseAuditQuery } from './parse';

export const reportRoutes: Route[] = [
  {
    method: 'GET',
    pattern: /^\/v1\/admin\/audit$/,
    async handle(req, env, _match, url, known) {
      const access = await checkAdmin(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId } = access;
      const query = parseAuditQuery(url);
      if (!query.ok) return error('INVALID_ARGUMENT', query.message, 400);
      const { limit, before } = query.value;
      const rows = await env.DB.prepare(listAuditSql).bind(gameId, before, before, limit + 1).all<AuditRow>();
      const page = rows.results.slice(0, limit);
      const items = page.map(shapeAuditRow);
      const more = rows.results.length > limit;
      return json(more ? { gameId, items, nextBefore: page[page.length - 1].auditId } : { gameId, items });
    },
  },
  {
    method: 'GET',
    pattern: /^\/v1\/admin\/analytics\/players$/,
    async handle(req, env, _match, url, known) {
      const access = await checkAdmin(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId } = access;
      const now = serverNow();
      const range = parseAnalyticsRange(url, now);
      if (!range.ok) return error('INVALID_ARGUMENT', range.message, 400);
      const { from, to } = range.value;
      const [daily, cohorts] = await Promise.all([
        env.DB.prepare(dailyActivitySql).bind(gameId, from, to).all<DailyRow>(),
        env.DB.prepare(cohortRetentionSql).bind(gameId, from, to).all<CohortRow>(),
      ]);
      // 数と日付だけ（playerId・行ごとの時刻を入れない）
      return json({
        gameId, from, to, timezone: 'UTC', serverTime: isoSeconds(now),
        days: fillDays(from, to, daily.results),
        cohorts: shapeCohorts(cohorts.results, activityDay(now)),
      });
    },
  },
  {
    method: 'GET',
    pattern: /^\/v1\/admin\/analytics\/grants$/,
    async handle(req, env, _match, url, known) {
      const access = await checkAdmin(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId } = access;
      const now = serverNow();
      const range = parseAnalyticsRange(url, now);
      if (!range.ok) return error('INVALID_ARGUMENT', range.message, 400);
      const { from, to } = range.value;
      const { start, end } = rangeSeconds(range.value);
      const [grants, claims] = await Promise.all([
        env.DB.prepare(grantsSql).bind(gameId, start, end).all<GrantRow>(),
        env.DB.prepare(questClaimsSql).bind(gameId, start, end).all<QuestClaimCountRow>(),
      ]);
      // 数と日付と品目・クエストの ID だけ（playerId・行ごとの時刻を入れない）
      return json({ gameId, from, to, timezone: 'UTC', serverTime: isoSeconds(now), ...shapeGrants(grants.results, claims.results) });
    },
  },
];
