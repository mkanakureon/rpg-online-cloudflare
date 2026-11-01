// cli-flow.d.mts — scripts/cli-flow.mjs の型の宣言（TypeScript の試験から読み込むため）。中身の正は cli-flow.mjs。
//
// 概要記述: Claude Opus 5.5 — 2026-11-01
import type { RequestLogEvent, RpgOnlineClient, ScenarioOptions } from '../clients/browser/rpg-online-client.mjs';

export declare function requestLogLine(event: RequestLogEvent): string;

export declare function runCli(options: {
  client: RpgOnlineClient;
  log: (line: string) => void;
  scenario?: Omit<ScenarioOptions, 'onStep'>;
}): Promise<0 | 1>;
