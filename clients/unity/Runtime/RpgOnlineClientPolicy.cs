// RpgOnlineClientPolicy.cs — Unity のクライアント層の決まりの値（定数のクラス 1 つ）。タイムアウト・再試行・Retry-After・エラーコードの表・操作ごとの再試行の種類。
//
// 値の正はスキーマ openapi/rpg-online.v1.json の最上位の x-client-policy と各操作の x-retry（設計は
// docs/guides/working/client-integration-design.md §2・§3）。ここはその書き写しで、ブラウザの SDK（clients/browser/rpg-online-client.mjs）と同じ値。
// 食い違いは Mac の試験 test/unity-client.test.ts が、このファイルを文字列として読んで見つける。そのため、値の行の形を変えない:
//   public const int Name = 数;  public const string Name = "文字";  public static readonly int[] Name = { 数, ... };
//   new ErrorRule("コード", "種類", true|false),   new OperationRule("operationId", "種類"),
// 値を変えるときは、スキーマと 3 つのクライアントの定数を同じコミットで直す。
//
// 概要記述: Claude Opus 5.5 — 2026-11-01

using System.Collections.Generic;

namespace RpgOnline
{
    /// <summary>エラーコード 1 つの画面の文の種類と自動の再試行の可否（x-client-policy の errorCatalog の 1 行）。</summary>
    public readonly struct ErrorRule
    {
        public readonly string Code;
        public readonly string Category;
        public readonly bool Retry;

        public ErrorRule(string code, string category, bool retry)
        {
            Code = code;
            Category = category;
            Retry = retry;
        }
    }

    /// <summary>操作 1 つの再試行の種類（各操作の x-retry）。</summary>
    public readonly struct OperationRule
    {
        public readonly string OperationId;
        public readonly string Kind;

        public OperationRule(string operationId, string kind)
        {
            OperationId = operationId;
            Kind = kind;
        }
    }

    /// <summary>3 つのクライアントで共通の決まり（設計書 §2）。クライアント層はここだけから値を読む。</summary>
    public static class RpgOnlineClientPolicy
    {
        // §2.1 タイムアウトと再試行
        public const int TimeoutSeconds = 10;
        public const int MaxAttempts = 3;
        public const int BackoffBaseSeconds = 1;
        public const int BackoffFactor = 2;
        public const int BackoffMaxSeconds = 8;
        public const string BackoffJitter = "full";

        // §2.3 429 の Retry-After
        public const int RetryAfterMaxWaitSeconds = 60;
        public const int RetryAfterMaxRetries = 1;

        // 再試行する状態（回線断・タイムアウトも再試行する）
        public static readonly int[] RetryStatuses = { 429, 500, 502, 503, 504 };

        // §2.7 期限までの残りがこの秒を切ったら次の要求の前にトークンを更新する
        public const int TokenRefreshBeforeSeconds = 604800;

        // 再試行の種類のうち、自動で送り直さないもの（§2.2）
        public const string NoAutoRetryKind = "revision";

        // 再試行の種類のうち、429（何も作っていない）のときだけ送り直すもの（§2.2）。回線断・タイムアウト・5xx は送り直さず呼び手に返す
        public const string RateLimitOnlyKind = "new-resource";

        /// <summary>§2.5 のエラーコードの表（スキーマの errorCatalog と同じ 20 行）。</summary>
        public static readonly ErrorRule[] ErrorCatalog =
        {
            new ErrorRule("INVALID_ARGUMENT", "client-bug", false),
            new ErrorRule("INVALID_JSON", "client-bug", false),
            new ErrorRule("PERMISSION_DENIED", "client-bug", false),
            new ErrorRule("IDEMPOTENCY_KEY_REUSED", "client-bug", false),
            new ErrorRule("PAYLOAD_TOO_LARGE", "client-bug", false),
            new ErrorRule("NOT_FOUND", "not-found", false),
            new ErrorRule("NOT_READY_FOR_PRODUCTION", "unavailable", false),
            new ErrorRule("INTERNAL_ERROR", "network", true),
            new ErrorRule("RATE_LIMITED", "busy", true),
            new ErrorRule("UNAUTHENTICATED", "session", false),
            new ErrorRule("TOKEN_EXPIRED", "session", false),
            new ErrorRule("PLAYER_BANNED", "banned", false),
            new ErrorRule("SAVE_CONFLICT", "conflict", false),
            new ErrorRule("SLOT_LIMIT_EXCEEDED", "limit", false),
            new ErrorRule("INVENTORY_LIMIT_EXCEEDED", "limit", false),
            new ErrorRule("PLAYER_DATA_LIMIT_EXCEEDED", "limit", false),
            new ErrorRule("RANKING_LIMIT_EXCEEDED", "limit", false),
            new ErrorRule("EVENT_NOT_ACTIVE", "expired", false),
            new ErrorRule("QUEST_NOT_ACTIVE", "expired", false),
            new ErrorRule("QUEST_NOT_COMPLETED", "not-ready", false),
        };

        /// <summary>§2.2 の操作ごとの再試行の種類（スキーマの 20 の操作の x-retry）。</summary>
        public static readonly OperationRule[] OperationRetry =
        {
            new OperationRule("getHealth", "safe"),
            new OperationRule("issueGuest", "new-resource"),
            new OperationRule("listAnnouncements", "safe"),
            new OperationRule("getRanking", "safe"),
            new OperationRule("submitScore", "natural-key"),
            new OperationRule("listSaves", "safe"),
            new OperationRule("getSave", "safe"),
            new OperationRule("putSave", "revision"),
            new OperationRule("deleteSave", "revision"),
            new OperationRule("getConfig", "safe"),
            new OperationRule("getMasterData", "safe"),
            new OperationRule("getInventory", "safe"),
            new OperationRule("listInventoryHistory", "safe"),
            new OperationRule("listEvents", "safe"),
            new OperationRule("claimEventReward", "natural-key"),
            new OperationRule("getPlayerData", "safe"),
            new OperationRule("writePlayerData", "idempotency-key"),
            new OperationRule("listQuests", "safe"),
            new OperationRule("claimQuest", "natural-key"),
            new OperationRule("refreshToken", "new-resource"),
        };

        /// <summary>表に無いコード・JSON でない 4xx の種類（§2.5）。</summary>
        public const string UnknownCategory = "unknown";

        /// <summary>コードの無い回線断・タイムアウト・5xx の種類（§2.4）。</summary>
        public const string NetworkCategory = "network";

        /// <summary>429 のコードの無い応答の種類（§2.3）。</summary>
        public const string BusyCategory = "busy";

        /// <summary>トークンが無い・期限切れ・壊れたときの種類（§2.7）。</summary>
        public const string SessionCategory = "session";

        private static Dictionary<string, ErrorRule> errorsByCode;
        private static Dictionary<string, string> kindsByOperation;

        /// <summary>コードの行を引く。表に無ければ false。</summary>
        public static bool TryGetError(string code, out ErrorRule rule)
        {
            if (errorsByCode == null)
            {
                var map = new Dictionary<string, ErrorRule>();
                foreach (var r in ErrorCatalog) map[r.Code] = r;
                errorsByCode = map;
            }
            rule = default;
            return code != null && errorsByCode.TryGetValue(code, out rule);
        }

        /// <summary>操作の再試行の種類。知らない操作は null（自動で送り直さない）。</summary>
        public static string RetryKindOf(string operationId)
        {
            if (kindsByOperation == null)
            {
                var map = new Dictionary<string, string>();
                foreach (var r in OperationRetry) map[r.OperationId] = r.Kind;
                kindsByOperation = map;
            }
            return operationId != null && kindsByOperation.TryGetValue(operationId, out var kind) ? kind : null;
        }

        /// <summary>再試行の n 回目（1 から）の前に待つ上限の秒（基本 × 倍率の n-1 乗・上限で頭打ち）。</summary>
        public static int BackoffCapSeconds(int retryNumber)
        {
            double cap = BackoffBaseSeconds * System.Math.Pow(BackoffFactor, retryNumber - 1);
            return (int)System.Math.Min(BackoffMaxSeconds, cap);
        }

        /// <summary>状態コードが再試行する状態か。</summary>
        public static bool IsRetryStatus(long status)
        {
            foreach (var s in RetryStatuses) if (s == status) return true;
            return false;
        }
    }
}
