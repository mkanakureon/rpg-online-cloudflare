// modules/index.ts — 機能のモジュールの一覧。機能の名前の正はここ 1 か所。
//
// src/worker.ts がこの一覧を src/core/router.ts の createRouter に渡す。並びの順に
// ルートを当てる。モジュールどうしは互いを読み込まない。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import type { GameModule } from '../core/module';
import { announcements } from './announcements';
import { config } from './config';
import { events } from './events';
import { inventory } from './inventory';
import { rankings } from './rankings';
import { saves } from './saves';

export const modules: GameModule[] = [announcements, rankings, saves, config, inventory, events];
