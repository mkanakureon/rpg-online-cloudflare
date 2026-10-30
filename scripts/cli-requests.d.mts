// cli-requests.d.mts — scripts/cli-requests.mjs の型の宣言（TypeScript のテストから読み込むため）。
//
// 中身の正は cli-requests.mjs。欄を変えたらここも合わせる。
//
// 概要記述: Claude Opus 5.5 — 2026-10-24

export declare const SMOKE_BOARD_ID: string;

export declare function scoreSubmission(playerId?: string): {
  gameId: string;
  playerId: string;
  displayName: string;
  score: number;
};

export declare function guestRequest(): { gameId: string };

export declare function authHeaders(token: string): {
  'Content-Type': string;
  Authorization: string;
};

export declare const SMOKE_SLOT_ID: string;

export declare function saveData(): string;

export declare function sha256Hex(text: string): Promise<string>;

export declare function saveWrite(data: string, checksum: string, baseRevision?: number): {
  formatVersion: number;
  data: string;
  checksum: string;
  baseRevision: number;
};

export declare const CLI_CLIENT_VERSION: string;

export declare function configPath(gameId?: string, clientVersion?: string): string;

export declare function masterDataPath(key: string, gameId?: string): string;

export declare function utf8Bytes(text: string): number;
