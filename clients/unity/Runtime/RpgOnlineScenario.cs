// RpgOnlineScenario.cs — §4 の同一の API シナリオ（Unity 版）と、専用 PC で人が見るための小さな部品（MonoBehaviour。H2〜H4）。
//
// 手順の名前と順は、ブラウザの SDK（clients/browser/rpg-online-client.mjs）の SCENARIO_STEPS と同じ。確かめの中身も runScenario() と同じ。
// 揃っていることは Mac の試験 test/unity-client.test.ts が、このファイルの Steps の行と case の行を文字列として読んで見る。
// 設計は docs/guides/working/client-integration-design.md §4・§6・§9（H2〜H4）。人の確かめの手順は docs/guides/procedures/unity-client-check.md。
// 失敗した手順で止まり、例外にせず ScenarioResult を返す。トークンとセーブの本体は結果にも画面にも出さない。
// 画面（OnGUI）にはフレームの数を出し、通信と再試行の待ちの間もフレームが進む（ゲームが止まらない）ことを人が見られるようにする。
// サンプルのゲームやシーンは作らない（Phase 4）。空のシーンの GameObject に付けて使う。
//
// 概要記述: Claude Opus 5.5 — 2026-11-01

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using UnityEngine;

namespace RpgOnline
{
    /// <summary>手順 1 つの結果。</summary>
    public sealed class ScenarioStep
    {
        public string Name;
        public bool Ok;
        public string Detail;
        public string Category;
    }

    /// <summary>シナリオ全体の結果。失敗したら FailedName・FailedCategory・FailedReason が入る。</summary>
    public sealed class ScenarioResult
    {
        public bool Ok;
        public List<ScenarioStep> Steps = new List<ScenarioStep>();
        public string FailedName;
        public string FailedCategory;
        public string FailedReason;
    }

    /// <summary>シナリオが使う demo-rpg の手本（ブラウザの SDK の SCENARIO_DEFAULTS と同じ値）。</summary>
    public sealed class ScenarioOptions
    {
        public string ClientVersion = "1.0.0";
        public string BoardPrefix = "boss-score";
        public string DisplayName = "Unity Tester";
        public int Score = 1200;
        public string SlotId = "unity-smoke";
        public string EventId = "daily-login";
        public string PlayerDataKey = "slimes-defeated";
        public string AchievementId = "first-slime";
        public string QuestId = "first-hunt";
    }

    /// <summary>§4 のシナリオを流す部品。空のシーンの GameObject に付け、画面のボタンで H2〜H4 を見る。</summary>
    public sealed class RpgOnlineScenario : MonoBehaviour
    {
        /// <summary>§4 の手順の名前（順）。ブラウザの SDK の SCENARIO_STEPS と同じ。</summary>
        public static readonly string[] Steps =
        {
            "health", "config", "master-data", "announcements", "guest", "token-refresh", "ranking", "saves", "event-reward", "player-data", "quests",
        };

        private sealed class StepFailure : Exception
        {
            public readonly string Category;
            public StepFailure(string category, string reason) : base(reason) { Category = category; }
        }

        private static RpgOnlineResult Need(RpgOnlineResult res, string what)
        {
            if (!res.Ok) throw new StepFailure(res.Error.category, what + ": " + res.Error.reason);
            return res;
        }

        private static void Check(bool cond, string reason)
        {
            if (!cond) throw new StepFailure(RpgOnlineClientPolicy.UnknownCategory, reason);
        }

        private static string Base36(long value)
        {
            const string digits = "0123456789abcdefghijklmnopqrstuvwxyz";
            if (value <= 0) return "0";
            var sb = new StringBuilder();
            while (value > 0) { sb.Insert(0, digits[(int)(value % 36)]); value /= 36; }
            return sb.ToString();
        }

        private static int GoldOf(Inventory inv) => inv?.currencies?.FirstOrDefault(c => c.itemId == "gold")?.amount ?? 0;

        /// <summary>
        /// §4 のシナリオを流す。onStep は手順ごとに呼ばれる（画面の表に出す）。clock を渡すと、イベントの一覧の serverTime で差を取る（H4）。
        /// </summary>
        public static async Task<ScenarioResult> RunAsync(RpgOnlineClient client, ScenarioOptions o = null, Action<ScenarioStep> onStep = null, ServerClock clock = null)
        {
            o ??= new ScenarioOptions();
            clock ??= new ServerClock();
            var result = new ScenarioResult();
            ConfigData config = null;
            string playerId = null;
            string expiresAt = null;

            async Task<string> RunStep(string name)
            {
                switch (name)
                {
                    case "health":
                    {
                        var res = Need(await client.GetHealthAsync(), "GET /health");
                        Check(res.As<HealthData>()?.status == "ok", "Health check failed");
                        return "ok";
                    }
                    case "config":
                    {
                        var first = Need(await client.GetConfigAsync(o.ClientVersion), "GET /v1/config");
                        Check(first.Status == 200 && !string.IsNullOrEmpty(first.ETag), "Config could not be read");
                        config = first.As<ConfigData>();
                        Check(config?.clientVersion?.update != "required", "Client version is older than the minimum");
                        var again = Need(await client.GetConfigAsync(o.ClientVersion, first.ETag), "GET /v1/config (If-None-Match)");
                        Check(again.Status == 304, "Unchanged config was sent again (expected 304)");
                        return "200 then 304";
                    }
                    case "master-data":
                    {
                        var firstMaster = config?.masterData != null && config.masterData.Length > 0 ? config.masterData[0] : null;
                        if (firstMaster == null) return "none (skipped)";
                        var res = Need(await client.GetMasterDataAsync(firstMaster.key), "GET /v1/config/master");
                        var data = res.As<MasterData>()?.data;
                        var size = data != null ? Encoding.UTF8.GetByteCount(data) : -1;
                        Check(size == firstMaster.size, "Master data does not match the size in the config");
                        return firstMaster.key + " size=" + size;
                    }
                    case "announcements":
                    {
                        var res = Need(await client.ListAnnouncementsAsync(), "GET /v1/announcements");
                        return (res.As<AnnouncementList>()?.items?.Length ?? 0) + " items";
                    }
                    case "guest":
                    {
                        var res = Need(await client.IssueGuestAsync(), "POST /v1/accounts/guest");
                        var info = res.As<RpgOnlineSessionInfo>();
                        playerId = info?.playerId;
                        expiresAt = info?.expiresAt;
                        Check(!string.IsNullOrEmpty(playerId), "Guest was not issued");
                        return "player issued (expiresAt=" + expiresAt + ")";
                    }
                    case "token-refresh":
                    {
                        var res = Need(await client.RefreshTokenAsync(), "POST /v1/accounts/token");
                        var info = res.As<RpgOnlineSessionInfo>();
                        Check(info != null && info.playerId == playerId && info.gameId == client.GameId, "Refreshed token is for a different player");
                        Check(ServerClock.TryParseTime(info.expiresAt, out var after) && ServerClock.TryParseTime(expiresAt, out var before) && after >= before,
                            "Refreshed token expires earlier than the issued one");
                        return "same player (expiresAt=" + info.expiresAt + ")";
                    }
                    case "ranking":
                    {
                        var boardId = o.BoardPrefix + "-" + Base36(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                        Need(await client.SubmitScoreAsync(boardId, o.Score, o.DisplayName), "POST /v1/rankings");
                        var res = Need(await client.GetRankingAsync(boardId, 10), "GET /v1/rankings");
                        var items = res.As<RankingList>()?.items ?? Array.Empty<RankingEntry>();
                        Check(items.Any(e => e.playerId == playerId && e.score >= o.Score), "Submitted score not found in top 10");
                        return boardId + " found";
                    }
                    case "saves":
                    {
                        const string data = "{\"hp\":30,\"map\":\"town\"}";
                        var checksum = RpgOnlineClient.Sha256Hex(data);
                        var written = Need(await client.PutSaveAsync(o.SlotId, data, checksum, 0), "PUT /v1/saves").As<SaveData>();
                        var loaded = Need(await client.GetSaveAsync(o.SlotId), "GET /v1/saves/{slotId}").As<SaveData>();
                        Check(written != null && loaded != null && loaded.data == data && loaded.checksum == checksum && loaded.revision == written.revision
                            && RpgOnlineClient.Sha256Hex(loaded.data) == loaded.checksum, "Loaded save does not match the written one");
                        var listed = Need(await client.ListSavesAsync(), "GET /v1/saves").As<SaveList>();
                        var slot = listed?.items?.FirstOrDefault(i => i.slotId == o.SlotId);
                        Check(slot != null, "Written save not found in the save list");
                        Need(await client.DeleteSaveAsync(o.SlotId, slot.revision), "DELETE /v1/saves");
                        var gone = await client.GetSaveAsync(o.SlotId);
                        Check(!gone.Ok && gone.Error.status == 404, "Deleted save is still readable");
                        return "revision=" + written.revision + " written, read, listed, deleted";
                    }
                    case "event-reward":
                    {
                        var listed = Need(await client.ListEventsAsync(), "GET /v1/events").As<EventList>();
                        // 期間の残りはサーバーの時刻で出す（§2.8・H4）。差は一覧を読むたびに取り直す
                        clock.Update(listed?.serverTime, DateTime.UtcNow);
                        if (listed?.items == null || listed.items.Length == 0) return "none (skipped)";
                        var ev = listed.items.FirstOrDefault(i => i.eventId == o.EventId);
                        Check(ev != null && !ev.claimed, "Event " + o.EventId + " is not open and unclaimed");
                        var claimed = Need(await client.ClaimEventRewardAsync(o.EventId), "POST /v1/events/{eventId}/claim").As<ClaimResult>();
                        var granted = claimed?.grants?.FirstOrDefault(g => g.itemId == "gold")?.amount ?? 0;
                        var afterFirst = Need(await client.GetInventoryAsync(), "GET /v1/inventory").As<Inventory>();
                        Check(granted > 0 && GoldOf(afterFirst) == granted, "Claimed gold is not in the inventory");
                        var again = Need(await client.ClaimEventRewardAsync(o.EventId), "POST /v1/events/{eventId}/claim (again)").As<ClaimResult>();
                        Check(again?.claimId == claimed.claimId, "Second claim returned a different claimId");
                        var afterSecond = Need(await client.GetInventoryAsync(), "GET /v1/inventory").As<Inventory>();
                        Check(GoldOf(afterSecond) == granted, "Second claim granted the reward twice");
                        var history = await client.ReadAllInventoryHistoryAsync(20);
                        Need(history.last, "GET /v1/inventory/history");
                        Check(history.complete && history.items.Count == claimed.grants.Length && history.items.All(i => i.sourceId == claimed.claimId),
                            "Inventory history does not have exactly the claimed rows");
                        var remaining = clock.Remaining(UntilOf(ev), DateTime.UtcNow);
                        return "gold +" + granted + " once (serverTime=" + listed.serverTime + ", reset in " + FormatSpan(remaining) + ")";
                    }
                    case "player-data":
                    {
                        var before = Need(await client.GetPlayerDataAsync(), "GET /v1/player-data").As<PlayerData>();
                        Check((before?.values?.Length ?? 0) == 0 && (before?.achievements?.Length ?? 0) == 0, "New guest already has player data");
                        var idempotencyKey = Guid.NewGuid().ToString();
                        var changes = new[] { new PlayerDataChange { key = o.PlayerDataKey, value = 1 } };
                        var writtenRes = Need(await client.WritePlayerDataAsync(changes, idempotencyKey), "POST /v1/player-data");
                        var written = writtenRes.As<PlayerDataWritten>();
                        Check(written?.values?.FirstOrDefault(v => v.key == o.PlayerDataKey)?.value == 1
                            && (written.unlocked?.Any(a => a.achievementId == o.AchievementId) ?? false),
                            "Writing " + o.PlayerDataKey + " did not unlock " + o.AchievementId);
                        var resent = Need(await client.WritePlayerDataAsync(changes, idempotencyKey), "POST /v1/player-data (resend)");
                        Check(resent.Text == writtenRes.Text, "Resent player data write returned a different body");
                        var after = Need(await client.GetPlayerDataAsync(), "GET /v1/player-data").As<PlayerData>();
                        Check(after?.values?.FirstOrDefault(v => v.key == o.PlayerDataKey)?.value == 1, "Resent player data write was counted twice");
                        Check((after.achievements?.Count(a => a.achievementId == o.AchievementId) ?? 0) == 1,
                            "Achievement " + o.AchievementId + " is not unlocked exactly once");
                        return o.PlayerDataKey + "=1 once, " + o.AchievementId + " unlocked";
                    }
                    case "quests":
                    {
                        var before = Need(await client.ListQuestsAsync(), "GET /v1/quests").As<QuestList>();
                        clock.Update(before?.serverTime, DateTime.UtcNow);
                        var quest = before?.items?.FirstOrDefault(q => q.questId == o.QuestId);
                        Check(quest != null && quest.completed && !quest.claimed, "Quest " + o.QuestId + " is not completed and unclaimed");
                        var claimedRes = Need(await client.ClaimQuestAsync(o.QuestId), "POST /v1/quests/{questId}/claim");
                        Check(claimedRes.As<ClaimResult>()?.grants?.Any(g => g.itemId == "gold" && g.amount > 0) ?? false, "Quest " + o.QuestId + " granted no gold");
                        var again = Need(await client.ClaimQuestAsync(o.QuestId), "POST /v1/quests/{questId}/claim (again)");
                        Check(again.Text == claimedRes.Text, "Second quest claim returned a different body");
                        var after = Need(await client.ListQuestsAsync(), "GET /v1/quests").As<QuestList>();
                        Check(after?.items?.FirstOrDefault(q => q.questId == o.QuestId)?.claimed ?? false, "Quest " + o.QuestId + " is not marked as claimed");
                        return o.QuestId + " claimed once";
                    }
                    default:
                        throw new StepFailure(RpgOnlineClientPolicy.UnknownCategory, "unknown step " + name);
                }
            }

            foreach (var name in Steps)
            {
                ScenarioStep step;
                try
                {
                    step = new ScenarioStep { Name = name, Ok = true, Detail = await RunStep(name) };
                }
                catch (Exception e)
                {
                    var failure = e as StepFailure;
                    step = new ScenarioStep
                    {
                        Name = name,
                        Ok = false,
                        Detail = failure != null ? failure.Message : "unexpected: " + e.Message,
                        Category = failure != null ? failure.Category : RpgOnlineClientPolicy.UnknownCategory,
                    };
                }
                result.Steps.Add(step);
                onStep?.Invoke(step);
                if (!step.Ok)
                {
                    result.Ok = false;
                    result.FailedName = step.Name;
                    result.FailedCategory = step.Category;
                    result.FailedReason = step.Detail;
                    return result;
                }
            }
            result.Ok = true;
            return result;
        }

        /// <summary>残り時間を出す先（区切りのあるものは nextResetAt、無ければ endsAt。JsonUtility は無い欄を空にしうる）。</summary>
        private static string UntilOf(EventInfo ev) => string.IsNullOrEmpty(ev.nextResetAt) ? ev.endsAt : ev.nextResetAt;

        private static string FormatSpan(TimeSpan t) =>
            string.Format(CultureInfo.InvariantCulture, "{0}d {1:00}:{2:00}:{3:00}", (int)t.TotalDays, t.Hours, t.Minutes, t.Seconds);

        // ---- 人が専用 PC で見るための画面（H2〜H4） ----

        [Tooltip("ローカルの Worker の URL（Mac の LAN の IP と 8787。手順書を見る）")]
        public string baseUrl = "http://127.0.0.1:8787";
        public string gameId = "demo-rpg";
        public bool runOnStart;

        private readonly List<string> lines = new List<string>();
        private readonly ServerClock clock = new ServerClock();
        private List<EventInfo> events = new List<EventInfo>();
        private bool busy;

        private RpgOnlineClient NewClient() => new RpgOnlineClient(new RpgOnlineClientOptions
        {
            BaseUrl = baseUrl,
            GameId = gameId,
            // 要求ごとの記録を画面に足す（トークンと本文は記録に入らない）
            Log = e => lines.Add(e.Reason == "retry-wait"
                ? "  " + e.OperationId + " retry after " + e.WaitMs + " ms"
                : "  " + e.OperationId + " #" + e.Attempt + " -> " + (e.Status == 0 ? (e.Reason ?? "no response") : e.Status.ToString(CultureInfo.InvariantCulture))),
        });

        private void Start()
        {
            if (runOnStart) _ = RunScenarioFromGui();
        }

        /// <summary>H2: シナリオを流して手順ごとの結果を画面に出す。</summary>
        private async Task RunScenarioFromGui()
        {
            if (busy) return;
            busy = true;
            lines.Clear();
            try
            {
                var client = NewClient();
                client.ClearSession();
                var res = await RunAsync(client, new ScenarioOptions(), step =>
                    lines.Add((step.Ok ? "OK   " : "FAIL ") + step.Name + " — " + step.Detail + (step.Ok ? "" : " [" + step.Category + "]")), clock);
                lines.Add(res.Ok ? "Scenario: all steps passed" : "Scenario: failed at " + res.FailedName + " (" + res.FailedCategory + ")");
            }
            finally
            {
                busy = false;
            }
        }

        /// <summary>H3: 生きているかを 1 回聞く（500 を返す相手に向けると、再試行のあと network が出る）。</summary>
        private async Task ProbeFromGui()
        {
            if (busy) return;
            busy = true;
            lines.Clear();
            try
            {
                var res = await NewClient().GetHealthAsync();
                lines.Add(res.Ok ? "Health: ok" : "Health: " + res.Error.category + " after " + res.Attempts + " attempts (" + res.Error.reason + ")");
            }
            finally
            {
                busy = false;
            }
        }

        /// <summary>H4: イベントの一覧を読み、サーバーの時刻で差を取り直す。</summary>
        private async Task ReadEventsFromGui()
        {
            if (busy) return;
            busy = true;
            lines.Clear();
            try
            {
                var client = NewClient();
                if (client.Session() == null) Need(await client.IssueGuestAsync(), "POST /v1/accounts/guest");
                var res = await client.ListEventsAsync();
                if (!res.Ok) { lines.Add("Events: " + res.Error.category); return; }
                var list = res.As<EventList>();
                clock.Update(list?.serverTime, DateTime.UtcNow);
                events = list?.items?.ToList() ?? new List<EventInfo>();
                lines.Add("serverTime=" + list?.serverTime + " device=" + DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture));
            }
            catch (StepFailure e)
            {
                lines.Add("Events: " + e.Category);
            }
            finally
            {
                busy = false;
            }
        }

        private void OnGUI()
        {
            GUILayout.BeginArea(new Rect(10, 10, Screen.width - 20, Screen.height - 20));
            // フレームの数が増え続ける＝通信と再試行の待ちの間もゲームが止まっていない（H3）
            GUILayout.Label("frame " + Time.frameCount + (busy ? "  (waiting for server)" : ""));
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("H2: Run scenario")) _ = RunScenarioFromGui();
            if (GUILayout.Button("H3: Probe health")) _ = ProbeFromGui();
            if (GUILayout.Button("H4: Read events")) _ = ReadEventsFromGui();
            GUILayout.EndHorizontal();
            var now = DateTime.UtcNow;
            foreach (var ev in events)
            {
                // 期間の内か外かと残り時間はサーバーの時刻（端末の今 + 差）で出す（§2.8）
                var serverNow = clock.Now(now);
                var inside = ServerClock.TryParseTime(ev.startsAt, out var s) && serverNow >= s
                    && (!ServerClock.TryParseTime(ev.endsAt, out var e) || serverNow < e);
                GUILayout.Label(ev.eventId + (inside ? " [open]" : " [closed]") + " claimed=" + ev.claimed
                    + " reset in " + FormatSpan(clock.Remaining(UntilOf(ev), now)));
            }
            foreach (var line in lines) GUILayout.Label(line);
            GUILayout.EndArea();
        }
    }
}
