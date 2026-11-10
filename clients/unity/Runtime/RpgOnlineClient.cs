// RpgOnlineClient.cs — Unity のクライアント層の HTTP と再試行。UnityWebRequest で送り、async／await（Task）で待つ。ゲームのクライアントの口 20 個。
//
// 決まり（タイムアウト・再試行・Retry-After・画面の文の種類）は docs/guides/working/client-integration-design.md §2・§6.3 と、
// ブラウザの SDK（clients/browser/rpg-online-client.mjs の request()）と同じ。値は RpgOnlineClientPolicy からだけ読み、ここに直に書かない。
// 再試行は Request() の 1 か所だけで決め、操作の関数には書かない。失敗は例外にせず RpgOnlineResult（Ok=false・Error）で返す。
// 送信・待ち・再試行の間にメインのスレッドで同期の待ちをしない（ブロックする待ちの呼び出しを使わない）。待ちは差し替えられる Delay（既定は Task.Delay）で、
// Unity の同期の文脈（UnitySynchronizationContext）により await の続きはメインのスレッドに戻る（要確認: 専用 PC の版・WebGL では Task.Delay が使えない）。
// トークンは ISessionStore にだけ置き、結果にもログにも出さない。自分で Unity のコンソールに出さず、ログは Log の口（RequestLogEvent。トークンと本文を含まない）だけ。
// Unity 2021.3 LTS 以上を前提にし、Awaitable（2023.1 から）は使わない。JSON は JsonUtility（自由な形の値は文字列のまま。応答の生の本文は Text に残す）。
// Steam などの認証は作らない（設計書 §8。既定はゲストのトークン）。
//
// 概要記述: Claude Opus 5.5 — 2026-11-01

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Networking;

namespace RpgOnline
{
    /// <summary>失敗の中身（ブラウザの SDK の { code, category, status, retryable, reason, outcomeUnknown } に当たる）。</summary>
    [Serializable]
    public sealed class RpgOnlineError
    {
        /// <summary>サーバーのエラーコード。回線断・タイムアウト・JSON でない応答は null。</summary>
        public string code;
        /// <summary>画面の文の種類（§2.5 の 11 と unknown）。ゲームはこれで文を選ぶ。</summary>
        public string category;
        /// <summary>HTTP の状態コード。応答が無い（回線断・タイムアウト）ときは 0。</summary>
        public long status;
        /// <summary>決まりの上で再試行してよい失敗で、その操作が自動の再試行を許すか。</summary>
        public bool retryable;
        /// <summary>開発者が読む理由（画面に出さない）。</summary>
        public string reason;
        /// <summary>revision の操作（セーブの書き込み・削除）が通信の失敗で終わり、書けたか分からない（§2.4。ConfirmSaveAsync で読み直す）。</summary>
        public bool outcomeUnknown;
    }

    /// <summary>操作 1 つの結果。成功は Ok=true と Status・Text、失敗は Ok=false と Error。</summary>
    public sealed class RpgOnlineResult
    {
        public bool Ok;
        public long Status;
        /// <summary>応答の生の本文（304 は空）。型にするときは As&lt;T&gt;() を使う。</summary>
        public string Text = "";
        public string ETag;
        public int Attempts;
        public RpgOnlineError Error;

        /// <summary>本文を JsonUtility で型にする。本文が空・JSON でないときは default。</summary>
        public T As<T>() where T : class
        {
            if (string.IsNullOrEmpty(Text)) return null;
            try { return JsonUtility.FromJson<T>(Text); }
            catch (ArgumentException) { return null; }
        }
    }

    /// <summary>要求ごとのログの記録（トークンと本文を含まない）。</summary>
    public struct RequestLogEvent
    {
        public string OperationId;
        public string Method;
        public string Path;
        public int Attempt;
        public long Status;
        public string Reason;
        public int WaitMs;
        public long DurationMs;
    }

    /// <summary>トークンの保存先。既定は PlayerPrefs（要確認: 長期の秘密として安全ではない。設計書 §2.7）。</summary>
    public interface ISessionStore
    {
        string Load(string key);
        void Save(string key, string value);
        void Delete(string key);
    }

    /// <summary>PlayerPrefs に置く既定の保存先。</summary>
    public sealed class PlayerPrefsSessionStore : ISessionStore
    {
        public string Load(string key) => PlayerPrefs.HasKey(key) ? PlayerPrefs.GetString(key) : null;
        public void Save(string key, string value) { PlayerPrefs.SetString(key, value); PlayerPrefs.Save(); }
        public void Delete(string key) { PlayerPrefs.DeleteKey(key); PlayerPrefs.Save(); }
    }

    /// <summary>保存したセッション（トークンを除く）。</summary>
    [Serializable]
    public sealed class RpgOnlineSessionInfo
    {
        public string gameId;
        public string playerId;
        public string expiresAt;
    }

    [Serializable]
    internal sealed class StoredSession
    {
        public string gameId;
        public string playerId;
        public string token;
        public string expiresAt;
    }

    [Serializable] internal sealed class ErrorEnvelope { public ErrorBody error; }
    [Serializable] internal sealed class ErrorBody { public string code; }
    [Serializable] internal sealed class GuestBody { public string gameId; }
    [Serializable] internal sealed class ScoreBody { public string gameId; public string playerId; public string displayName; public int score; }
    [Serializable] internal sealed class SaveBody { public int formatVersion; public string data; public string checksum; public int baseRevision; }
    [Serializable] public sealed class PlayerDataChange { public string key; public int value; }
    [Serializable] internal sealed class PlayerDataBody { public PlayerDataChange[] changes; }

    /// <summary>クライアントの作りの差し替え口（試験・人の確かめで時計・待ち・乱数・保存先を替える）。</summary>
    public sealed class RpgOnlineClientOptions
    {
        public string BaseUrl = "http://127.0.0.1:8787";
        public string GameId = "demo-rpg";
        /// <summary>ミリ秒だけ待つ。既定は Task.Delay（メインのスレッドを止めない）。</summary>
        public Func<int, Task> Delay;
        /// <summary>0 以上 1 以下の乱数（全幅の揺らぎ）。</summary>
        public Func<double> Random;
        /// <summary>端末の今（UTC）。</summary>
        public Func<DateTime> UtcNow;
        public ISessionStore Store;
        /// <summary>要求ごとの記録を受ける口（トークンと本文を含まない）。</summary>
        public Action<RequestLogEvent> Log;
    }

    /// <summary>
    /// Unity のクライアント層の入口。操作ごとの関数は Task&lt;RpgOnlineResult&gt; を返す（await で待つ。フレームは止まらない）。
    /// </summary>
    public sealed class RpgOnlineClient
    {
        public readonly string GameId;
        private readonly string root;
        private readonly Func<int, Task> delay;
        private readonly Func<double> random;
        private readonly Func<DateTime> utcNow;
        private readonly ISessionStore store;
        private readonly Action<RequestLogEvent> log;
        private readonly string sessionKey;
        private Task<RpgOnlineResult> refreshing;

        public RpgOnlineClient(RpgOnlineClientOptions options = null)
        {
            options ??= new RpgOnlineClientOptions();
            GameId = options.GameId;
            root = options.BaseUrl.TrimEnd('/');
            delay = options.Delay ?? (ms => Task.Delay(ms));
            var rng = new System.Random();
            random = options.Random ?? (() => rng.NextDouble());
            utcNow = options.UtcNow ?? (() => DateTime.UtcNow);
            store = options.Store ?? new PlayerPrefsSessionStore();
            log = options.Log ?? (_ => { });
            sessionKey = "rpg-online:" + GameId + ":session";
        }

        // ---- 画面の文の種類（§2.5） ----

        /// <summary>エラーのコードと状態コードから画面の文の種類を決める。表に無いコードと JSON でない 4xx は unknown、コードの無い回線断・タイムアウト・5xx は network。</summary>
        public static string Categorize(long status, string code)
        {
            if (!string.IsNullOrEmpty(code))
                return RpgOnlineClientPolicy.TryGetError(code, out var rule) ? rule.Category : RpgOnlineClientPolicy.UnknownCategory;
            if (status == 0 || status >= 500) return RpgOnlineClientPolicy.NetworkCategory;
            if (status == 429) return RpgOnlineClientPolicy.BusyCategory;
            return RpgOnlineClientPolicy.UnknownCategory;
        }

        /// <summary>Retry-After の見出しの値を秒（1〜上限）にする。無い・数でない・0・上限を超えるときは -1（待たずに返す。§2.3）。</summary>
        public static int ParseRetryAfter(string value)
        {
            if (string.IsNullOrEmpty(value)) return -1;
            var t = value.Trim();
            if (t.Length == 0 || t.Length > 9) return -1;
            foreach (var ch in t) if (ch < '0' || ch > '9') return -1;
            int seconds = int.Parse(t, CultureInfo.InvariantCulture);
            return seconds >= 1 && seconds <= RpgOnlineClientPolicy.RetryAfterMaxWaitSeconds ? seconds : -1;
        }

        /// <summary>text の UTF-8 のバイト列の SHA-256 を小文字の 16 進で返す（セーブの checksum）。</summary>
        public static string Sha256Hex(string text)
        {
            using (var sha = SHA256.Create())
            {
                var digest = sha.ComputeHash(Encoding.UTF8.GetBytes(text));
                var sb = new StringBuilder(digest.Length * 2);
                foreach (var b in digest) sb.Append(b.ToString("x2", CultureInfo.InvariantCulture));
                return sb.ToString();
            }
        }

        // ---- セッション（トークン） ----

        private StoredSession ReadSession()
        {
            try
            {
                var raw = store.Load(sessionKey);
                if (string.IsNullOrEmpty(raw)) return null;
                var s = JsonUtility.FromJson<StoredSession>(raw);
                return s != null && !string.IsNullOrEmpty(s.token) ? s : null;
            }
            catch (ArgumentException)
            {
                return null;
            }
        }

        /// <summary>発行・更新の応答の本文を保存し、トークンを除いた本文を結果の Text に戻す。</summary>
        private RpgOnlineResult StoreSession(RpgOnlineResult res)
        {
            var s = res.As<StoredSession>();
            if (s == null || string.IsNullOrEmpty(s.token)) return res;
            store.Save(sessionKey, JsonUtility.ToJson(s));
            res.Text = JsonUtility.ToJson(new RpgOnlineSessionInfo { gameId = s.gameId, playerId = s.playerId, expiresAt = s.expiresAt });
            return res;
        }

        /// <summary>保存したセッション（トークンを除く）。無ければ null。</summary>
        public RpgOnlineSessionInfo Session()
        {
            var s = ReadSession();
            return s == null ? null : new RpgOnlineSessionInfo { gameId = s.gameId, playerId = s.playerId, expiresAt = s.expiresAt };
        }

        /// <summary>保存したセッションを消す（ゲームが「新しく始める」を選んだとき）。</summary>
        public void ClearSession() => store.Delete(sessionKey);

        private bool NeedsRefresh(StoredSession session)
        {
            if (!DateTime.TryParse(session.expiresAt, CultureInfo.InvariantCulture,
                    DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var expiresAt)) return false;
            return (expiresAt - utcNow()).TotalSeconds < RpgOnlineClientPolicy.TokenRefreshBeforeSeconds;
        }

        private Task<RpgOnlineResult> RefreshOnce()
        {
            if (refreshing != null) return refreshing;
            var task = RefreshCore();
            // セッションが無いときは同期で終わり、finally が先に走る。終わった Task を持ち続けないよう、進行中のときだけ覚える
            if (!task.IsCompleted) refreshing = task;
            return task;
        }

        private async Task<RpgOnlineResult> RefreshCore()
        {
            try
            {
                var res = await Request("refreshToken", "POST", "/v1/accounts/token", null, null, true, null, true);
                return res.Ok ? StoreSession(res) : res;
            }
            finally
            {
                refreshing = null;
            }
        }

        // ---- 送り方と再試行（ここ 1 か所） ----

        private struct Outcome
        {
            public bool Failed;
            public string Failure;
            public long Status;
            public string Text;
            public string RetryAfter;
            public string ETag;
        }

        /// <summary>UnityWebRequest の完了を Task で待つ（コールバックで解く。ブロックしない）。</summary>
        private static Task AwaitOperation(UnityWebRequestAsyncOperation op)
        {
            if (op.isDone) return Task.CompletedTask;
            var tcs = new TaskCompletionSource<bool>();
            op.completed += _ => tcs.TrySetResult(true);
            return tcs.Task;
        }

        /// <summary>1 回だけ送る。タイムアウトは UnityWebRequest.timeout（秒）で切る。応答が無いときは Failed。</summary>
        private static async Task<Outcome> SendOnce(string url, string method, string json, Dictionary<string, string> headers)
        {
            using (var req = new UnityWebRequest(url, method))
            {
                req.downloadHandler = new DownloadHandlerBuffer();
                if (json != null)
                {
                    req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
                    req.SetRequestHeader("Content-Type", "application/json");
                }
                foreach (var h in headers) req.SetRequestHeader(h.Key, h.Value);
                req.timeout = RpgOnlineClientPolicy.TimeoutSeconds;
                try
                {
                    await AwaitOperation(req.SendWebRequest());
                }
                catch (Exception e) when (e is InvalidOperationException || e is ArgumentException || e is UriFormatException)
                {
                    // 送る前に断られた（http が許されていない・URL が不正など）。例外にせず回線断として返す
                    return new Outcome { Failed = true, Failure = "network: " + e.GetType().Name };
                }

                // 応答が届かなかった（回線断・タイムアウト）ときは responseCode が 0
                if (req.responseCode == 0)
                {
                    var err = req.error ?? "network";
                    return new Outcome { Failed = true, Failure = err.IndexOf("timeout", StringComparison.OrdinalIgnoreCase) >= 0 ? "timeout" : "network" };
                }
                return new Outcome
                {
                    Status = req.responseCode,
                    Text = req.downloadHandler?.text ?? "",
                    RetryAfter = req.GetResponseHeader("Retry-After"),
                    ETag = req.GetResponseHeader("ETag"),
                };
            }
        }

        private static string BuildQuery(string path, IList<KeyValuePair<string, string>> query)
        {
            if (query == null || query.Count == 0) return path;
            var sb = new StringBuilder(path);
            var first = true;
            foreach (var kv in query)
            {
                if (kv.Value == null) continue;
                sb.Append(first ? '?' : '&').Append(Uri.EscapeDataString(kv.Key)).Append('=').Append(Uri.EscapeDataString(kv.Value));
                first = false;
            }
            return sb.ToString();
        }

        private void Emit(RequestLogEvent e)
        {
            try { log(e); } catch (Exception) { /* ログの口の失敗で送り方を変えない */ }
        }

        /// <summary>
        /// 操作を 1 つ送る。再試行・Retry-After・画面の文の種類はここだけで決める（設計書 §2.1〜§2.5）。
        /// </summary>
        private async Task<RpgOnlineResult> Request(string operationId, string method, string path,
            IList<KeyValuePair<string, string>> query, string json, bool auth, Dictionary<string, string> extraHeaders, bool skipRefresh = false)
        {
            var kind = RpgOnlineClientPolicy.RetryKindOf(operationId);
            var autoRetry = kind != null && kind != RpgOnlineClientPolicy.NoAutoRetryKind;
            // new-resource は送り直すと別のものができる。何も作っていない 429 のときだけ送り直す（§2.2）
            var isRateLimitOnly = kind == RpgOnlineClientPolicy.RateLimitOnlyKind;
            var pathWithQuery = BuildQuery(path, query);
            var headers = extraHeaders != null ? new Dictionary<string, string>(extraHeaders) : new Dictionary<string, string>();

            if (auth)
            {
                var session = ReadSession();
                if (session == null)
                {
                    return new RpgOnlineResult
                    {
                        Ok = false,
                        Error = new RpgOnlineError { category = RpgOnlineClientPolicy.SessionCategory, reason = "no-session" },
                    };
                }
                if (!skipRefresh && NeedsRefresh(session))
                {
                    var refreshed = await RefreshOnce();
                    // 期限切れ・壊れたトークンは更新できない。ゲストを発行し直さず session を返す（§2.7）
                    if (!refreshed.Ok && refreshed.Error.category == RpgOnlineClientPolicy.SessionCategory) return refreshed;
                    session = ReadSession() ?? session;
                }
                headers["Authorization"] = "Bearer " + session.token;
            }

            var attempts = 0;
            var rateLimitRetries = 0;
            while (true)
            {
                attempts += 1;
                var started = utcNow();
                var outcome = await SendOnce(root + pathWithQuery, method, json, headers);
                var status = outcome.Failed ? 0 : outcome.Status;
                Emit(new RequestLogEvent
                {
                    OperationId = operationId, Method = method, Path = pathWithQuery, Attempt = attempts, Status = status,
                    Reason = outcome.Failed ? outcome.Failure : null, DurationMs = (long)(utcNow() - started).TotalMilliseconds,
                });

                if (!outcome.Failed && ((status >= 200 && status < 300) || status == 304))
                {
                    return new RpgOnlineResult { Ok = true, Status = status, Text = outcome.Text ?? "", ETag = outcome.ETag, Attempts = attempts };
                }

                string code = null;
                if (!outcome.Failed && !string.IsNullOrEmpty(outcome.Text))
                {
                    try
                    {
                        var env = JsonUtility.FromJson<ErrorEnvelope>(outcome.Text);
                        if (env?.error != null && !string.IsNullOrEmpty(env.error.code)) code = env.error.code;
                    }
                    catch (ArgumentException) { /* JSON でない応答は状態コードだけで扱う（§2.4） */ }
                }
                var category = Categorize(status, code);
                var reason = outcome.Failed ? outcome.Failure : (code != null ? "HTTP " + status + " " + code : "HTTP " + status);
                // 決まりの上で再試行してよい失敗か（コードが表にあれば表の retry、コードが無ければ回線断・タイムアウトと再試行する状態）
                bool retryableByPolicy = code != null
                    ? RpgOnlineClientPolicy.TryGetError(code, out var rule) && rule.Retry
                    : outcome.Failed || RpgOnlineClientPolicy.IsRetryStatus(status);
                var isRevision = kind == RpgOnlineClientPolicy.NoAutoRetryKind;
                var retryableByKind = !isRateLimitOnly || status == 429;

                RpgOnlineResult Fail(string extra) => new RpgOnlineResult
                {
                    Ok = false,
                    Status = status,
                    Attempts = attempts,
                    Error = new RpgOnlineError
                    {
                        code = code,
                        category = category,
                        status = status,
                        retryable = autoRetry && retryableByPolicy && retryableByKind,
                        reason = string.IsNullOrEmpty(extra) ? reason : reason + " (" + extra + ")",
                        // revision の操作が通信の失敗・5xx で終わったら、書けたかどうか分からない（§2.4）
                        outcomeUnknown = isRevision && category == RpgOnlineClientPolicy.NetworkCategory,
                    },
                };

                if (!autoRetry || !retryableByPolicy)
                    return Fail(isRevision && category == RpgOnlineClientPolicy.NetworkCategory ? "not retried: revision" : "");
                if (!retryableByKind) return Fail("not retried: new-resource");
                if (attempts >= RpgOnlineClientPolicy.MaxAttempts) return Fail("gave up after " + attempts + " attempts");

                int waitMs;
                if (status == 429)
                {
                    var seconds = ParseRetryAfter(outcome.RetryAfter);
                    if (seconds < 0) return Fail("no usable Retry-After");
                    if (rateLimitRetries >= RpgOnlineClientPolicy.RetryAfterMaxRetries) return Fail("rate limited again");
                    rateLimitRetries += 1;
                    waitMs = seconds * 1000;
                }
                else
                {
                    var cap = RpgOnlineClientPolicy.BackoffCapSeconds(attempts) * 1000;
                    waitMs = RpgOnlineClientPolicy.BackoffJitter == "full" ? (int)Math.Round(random() * cap) : cap;
                }
                Emit(new RequestLogEvent { OperationId = operationId, Method = method, Path = pathWithQuery, Attempt = attempts, Status = status, Reason = "retry-wait", WaitMs = waitMs });
                await delay(waitMs);
            }
        }

        private static List<KeyValuePair<string, string>> Q(params string[] pairs)
        {
            var list = new List<KeyValuePair<string, string>>();
            for (var i = 0; i + 1 < pairs.Length; i += 2) list.Add(new KeyValuePair<string, string>(pairs[i], pairs[i + 1]));
            return list;
        }

        private static string Enc(string s) => Uri.EscapeDataString(s);

        // ---- 操作（20 個） ----

        public Task<RpgOnlineResult> GetHealthAsync() => Request("getHealth", "GET", "/health", null, null, false, null);

        /// <summary>ゲストを発行し、トークンを保存先に置く。結果の Text にトークンは入れない。</summary>
        public async Task<RpgOnlineResult> IssueGuestAsync()
        {
            var res = await Request("issueGuest", "POST", "/v1/accounts/guest", null, JsonUtility.ToJson(new GuestBody { gameId = GameId }), false, null);
            return res.Ok ? StoreSession(res) : res;
        }

        /// <summary>保存したトークンを、期限を先にした新しいトークンに取り替える。期限まで 7 日を切っていれば、トークンの要る要求の前に自分で呼ぶ。</summary>
        public Task<RpgOnlineResult> RefreshTokenAsync() => RefreshOnce();

        public Task<RpgOnlineResult> ListAnnouncementsAsync() => Request("listAnnouncements", "GET", "/v1/announcements", Q("gameId", GameId), null, false, null);

        public Task<RpgOnlineResult> GetRankingAsync(string boardId, int limit = 0) =>
            Request("getRanking", "GET", "/v1/rankings/" + Enc(boardId),
                Q("gameId", GameId, "limit", limit > 0 ? limit.ToString(CultureInfo.InvariantCulture) : null), null, false, null);

        public Task<RpgOnlineResult> SubmitScoreAsync(string boardId, int score, string displayName)
        {
            var body = new ScoreBody { gameId = GameId, playerId = ReadSession()?.playerId, displayName = displayName, score = score };
            return Request("submitScore", "POST", "/v1/rankings/" + Enc(boardId), null, JsonUtility.ToJson(body), true, null);
        }

        public Task<RpgOnlineResult> ListSavesAsync() => Request("listSaves", "GET", "/v1/saves", Q("gameId", GameId), null, true, null);

        public Task<RpgOnlineResult> GetSaveAsync(string slotId) => Request("getSave", "GET", "/v1/saves/" + Enc(slotId), Q("gameId", GameId), null, true, null);

        /// <summary>セーブを書く（revision の種類なので自動で送り直さない。outcomeUnknown なら ConfirmSaveAsync で読み直す）。</summary>
        public Task<RpgOnlineResult> PutSaveAsync(string slotId, string data, string checksum, int baseRevision, int formatVersion = 1)
        {
            var body = new SaveBody { formatVersion = formatVersion, data = data, checksum = checksum, baseRevision = baseRevision };
            return Request("putSave", "PUT", "/v1/saves/" + Enc(slotId), Q("gameId", GameId), JsonUtility.ToJson(body), true, null);
        }

        public Task<RpgOnlineResult> DeleteSaveAsync(string slotId, int baseRevision) =>
            Request("deleteSave", "DELETE", "/v1/saves/" + Enc(slotId),
                Q("gameId", GameId, "baseRevision", baseRevision.ToString(CultureInfo.InvariantCulture)), null, true, null);

        /// <summary>
        /// 結果が分からないセーブの書き込み・削除を読み直して確かめる（§2.4）。expectedRevision が負なら消えている（404）こと、
        /// そうでなければ revision と checksum が同じことを見る。確かめられたら true。
        /// </summary>
        public async Task<bool> ConfirmSaveAsync(string slotId, int expectedRevision, string expectedChecksum)
        {
            var res = await GetSaveAsync(slotId);
            if (expectedRevision < 0) return !res.Ok && res.Error.status == 404;
            if (!res.Ok) return false;
            var save = res.As<SaveData>();
            return save != null && save.revision == expectedRevision && save.checksum == expectedChecksum;
        }

        public Task<RpgOnlineResult> GetConfigAsync(string clientVersion, string etag = null) =>
            Request("getConfig", "GET", "/v1/config", Q("gameId", GameId, "clientVersion", clientVersion), null, false,
                etag != null ? new Dictionary<string, string> { { "If-None-Match", etag } } : null);

        public Task<RpgOnlineResult> GetMasterDataAsync(string key, string etag = null) =>
            Request("getMasterData", "GET", "/v1/config/master/" + Enc(key), Q("gameId", GameId), null, false,
                etag != null ? new Dictionary<string, string> { { "If-None-Match", etag } } : null);

        public Task<RpgOnlineResult> GetInventoryAsync() => Request("getInventory", "GET", "/v1/inventory", Q("gameId", GameId), null, true, null);

        /// <summary>受領の履歴を 1 ページ読む。before が 0 なら最初から（続きは応答の nextBefore。無ければ 0）。</summary>
        public Task<RpgOnlineResult> ListInventoryHistoryAsync(int limit = 0, int before = 0) =>
            Request("listInventoryHistory", "GET", "/v1/inventory/history",
                Q("gameId", GameId,
                    "limit", limit > 0 ? limit.ToString(CultureInfo.InvariantCulture) : null,
                    "before", before > 0 ? before.ToString(CultureInfo.InvariantCulture) : null), null, true, null);

        /// <summary>受領の履歴を nextBefore が無くなるまで読む（§2.6。1 回の呼び出しで読むページの上限は maxPages）。失敗したらその結果を返す。</summary>
        public async Task<(RpgOnlineResult last, List<InventoryHistoryEntry> items, bool complete)> ReadAllInventoryHistoryAsync(int limit = 100, int maxPages = 10)
        {
            var items = new List<InventoryHistoryEntry>();
            var before = 0;
            for (var pages = 1; ; pages++)
            {
                var res = await ListInventoryHistoryAsync(limit, before);
                if (!res.Ok) return (res, items, false);
                var page = res.As<InventoryHistory>();
                if (page?.items != null) items.AddRange(page.items);
                before = page?.nextBefore ?? 0;
                if (before <= 0) return (res, items, true);
                if (pages >= maxPages) return (res, items, false);
            }
        }

        public Task<RpgOnlineResult> ListEventsAsync() => Request("listEvents", "GET", "/v1/events", Q("gameId", GameId), null, true, null);

        public Task<RpgOnlineResult> ClaimEventRewardAsync(string eventId) =>
            Request("claimEventReward", "POST", "/v1/events/" + Enc(eventId) + "/claim", Q("gameId", GameId), null, true, null);

        public Task<RpgOnlineResult> GetPlayerDataAsync() => Request("getPlayerData", "GET", "/v1/player-data", Q("gameId", GameId), null, true, null);

        /// <summary>
        /// 統計値を書く。呼び出しごとに新しい Idempotency-Key（Guid.NewGuid()）を作り、再試行では同じ鍵を使う。
        /// 同じ書き込みをゲームが送り直すときだけ、前の鍵を idempotencyKey に渡す。
        /// </summary>
        public Task<RpgOnlineResult> WritePlayerDataAsync(PlayerDataChange[] changes, string idempotencyKey = null)
        {
            var key = idempotencyKey ?? Guid.NewGuid().ToString();
            return Request("writePlayerData", "POST", "/v1/player-data", Q("gameId", GameId),
                JsonUtility.ToJson(new PlayerDataBody { changes = changes }), true,
                new Dictionary<string, string> { { "Idempotency-Key", key } });
        }

        public Task<RpgOnlineResult> ListQuestsAsync() => Request("listQuests", "GET", "/v1/quests", Q("gameId", GameId), null, true, null);

        public Task<RpgOnlineResult> ClaimQuestAsync(string questId) =>
            Request("claimQuest", "POST", "/v1/quests/" + Enc(questId) + "/claim", Q("gameId", GameId), null, true, null);
    }

    // ---- 応答の型（JsonUtility で読む。スキーマ openapi/rpg-online.v1.json の components.schemas の欄の名前のまま。使う欄だけ） ----

    [Serializable] public sealed class HealthData { public string status; }
    [Serializable] public sealed class ClientVersionInfo { public string update; }
    [Serializable] public sealed class MasterDataEntry { public string key; public int size; }
    [Serializable] public sealed class ConfigData { public string gameId; public ClientVersionInfo clientVersion; public MasterDataEntry[] masterData; }
    [Serializable] public sealed class MasterData { public string key; public string data; }
    [Serializable] public sealed class Announcement { public string id; public string title; }
    [Serializable] public sealed class AnnouncementList { public Announcement[] items; }
    [Serializable] public sealed class RankingEntry { public string playerId; public string displayName; public int score; }
    [Serializable] public sealed class RankingList { public RankingEntry[] items; }
    [Serializable] public sealed class SaveData { public string slotId; public int revision; public int formatVersion; public string data; public string checksum; }
    [Serializable] public sealed class SaveList { public SaveData[] items; }
    [Serializable] public sealed class InventoryEntry { public string itemId; public int amount; }
    [Serializable] public sealed class Inventory { public InventoryEntry[] currencies; public InventoryEntry[] items; }
    [Serializable] public sealed class InventoryHistoryEntry { public int entryId; public string itemId; public int delta; public string sourceType; public string sourceId; }
    [Serializable] public sealed class InventoryHistory { public InventoryHistoryEntry[] items; public int nextBefore; }
    [Serializable] public sealed class EventInfo { public string eventId; public string kind; public string startsAt; public string endsAt; public string nextResetAt; public bool claimed; }
    [Serializable] public sealed class EventList { public string serverTime; public EventInfo[] items; }
    [Serializable] public sealed class ClaimResult { public string claimId; public string periodKey; public InventoryEntry[] grants; }
    [Serializable] public sealed class PlayerDataValue { public string key; public int value; }
    [Serializable] public sealed class PlayerAchievement { public string achievementId; }
    [Serializable] public sealed class PlayerData { public PlayerDataValue[] values; public PlayerAchievement[] achievements; }
    [Serializable] public sealed class PlayerDataWritten { public string writeId; public PlayerDataValue[] values; public PlayerAchievement[] unlocked; }
    [Serializable] public sealed class QuestInfo { public string questId; public string startsAt; public string endsAt; public string nextResetAt; public bool completed; public bool claimed; }
    [Serializable] public sealed class QuestList { public string serverTime; public QuestInfo[] items; }

    /// <summary>
    /// サーバーの時刻と端末の時刻の差（§2.8）。一覧（イベント・クエスト）を読むたびに Update で取り直し、残り時間の表示だけに使う。
    /// 期間の内か外か・受け取れるかはサーバーが決める（端末の時刻で判断しない）。
    /// </summary>
    public sealed class ServerClock
    {
        private TimeSpan offset = TimeSpan.Zero;

        public static bool TryParseTime(string iso, out DateTime utc) =>
            DateTime.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out utc);

        /// <summary>差 = serverTime − 端末の今 を覚える。</summary>
        public void Update(string serverTime, DateTime deviceUtcNow)
        {
            if (TryParseTime(serverTime, out var server)) offset = server - deviceUtcNow;
        }

        /// <summary>サーバーの時刻での今（端末の今 + 差）。</summary>
        public DateTime Now(DateTime deviceUtcNow) => deviceUtcNow + offset;

        /// <summary>until（endsAt・nextResetAt）までの残り。読めない・過ぎたときは 0。</summary>
        public TimeSpan Remaining(string until, DateTime deviceUtcNow)
        {
            if (!TryParseTime(until, out var end)) return TimeSpan.Zero;
            var left = end - Now(deviceUtcNow);
            return left > TimeSpan.Zero ? left : TimeSpan.Zero;
        }
    }
}
