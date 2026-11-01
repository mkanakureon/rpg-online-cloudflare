// RpgOnlineScenario.cpp — §4 の同一の API シナリオ（Unreal 版）と、専用 PC で人が見るためのコンソールのコマンド（H5・H6）。
//
// 手順の名前と順は、ブラウザの SDK（clients/browser/rpg-online-client.mjs）の SCENARIO_STEPS と同じ。確かめの中身も runScenario()・Unity の RpgOnlineScenario.cs と同じ。
// 揃っていることは Mac の試験 test/unreal-client.test.ts が、このファイルの StepList の行と Name == TEXT("…") の行を文字列として読んで見る。
// 設計は docs/guides/working/client-integration-design.md §4・§6・§9（H5・H6）。人の確かめの手順は docs/guides/procedures/unreal-client-check.md。
// 失敗した手順で止まり、例外にせず FRpgOnlineScenarioResult を返す。トークンとセーブの本体は結果にも画面にも出さない。
// 通信と再試行の待ちの間もフレームが進む（ゲームが止まらない）ことを人が見られるよう、待ちの間は画面の左上にフレームの数を出し続ける。
// サンプルのゲームやマップは作らない（Phase 4）。どのマップでもコンソール（`）から呼べる。
//
// 概要記述: Claude Opus 5.5 — 2026-11-01

#include "RpgOnlineScenario.h"
#include "RpgOnlineClientPolicy.h"
#include "RpgOnlineEventCommands.h"
#include "HAL/IConsoleManager.h"
#include "Engine/Engine.h"
#include "Containers/Ticker.h"
#include "Misc/DateTime.h"
#include "Serialization/JsonWriter.h"
#include "Serialization/JsonSerializer.h"
#include "Policies/CondensedJsonPrintPolicy.h"

namespace
{
	/** §4 の手順の名前（順）。ブラウザの SDK の SCENARIO_STEPS と同じ。 */
	static const TCHAR* const StepList[] = {
		TEXT("health"), TEXT("config"), TEXT("master-data"), TEXT("announcements"), TEXT("guest"), TEXT("token-refresh"), TEXT("ranking"), TEXT("saves"), TEXT("event-reward"), TEXT("player-data"), TEXT("quests"),
	};

	using FStepOk = TFunction<void(const FString& /*Detail*/)>;
	using FStepFail = TFunction<void(const FString& /*Category*/, const FString& /*Reason*/)>;
	using FCb = FRpgOnlineResultDelegate;

	FString Base36(int64 Value)
	{
		static const TCHAR* Digits = TEXT("0123456789abcdefghijklmnopqrstuvwxyz");
		if (Value <= 0) return TEXT("0");
		FString Out;
		while (Value > 0) { Out.InsertAt(0, Digits[Value % 36]); Value /= 36; }
		return Out;
	}

	FString Str(const TSharedPtr<FJsonObject>& O, const TCHAR* Field)
	{
		FString V;
		if (O.IsValid()) O->TryGetStringField(Field, V);
		return V;
	}

	int32 Int(const TSharedPtr<FJsonObject>& O, const TCHAR* Field, int32 Default = 0)
	{
		int32 V = Default;
		if (O.IsValid()) O->TryGetNumberField(Field, V);
		return V;
	}

	bool Bool(const TSharedPtr<FJsonObject>& O, const TCHAR* Field)
	{
		bool V = false;
		if (O.IsValid()) O->TryGetBoolField(Field, V);
		return V;
	}

	TArray<TSharedPtr<FJsonObject>> Rows(const TSharedPtr<FJsonObject>& O, const TCHAR* Field)
	{
		TArray<TSharedPtr<FJsonObject>> Out;
		const TArray<TSharedPtr<FJsonValue>>* Items = nullptr;
		if (O.IsValid() && O->TryGetArrayField(Field, Items))
		{
			for (const TSharedPtr<FJsonValue>& V : *Items)
			{
				if (V.IsValid() && V->AsObject().IsValid()) Out.Add(V->AsObject());
			}
		}
		return Out;
	}

	TSharedPtr<FJsonObject> RowWhere(const TSharedPtr<FJsonObject>& O, const TCHAR* Field, const TCHAR* Key, const FString& Value)
	{
		for (const TSharedPtr<FJsonObject>& Row : Rows(O, Field))
		{
			if (Str(Row, Key) == Value) return Row;
		}
		return nullptr;
	}

	int32 GoldOf(const TSharedPtr<FJsonObject>& Inventory)
	{
		return Int(RowWhere(Inventory, TEXT("currencies"), TEXT("itemId"), TEXT("gold")), TEXT("amount"));
	}

	FString FormatSpan(const FTimespan& T)
	{
		return FString::Printf(TEXT("%dd %02d:%02d:%02d"), T.GetDays(), T.GetHours(), T.GetMinutes(), T.GetSeconds());
	}

	/** シナリオ 1 回分の状態（手順の間で受け渡す値）。 */
	struct FRun : public TSharedFromThis<FRun, ESPMode::ThreadSafe>
	{
		TSharedPtr<FRpgOnlineClient, ESPMode::ThreadSafe> Client;
		FRpgOnlineScenarioOptions O;
		FRpgOnlineScenarioResult Result;
		FRpgOnlineScenarioStepDelegate OnStep;
		FRpgOnlineScenarioDoneDelegate OnDone;
		FRpgOnlineServerClock Clock;
		int32 Index = 0;
		TSharedPtr<FJsonObject> Config;
		FString PlayerId;
		FString ExpiresAt;
	};

	/** 失敗なら Fail を呼んで false。 */
	bool Need(const FRpgOnlineResult& Res, const TCHAR* What, const FStepFail& Fail)
	{
		if (Res.bOk) return true;
		Fail(Res.Error.Category, FString(What) + TEXT(": ") + Res.Error.Reason);
		return false;
	}

	bool Check(bool bCond, const TCHAR* Reason, const FStepFail& Fail)
	{
		if (!bCond) Fail(RpgOnlineClientPolicy::UnknownCategory, Reason);
		return bCond;
	}

	/** 受領の履歴を nextBefore が無くなるまで読む（§2.6。上限 10 ページ）。 */
	void ReadAllHistory(TSharedRef<FRun, ESPMode::ThreadSafe> R, int32 Before, int32 Page, TSharedRef<TArray<TSharedPtr<FJsonObject>>> Items,
		TFunction<void(bool /*bComplete*/)> Ok, FStepFail Fail)
	{
		R->Client->ListInventoryHistory(20, Before, FCb::CreateLambda([R, Page, Items, Ok, Fail](const FRpgOnlineResult& Res)
		{
			if (!Need(Res, TEXT("GET /v1/inventory/history"), Fail)) return;
			const TSharedPtr<FJsonObject> Body = Res.Json();
			Items->Append(Rows(Body, TEXT("items")));
			const int32 Next = Int(Body, TEXT("nextBefore"));
			if (Next <= 0) { Ok(true); return; }
			if (Page >= 10) { Ok(false); return; }
			ReadAllHistory(R, Next, Page + 1, Items, Ok, Fail);
		}));
	}

	/** 手順 1 つを流す。名前ごとの中身はここだけ。 */
	void RunStep(TSharedRef<FRun, ESPMode::ThreadSafe> R, const FString& Name, FStepOk Ok, FStepFail Fail)
	{
		FRpgOnlineClient& C = *R->Client;
		const FRpgOnlineScenarioOptions& O = R->O;

		if (Name == TEXT("health"))
		{
			C.GetHealth(FCb::CreateLambda([Ok, Fail](const FRpgOnlineResult& Res)
			{
				if (!Need(Res, TEXT("GET /health"), Fail)) return;
				if (!Check(Str(Res.Json(), TEXT("status")) == TEXT("ok"), TEXT("Health check failed"), Fail)) return;
				Ok(TEXT("ok"));
			}));
		}
		else if (Name == TEXT("config"))
		{
			TSharedPtr<FRpgOnlineClient, ESPMode::ThreadSafe> Client = R->Client;
			const FString Version = O.ClientVersion;
			C.GetConfig(Version, FString(), FCb::CreateLambda([R, Client, Version, Ok, Fail](const FRpgOnlineResult& First)
			{
				if (!Need(First, TEXT("GET /v1/config"), Fail)) return;
				if (!Check(First.Status == 200 && !First.ETag.IsEmpty(), TEXT("Config could not be read"), Fail)) return;
				R->Config = First.Json();
				const TSharedPtr<FJsonObject>* ClientVersion = nullptr;
				const bool bRequired = R->Config.IsValid() && R->Config->TryGetObjectField(TEXT("clientVersion"), ClientVersion) && ClientVersion
					&& Str(*ClientVersion, TEXT("update")) == TEXT("required");
				if (!Check(!bRequired, TEXT("Client version is older than the minimum"), Fail)) return;
				Client->GetConfig(Version, First.ETag, FCb::CreateLambda([Ok, Fail](const FRpgOnlineResult& Again)
				{
					if (!Need(Again, TEXT("GET /v1/config (If-None-Match)"), Fail)) return;
					if (!Check(Again.Status == 304, TEXT("Unchanged config was sent again (expected 304)"), Fail)) return;
					Ok(TEXT("200 then 304"));
				}));
			}));
		}
		else if (Name == TEXT("master-data"))
		{
			const TArray<TSharedPtr<FJsonObject>> Entries = Rows(R->Config, TEXT("masterData"));
			if (Entries.Num() == 0) { Ok(TEXT("none (skipped)")); return; }
			const FString Key = Str(Entries[0], TEXT("key"));
			const int32 Size = Int(Entries[0], TEXT("size"), -1);
			C.GetMasterData(Key, FString(), FCb::CreateLambda([Key, Size, Ok, Fail](const FRpgOnlineResult& Res)
			{
				if (!Need(Res, TEXT("GET /v1/config/master"), Fail)) return;
				const FString Data = Str(Res.Json(), TEXT("data"));
				const int32 Got = FTCHARToUTF8(*Data).Length();
				if (!Check(Got == Size, TEXT("Master data does not match the size in the config"), Fail)) return;
				Ok(FString::Printf(TEXT("%s size=%d"), *Key, Got));
			}));
		}
		else if (Name == TEXT("announcements"))
		{
			C.ListAnnouncements(FCb::CreateLambda([Ok, Fail](const FRpgOnlineResult& Res)
			{
				if (!Need(Res, TEXT("GET /v1/announcements"), Fail)) return;
				Ok(FString::Printf(TEXT("%d items"), Rows(Res.Json(), TEXT("items")).Num()));
			}));
		}
		else if (Name == TEXT("guest"))
		{
			C.IssueGuest(FCb::CreateLambda([R, Ok, Fail](const FRpgOnlineResult& Res)
			{
				if (!Need(Res, TEXT("POST /v1/accounts/guest"), Fail)) return;
				const TSharedPtr<FJsonObject> Info = Res.Json();
				R->PlayerId = Str(Info, TEXT("playerId"));
				R->ExpiresAt = Str(Info, TEXT("expiresAt"));
				if (!Check(!R->PlayerId.IsEmpty(), TEXT("Guest was not issued"), Fail)) return;
				Ok(FString::Printf(TEXT("player issued (expiresAt=%s)"), *R->ExpiresAt));
			}));
		}
		else if (Name == TEXT("token-refresh"))
		{
			C.RefreshToken(FCb::CreateLambda([R, Ok, Fail](const FRpgOnlineResult& Res)
			{
				if (!Need(Res, TEXT("POST /v1/accounts/token"), Fail)) return;
				const TSharedPtr<FJsonObject> Info = Res.Json();
				if (!Check(Str(Info, TEXT("playerId")) == R->PlayerId && Str(Info, TEXT("gameId")) == R->Client->GetGameId(),
					TEXT("Refreshed session is for a different player"), Fail)) return;
				FDateTime After, Before;
				const FString NewExpiresAt = Str(Info, TEXT("expiresAt"));
				if (!Check(FRpgOnlineServerClock::ParseTime(NewExpiresAt, After) && FRpgOnlineServerClock::ParseTime(R->ExpiresAt, Before) && After >= Before,
					TEXT("Refreshed session expires earlier than the issued one"), Fail)) return;
				Ok(FString::Printf(TEXT("same player (expiresAt=%s)"), *NewExpiresAt));
			}));
		}
		else if (Name == TEXT("ranking"))
		{
			const FString BoardId = O.BoardPrefix + TEXT("-") + Base36(FDateTime::UtcNow().ToUnixTimestamp() * 1000 + FDateTime::UtcNow().GetMillisecond());
			const int32 Score = O.Score;
			C.SubmitScore(BoardId, Score, O.DisplayName, FCb::CreateLambda([R, BoardId, Score, Ok, Fail](const FRpgOnlineResult& Sent)
			{
				if (!Need(Sent, TEXT("POST /v1/rankings"), Fail)) return;
				R->Client->GetRanking(BoardId, 10, FCb::CreateLambda([R, BoardId, Score, Ok, Fail](const FRpgOnlineResult& Res)
				{
					if (!Need(Res, TEXT("GET /v1/rankings"), Fail)) return;
					bool bFound = false;
					for (const TSharedPtr<FJsonObject>& Row : Rows(Res.Json(), TEXT("items")))
					{
						if (Str(Row, TEXT("playerId")) == R->PlayerId && Int(Row, TEXT("score")) >= Score) bFound = true;
					}
					if (!Check(bFound, TEXT("Submitted score not found in top 10"), Fail)) return;
					Ok(BoardId + TEXT(" found"));
				}));
			}));
		}
		else if (Name == TEXT("saves"))
		{
			const FString Data = TEXT("{\"hp\":30,\"map\":\"town\"}");
			const FString Checksum = FRpgOnlineClient::Sha256Hex(Data);
			const FString Slot = O.SlotId;
			C.PutSave(Slot, Data, Checksum, 0, 1, FCb::CreateLambda([R, Slot, Data, Checksum, Ok, Fail](const FRpgOnlineResult& Put)
			{
				if (!Need(Put, TEXT("PUT /v1/saves"), Fail)) return;
				const int32 Revision = Int(Put.Json(), TEXT("revision"), -1);
				R->Client->GetSave(Slot, FCb::CreateLambda([R, Slot, Data, Checksum, Revision, Ok, Fail](const FRpgOnlineResult& Got)
				{
					if (!Need(Got, TEXT("GET /v1/saves/{slotId}"), Fail)) return;
					const TSharedPtr<FJsonObject> Loaded = Got.Json();
					if (!Check(Str(Loaded, TEXT("data")) == Data && Str(Loaded, TEXT("checksum")) == Checksum && Int(Loaded, TEXT("revision"), -2) == Revision
						&& FRpgOnlineClient::Sha256Hex(Str(Loaded, TEXT("data"))) == Str(Loaded, TEXT("checksum")),
						TEXT("Loaded save does not match the written one"), Fail)) return;
					R->Client->ListSaves(FCb::CreateLambda([R, Slot, Revision, Ok, Fail](const FRpgOnlineResult& Listed)
					{
						if (!Need(Listed, TEXT("GET /v1/saves"), Fail)) return;
						const TSharedPtr<FJsonObject> Row = RowWhere(Listed.Json(), TEXT("items"), TEXT("slotId"), Slot);
						if (!Check(Row.IsValid(), TEXT("Written save not found in the save list"), Fail)) return;
						R->Client->DeleteSave(Slot, Int(Row, TEXT("revision")), FCb::CreateLambda([R, Slot, Revision, Ok, Fail](const FRpgOnlineResult& Deleted)
						{
							if (!Need(Deleted, TEXT("DELETE /v1/saves"), Fail)) return;
							R->Client->GetSave(Slot, FCb::CreateLambda([Revision, Ok, Fail](const FRpgOnlineResult& Gone)
							{
								if (!Check(!Gone.bOk && Gone.Error.Status == 404, TEXT("Deleted save is still readable"), Fail)) return;
								Ok(FString::Printf(TEXT("revision=%d written, read, listed, deleted"), Revision));
							}));
						}));
					}));
				}));
			}));
		}
		else if (Name == TEXT("event-reward"))
		{
			const FString EventId = O.EventId;
			C.ListEvents(FCb::CreateLambda([R, EventId, Ok, Fail](const FRpgOnlineResult& Listed)
			{
				if (!Need(Listed, TEXT("GET /v1/events"), Fail)) return;
				const TSharedPtr<FJsonObject> List = Listed.Json();
				// 期間の残りはサーバーの時刻で出す（§2.8・H6）。差は一覧を読むたびに取り直す
				const FString ServerTime = Str(List, TEXT("serverTime"));
				R->Clock.Update(ServerTime, FDateTime::UtcNow());
				if (Rows(List, TEXT("items")).Num() == 0) { Ok(TEXT("none (skipped)")); return; }
				const TSharedPtr<FJsonObject> Ev = RowWhere(List, TEXT("items"), TEXT("eventId"), EventId);
				if (!Check(Ev.IsValid() && !Bool(Ev, TEXT("claimed")), TEXT("Event is not open and unclaimed"), Fail)) return;
				const FString NextReset = Str(Ev, TEXT("nextResetAt"));
				const FString Until = NextReset.IsEmpty() ? Str(Ev, TEXT("endsAt")) : NextReset;
				R->Client->ClaimEventReward(EventId, FCb::CreateLambda([R, EventId, ServerTime, Until, Ok, Fail](const FRpgOnlineResult& Claimed)
				{
					if (!Need(Claimed, TEXT("POST /v1/events/{eventId}/claim"), Fail)) return;
					const TSharedPtr<FJsonObject> Claim = Claimed.Json();
					const FString ClaimId = Str(Claim, TEXT("claimId"));
					const int32 Grants = Rows(Claim, TEXT("grants")).Num();
					const int32 Granted = Int(RowWhere(Claim, TEXT("grants"), TEXT("itemId"), TEXT("gold")), TEXT("amount"));
					R->Client->GetInventory(FCb::CreateLambda([R, EventId, ServerTime, Until, ClaimId, Grants, Granted, Ok, Fail](const FRpgOnlineResult& First)
					{
						if (!Need(First, TEXT("GET /v1/inventory"), Fail)) return;
						if (!Check(Granted > 0 && GoldOf(First.Json()) == Granted, TEXT("Claimed gold is not in the inventory"), Fail)) return;
						R->Client->ClaimEventReward(EventId, FCb::CreateLambda([R, ServerTime, Until, ClaimId, Grants, Granted, Ok, Fail](const FRpgOnlineResult& Again)
						{
							if (!Need(Again, TEXT("POST /v1/events/{eventId}/claim (again)"), Fail)) return;
							if (!Check(Str(Again.Json(), TEXT("claimId")) == ClaimId, TEXT("Second claim returned a different claimId"), Fail)) return;
							R->Client->GetInventory(FCb::CreateLambda([R, ServerTime, Until, ClaimId, Grants, Granted, Ok, Fail](const FRpgOnlineResult& Second)
							{
								if (!Need(Second, TEXT("GET /v1/inventory"), Fail)) return;
								if (!Check(GoldOf(Second.Json()) == Granted, TEXT("Second claim granted the reward twice"), Fail)) return;
								const TSharedRef<TArray<TSharedPtr<FJsonObject>>> Items = MakeShared<TArray<TSharedPtr<FJsonObject>>>();
								ReadAllHistory(R, 0, 1, Items, [R, ServerTime, Until, ClaimId, Grants, Granted, Items, Ok, Fail](bool bComplete)
								{
									bool bAllFromClaim = true;
									for (const TSharedPtr<FJsonObject>& Row : *Items) bAllFromClaim &= Str(Row, TEXT("sourceId")) == ClaimId;
									if (!Check(bComplete && Items->Num() == Grants && bAllFromClaim, TEXT("Inventory history does not have exactly the claimed rows"), Fail)) return;
									const FTimespan Left = R->Clock.Remaining(Until, FDateTime::UtcNow());
									Ok(FString::Printf(TEXT("gold +%d once (serverTime=%s, reset in %s)"), Granted, *ServerTime, *FormatSpan(Left)));
								}, Fail);
							}));
						}));
					}));
				}));
			}));
		}
		else if (Name == TEXT("player-data"))
		{
			const FString Key = O.PlayerDataKey;
			const FString Achievement = O.AchievementId;
			C.GetPlayerData(FCb::CreateLambda([R, Key, Achievement, Ok, Fail](const FRpgOnlineResult& Before)
			{
				if (!Need(Before, TEXT("GET /v1/player-data"), Fail)) return;
				if (!Check(Rows(Before.Json(), TEXT("values")).Num() == 0 && Rows(Before.Json(), TEXT("achievements")).Num() == 0,
					TEXT("New guest already has player data"), Fail)) return;
				const FString IdempotencyKey = FRpgOnlineClient::NewIdempotencyKey();
				TArray<FRpgOnlinePlayerDataChange> Changes;
				FRpgOnlinePlayerDataChange Change;
				Change.Key = Key;
				Change.Value = 1;
				Changes.Add(Change);
				R->Client->WritePlayerData(Changes, IdempotencyKey, FCb::CreateLambda([R, Key, Achievement, Changes, IdempotencyKey, Ok, Fail](const FRpgOnlineResult& Written)
				{
					if (!Need(Written, TEXT("POST /v1/player-data"), Fail)) return;
					const TSharedPtr<FJsonObject> W = Written.Json();
					if (!Check(Int(RowWhere(W, TEXT("values"), TEXT("key"), Key), TEXT("value")) == 1 && RowWhere(W, TEXT("unlocked"), TEXT("achievementId"), Achievement).IsValid(),
						TEXT("Writing the stat did not unlock the achievement"), Fail)) return;
					const FString FirstText = Written.Text;
					R->Client->WritePlayerData(Changes, IdempotencyKey, FCb::CreateLambda([R, Key, Achievement, FirstText, Ok, Fail](const FRpgOnlineResult& Resent)
					{
						if (!Need(Resent, TEXT("POST /v1/player-data (resend)"), Fail)) return;
						if (!Check(Resent.Text == FirstText, TEXT("Resent player data write returned a different body"), Fail)) return;
						R->Client->GetPlayerData(FCb::CreateLambda([Key, Achievement, Ok, Fail](const FRpgOnlineResult& After)
						{
							if (!Need(After, TEXT("GET /v1/player-data"), Fail)) return;
							const TSharedPtr<FJsonObject> A = After.Json();
							if (!Check(Int(RowWhere(A, TEXT("values"), TEXT("key"), Key), TEXT("value")) == 1, TEXT("Resent player data write was counted twice"), Fail)) return;
							int32 Unlocked = 0;
							for (const TSharedPtr<FJsonObject>& Row : Rows(A, TEXT("achievements"))) Unlocked += Str(Row, TEXT("achievementId")) == Achievement ? 1 : 0;
							if (!Check(Unlocked == 1, TEXT("Achievement is not unlocked exactly once"), Fail)) return;
							Ok(FString::Printf(TEXT("%s=1 once, %s unlocked"), *Key, *Achievement));
						}));
					}));
				}));
			}));
		}
		else if (Name == TEXT("quests"))
		{
			const FString QuestId = O.QuestId;
			C.ListQuests(FCb::CreateLambda([R, QuestId, Ok, Fail](const FRpgOnlineResult& Before)
			{
				if (!Need(Before, TEXT("GET /v1/quests"), Fail)) return;
				const TSharedPtr<FJsonObject> List = Before.Json();
				R->Clock.Update(Str(List, TEXT("serverTime")), FDateTime::UtcNow());
				const TSharedPtr<FJsonObject> Quest = RowWhere(List, TEXT("items"), TEXT("questId"), QuestId);
				if (!Check(Quest.IsValid() && Bool(Quest, TEXT("completed")) && !Bool(Quest, TEXT("claimed")), TEXT("Quest is not completed and unclaimed"), Fail)) return;
				R->Client->ClaimQuest(QuestId, FCb::CreateLambda([R, QuestId, Ok, Fail](const FRpgOnlineResult& Claimed)
				{
					if (!Need(Claimed, TEXT("POST /v1/quests/{questId}/claim"), Fail)) return;
					if (!Check(Int(RowWhere(Claimed.Json(), TEXT("grants"), TEXT("itemId"), TEXT("gold")), TEXT("amount")) > 0, TEXT("Quest granted no gold"), Fail)) return;
					const FString FirstText = Claimed.Text;
					R->Client->ClaimQuest(QuestId, FCb::CreateLambda([R, QuestId, FirstText, Ok, Fail](const FRpgOnlineResult& Again)
					{
						if (!Need(Again, TEXT("POST /v1/quests/{questId}/claim (again)"), Fail)) return;
						if (!Check(Again.Text == FirstText, TEXT("Second quest claim returned a different body"), Fail)) return;
						R->Client->ListQuests(FCb::CreateLambda([QuestId, Ok, Fail](const FRpgOnlineResult& After)
						{
							if (!Need(After, TEXT("GET /v1/quests"), Fail)) return;
							if (!Check(Bool(RowWhere(After.Json(), TEXT("items"), TEXT("questId"), QuestId), TEXT("claimed")), TEXT("Quest is not marked as claimed"), Fail)) return;
							Ok(QuestId + TEXT(" claimed once"));
						}));
					}));
				}));
			}));
		}
		else
		{
			Fail(RpgOnlineClientPolicy::UnknownCategory, TEXT("unknown step ") + Name);
		}
	}

	/** 手順を順に流す。失敗した手順で止まる。 */
	void Next(TSharedRef<FRun, ESPMode::ThreadSafe> R, TFunction<void(TSharedRef<FRun, ESPMode::ThreadSafe>, const FString&, FStepOk, FStepFail)> Step)
	{
		if (R->Index >= static_cast<int32>(UE_ARRAY_COUNT(StepList)))
		{
			R->Result.bOk = true;
			R->OnDone.ExecuteIfBound(R->Result);
			return;
		}
		const FString Name = StepList[R->Index];
		Step(R, Name,
			[R, Name, Step](const FString& Detail)
			{
				FRpgOnlineScenarioStep S;
				S.Name = Name;
				S.bOk = true;
				S.Detail = Detail;
				R->Result.Steps.Add(S);
				R->OnStep.ExecuteIfBound(S);
				R->Index += 1;
				Next(R, Step);
			},
			[R, Name](const FString& Category, const FString& Reason)
			{
				FRpgOnlineScenarioStep S;
				S.Name = Name;
				S.Detail = Reason;
				S.Category = Category;
				R->Result.Steps.Add(S);
				R->OnStep.ExecuteIfBound(S);
				R->Result.bOk = false;
				R->Result.FailedName = Name;
				R->Result.FailedCategory = Category;
				R->Result.FailedReason = Reason;
				R->OnDone.ExecuteIfBound(R->Result);
			});
	}

	// ---- イベントコマンドで流す形（H6）。手順ごとに、実行するコマンドの JSON と確かめを並べる ----

	/** 変数をメモリーに置く差し替え口（確かめ用。制作ツールの変数の代わり）。 */
	class FMemoryEventHost final : public IRpgOnlineEventHost
	{
	public:
		virtual int32 GetVariable(int32 Index) const override { const int32* V = Vars.Find(Index); return V ? *V : 0; }
		virtual void SetVariable(int32 Index, int32 Value) override { Vars.Add(Index, Value); }
		TMap<int32, int32> Vars;
	};

	/** コマンド 1 行（JSON）と、そのあとに見る変数の確かめ。Expected は responseVariable（変数 1）に来るはずの番号。 */
	struct FCommandLine
	{
		FString Json;
		int32 Expected = 0;
		TFunction<bool(const FMemoryEventHost&)> Check;
		FString CheckReason;
	};

	FString Cmd(const FString& Command, const TArray<TPair<FString, FString>>& Strings, const TArray<TPair<FString, int32>>& Numbers)
	{
		const TSharedRef<FJsonObject> Params = MakeShared<FJsonObject>();
		for (const TPair<FString, FString>& P : Strings) Params->SetStringField(P.Key, P.Value);
		for (const TPair<FString, int32>& P : Numbers) Params->SetNumberField(P.Key, P.Value);
		Params->SetNumberField(RpgOnlineEventCommands::ResponseVariableParam, 1);
		const TSharedRef<FJsonObject> Root = MakeShared<FJsonObject>();
		Root->SetStringField(TEXT("command"), Command);
		Root->SetObjectField(TEXT("params"), Params);
		FString Out;
		const TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer = TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Out);
		FJsonSerializer::Serialize(Root, Writer);
		return Out;
	}

	FCommandLine Line(const FString& Json, int32 Expected = 0, TFunction<bool(const FMemoryEventHost&)> CheckFn = nullptr, const FString& Reason = FString())
	{
		FCommandLine L;
		L.Json = Json;
		L.Expected = Expected;
		L.Check = CheckFn;
		L.CheckReason = Reason;
		return L;
	}

	/** 手順の名前ごとのコマンドの並び（変数の番号: 1 応答・2〜 出力と入力）。master-data はキーが設定で決まるので飛ばす。 */
	TArray<FCommandLine> CommandsFor(const FString& Name, const FString& BoardId)
	{
		const int32 NotFound = RpgOnlineEventCommands::NumberOf(TEXT("not-found"));
		TArray<FCommandLine> L;
		if (Name == TEXT("health")) L.Add(Line(Cmd(TEXT("online.health.get"), {}, {})));
		else if (Name == TEXT("config")) L.Add(Line(Cmd(TEXT("online.config.get"), { { TEXT("clientVersion"), TEXT("1.0.0") } }, {})));
		else if (Name == TEXT("master-data")) { /* none (skipped) */ }
		else if (Name == TEXT("announcements")) L.Add(Line(Cmd(TEXT("online.announcements.list"), {}, { { TEXT("countVariable"), 2 } })));
		else if (Name == TEXT("guest")) L.Add(Line(Cmd(TEXT("online.account.guest"), {}, {})));
		else if (Name == TEXT("token-refresh")) L.Add(Line(Cmd(TEXT("online.account.refresh"), {}, {})));
		else if (Name == TEXT("ranking"))
		{
			L.Add(Line(Cmd(TEXT("online.ranking.submit"), { { TEXT("boardId"), BoardId }, { TEXT("displayName"), TEXT("UE Event Tester") } }, { { TEXT("scoreVariable"), 10 } })));
			L.Add(Line(Cmd(TEXT("online.ranking.get"), { { TEXT("boardId"), BoardId } }, { { TEXT("limit"), 10 }, { TEXT("countVariable"), 11 }, { TEXT("topScoreVariable"), 12 } }), 0,
				[](const FMemoryEventHost& H) { return H.GetVariable(11) >= 1 && H.GetVariable(12) >= H.GetVariable(10); }, TEXT("Submitted score not in the ranking")));
		}
		else if (Name == TEXT("saves"))
		{
			L.Add(Line(Cmd(TEXT("online.save.put"), { { TEXT("slotId"), TEXT("ue-event") }, { TEXT("data"), TEXT("{\"hp\":30,\"map\":\"town\"}") } },
				{ { TEXT("baseRevisionVariable"), 20 }, { TEXT("revisionVariable"), 21 } }), 0,
				[](const FMemoryEventHost& H) { return H.GetVariable(21) >= 1; }, TEXT("Save was not written")));
			L.Add(Line(Cmd(TEXT("online.save.get"), { { TEXT("slotId"), TEXT("ue-event") } }, { { TEXT("revisionVariable"), 22 } }), 0,
				[](const FMemoryEventHost& H) { return H.GetVariable(22) == H.GetVariable(21); }, TEXT("Loaded save has a different revision")));
			L.Add(Line(Cmd(TEXT("online.save.list"), {}, { { TEXT("countVariable"), 23 } }), 0,
				[](const FMemoryEventHost& H) { return H.GetVariable(23) >= 1; }, TEXT("Written save not in the list")));
			L.Add(Line(Cmd(TEXT("online.save.delete"), { { TEXT("slotId"), TEXT("ue-event") } }, { { TEXT("baseRevisionVariable"), 21 } })));
			L.Add(Line(Cmd(TEXT("online.save.get"), { { TEXT("slotId"), TEXT("ue-event") } }, {}), NotFound));
		}
		else if (Name == TEXT("event-reward"))
		{
			L.Add(Line(Cmd(TEXT("online.event.list"), { { TEXT("eventId"), TEXT("daily-login") } },
				{ { TEXT("openVariable"), 30 }, { TEXT("claimedVariable"), 31 }, { TEXT("remainingSecondsVariable"), 32 } }), 0,
				[](const FMemoryEventHost& H) { return H.GetVariable(30) == 1 && H.GetVariable(31) == 0; }, TEXT("Event is not open and unclaimed (server time)")));
			L.Add(Line(Cmd(TEXT("online.event.claim"), { { TEXT("eventId"), TEXT("daily-login") } }, {})));
			L.Add(Line(Cmd(TEXT("online.inventory.get"), { { TEXT("itemId"), TEXT("gold") } }, { { TEXT("amountVariable"), 33 } }), 0,
				[](const FMemoryEventHost& H) { return H.GetVariable(33) > 0; }, TEXT("Claimed gold is not in the inventory")));
			L.Add(Line(Cmd(TEXT("online.event.claim"), { { TEXT("eventId"), TEXT("daily-login") } }, {})));
			L.Add(Line(Cmd(TEXT("online.inventory.get"), { { TEXT("itemId"), TEXT("gold") } }, { { TEXT("amountVariable"), 34 } }), 0,
				[](const FMemoryEventHost& H) { return H.GetVariable(34) == H.GetVariable(33); }, TEXT("Second claim granted the reward twice")));
			L.Add(Line(Cmd(TEXT("online.inventory.history"), {}, { { TEXT("limit"), 20 }, { TEXT("beforeVariable"), 39 }, { TEXT("countVariable"), 35 }, { TEXT("nextBeforeVariable"), 36 } }), 0,
				[](const FMemoryEventHost& H) { return H.GetVariable(35) >= 1; }, TEXT("Inventory history is empty")));
		}
		else if (Name == TEXT("player-data"))
		{
			L.Add(Line(Cmd(TEXT("online.player-data.get"), { { TEXT("key"), TEXT("slimes-defeated") } }, { { TEXT("valueVariable"), 40 } }), 0,
				[](const FMemoryEventHost& H) { return H.GetVariable(40) == 0; }, TEXT("New guest already has the stat")));
			L.Add(Line(Cmd(TEXT("online.player-data.write"), { { TEXT("key"), TEXT("slimes-defeated") } }, { { TEXT("valueVariable"), 41 } })));
			L.Add(Line(Cmd(TEXT("online.player-data.get"), { { TEXT("key"), TEXT("slimes-defeated") } }, { { TEXT("valueVariable"), 42 } }), 0,
				[](const FMemoryEventHost& H) { return H.GetVariable(42) == 1; }, TEXT("Stat was not counted once")));
		}
		else if (Name == TEXT("quests"))
		{
			L.Add(Line(Cmd(TEXT("online.quest.list"), { { TEXT("questId"), TEXT("first-hunt") } }, { { TEXT("completedVariable"), 50 }, { TEXT("claimedVariable"), 51 } }), 0,
				[](const FMemoryEventHost& H) { return H.GetVariable(50) == 1 && H.GetVariable(51) == 0; }, TEXT("Quest is not completed and unclaimed")));
			L.Add(Line(Cmd(TEXT("online.quest.claim"), { { TEXT("questId"), TEXT("first-hunt") } }, {})));
			L.Add(Line(Cmd(TEXT("online.quest.claim"), { { TEXT("questId"), TEXT("first-hunt") } }, {})));
			L.Add(Line(Cmd(TEXT("online.quest.list"), { { TEXT("questId"), TEXT("first-hunt") } }, { { TEXT("claimedVariable"), 52 } }), 0,
				[](const FMemoryEventHost& H) { return H.GetVariable(52) == 1; }, TEXT("Quest is not marked as claimed")));
		}
		return L;
	}

	void RunLines(TSharedRef<FRpgOnlineEventCommandRunner, ESPMode::ThreadSafe> Runner, TSharedRef<FMemoryEventHost, ESPMode::ThreadSafe> Host,
		TSharedRef<TArray<FCommandLine>> Lines, int32 At, FStepOk Ok, FStepFail Fail)
	{
		if (At >= Lines->Num()) { Ok(Lines->Num() == 0 ? FString(TEXT("none (skipped)")) : FString::Printf(TEXT("%d commands"), Lines->Num())); return; }
		const FCommandLine& L = (*Lines)[At];
		Runner->ExecuteJson(L.Json, FRpgOnlineEventFinished::CreateLambda([Runner, Host, Lines, At, Ok, Fail](int32 Number)
		{
			const FCommandLine& Done = (*Lines)[At];
			if (Number != Done.Expected)
			{
				Fail(RpgOnlineClientPolicy::UnknownCategory, FString::Printf(TEXT("command %d: responseVariable=%d (expected %d)"), At + 1, Number, Done.Expected));
				return;
			}
			if (Done.Check && !Done.Check(*Host)) { Fail(RpgOnlineClientPolicy::UnknownCategory, Done.CheckReason); return; }
			RunLines(Runner, Host, Lines, At + 1, Ok, Fail);
		}));
	}

	// ---- 人が専用 PC で見るためのコンソールのコマンド（H5・H6） ----

	TAutoConsoleVariable<FString> CVarBaseUrl(TEXT("RpgOnline.BaseUrl"), TEXT("http://127.0.0.1:8787"),
		TEXT("Base URL of the local Worker (Mac LAN IP and port 8787; see docs/guides/procedures/unreal-client-check.md)"));

	FTSTicker::FDelegateHandle FrameTicker;
	int32 BusyCount = 0;

	void Show(const FString& Line, const FColor& Color = FColor::White)
	{
		UE_LOG(LogRpgOnline, Display, TEXT("%s"), *Line);
		if (GEngine) GEngine->AddOnScreenDebugMessage(-1, 60.0f, Color, Line);
	}

	/** 待ちの間、0.25 秒ごとに画面の左上（決まった鍵）にフレームの数を出す。数が増え続ける＝ゲームが止まっていない（H5）。 */
	void BeginBusy()
	{
		BusyCount += 1;
		if (BusyCount > 1) return;
		FrameTicker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([](float)
		{
			if (GEngine) GEngine->AddOnScreenDebugMessage(9001, 0.5f, FColor::Yellow, FString::Printf(TEXT("frame %llu  (waiting for server)"), static_cast<uint64>(GFrameCounter)));
			return true;
		}), 0.25f);
	}

	void EndBusy()
	{
		BusyCount = FMath::Max(0, BusyCount - 1);
		if (BusyCount == 0) FTSTicker::GetCoreTicker().RemoveTicker(FrameTicker);
	}

	TSharedRef<FRpgOnlineClient, ESPMode::ThreadSafe> NewClient()
	{
		FRpgOnlineClientOptions Options;
		Options.BaseUrl = CVarBaseUrl.GetValueOnGameThread();
		Options.GameId = TEXT("demo-rpg");
		// 要求ごとの記録を画面に足す（トークンと本文は記録に入らない）
		Options.Log = FRpgOnlineLogDelegate::CreateLambda([](const FRpgOnlineRequestLog& E)
		{
			if (E.Reason == TEXT("retry-wait")) Show(FString::Printf(TEXT("  %s retry after %d ms"), *E.OperationId, E.WaitMs));
			else Show(FString::Printf(TEXT("  %s #%d -> %s"), *E.OperationId, E.Attempt, E.Status == 0 ? *E.Reason : *FString::FromInt(E.Status)));
		});
		return FRpgOnlineClient::Create(Options);
	}

	FRpgOnlineScenarioStepDelegate ShowStep()
	{
		return FRpgOnlineScenarioStepDelegate::CreateLambda([](const FRpgOnlineScenarioStep& S)
		{
			Show(FString::Printf(TEXT("%s %s - %s%s"), S.bOk ? TEXT("OK  ") : TEXT("FAIL"), *S.Name, *S.Detail, S.bOk ? TEXT("") : *FString::Printf(TEXT(" [%s]"), *S.Category)),
				S.bOk ? FColor::Green : FColor::Red);
		});
	}

	FRpgOnlineScenarioDoneDelegate ShowDone(TSharedRef<FRpgOnlineClient, ESPMode::ThreadSafe> KeepAlive)
	{
		return FRpgOnlineScenarioDoneDelegate::CreateLambda([KeepAlive](const FRpgOnlineScenarioResult& R)
		{
			Show(R.bOk ? FString(TEXT("Scenario: all steps passed")) : FString::Printf(TEXT("Scenario: failed at %s (%s)"), *R.FailedName, *R.FailedCategory),
				R.bOk ? FColor::Green : FColor::Red);
			EndBusy();
		});
	}

	/** H6: シナリオを流して手順ごとの結果を画面に出す。 */
	FAutoConsoleCommand CmdScenario(TEXT("RpgOnline.Scenario"), TEXT("Run the shared API scenario with the client layer (H6)"), FConsoleCommandDelegate::CreateLambda([]()
	{
		const TSharedRef<FRpgOnlineClient, ESPMode::ThreadSafe> Client = NewClient();
		Client->ClearSession();
		BeginBusy();
		RpgOnlineScenario::Run(Client, FRpgOnlineScenarioOptions(), ShowStep(), ShowDone(Client));
	}));

	/** H6: 同じ手順をイベントコマンドで流す。 */
	FAutoConsoleCommand CmdEventScenario(TEXT("RpgOnline.EventScenario"), TEXT("Run the shared API scenario through the event commands (H6)"), FConsoleCommandDelegate::CreateLambda([]()
	{
		const TSharedRef<FRpgOnlineClient, ESPMode::ThreadSafe> Client = NewClient();
		Client->ClearSession();
		BeginBusy();
		RpgOnlineScenario::RunWithEventCommands(Client, ShowStep(), ShowDone(Client));
	}));

	/** H5: 生きているかを 1 回聞く（500 を返す相手に向けると、再試行のあと network が出る）。 */
	FAutoConsoleCommand CmdProbe(TEXT("RpgOnline.Probe"), TEXT("Call GET /health once with retries (H5)"), FConsoleCommandDelegate::CreateLambda([]()
	{
		const TSharedRef<FRpgOnlineClient, ESPMode::ThreadSafe> Client = NewClient();
		BeginBusy();
		Client->GetHealth(FRpgOnlineResultDelegate::CreateLambda([Client](const FRpgOnlineResult& Res)
		{
			Show(Res.bOk ? FString(TEXT("Health: ok"))
				: FString::Printf(TEXT("Health: %s after %d attempts (%s)"), *Res.Error.Category, Res.Attempts, *Res.Error.Reason), Res.bOk ? FColor::Green : FColor::Red);
			EndBusy();
		}));
	}));

	/** H6: イベントの一覧を読み、サーバーの時刻と端末の時刻と、イベントごとの期間の内外・残りを出す。 */
	FAutoConsoleCommand CmdEvents(TEXT("RpgOnline.Events"), TEXT("List events using the server time (H6)"), FConsoleCommandDelegate::CreateLambda([]()
	{
		const TSharedRef<FRpgOnlineClient, ESPMode::ThreadSafe> Client = NewClient();
		BeginBusy();
		Client->IssueGuest(FRpgOnlineResultDelegate::CreateLambda([Client](const FRpgOnlineResult& Issued)
		{
			if (!Issued.bOk) { Show(TEXT("Events: ") + Issued.Error.Category, FColor::Red); EndBusy(); return; }
			Client->ListEvents(FRpgOnlineResultDelegate::CreateLambda([Client](const FRpgOnlineResult& Res)
			{
				if (!Res.bOk) { Show(TEXT("Events: ") + Res.Error.Category, FColor::Red); EndBusy(); return; }
				const TSharedPtr<FJsonObject> List = Res.Json();
				FRpgOnlineServerClock Clock;
				const FDateTime Device = FDateTime::UtcNow();
				Clock.Update(Str(List, TEXT("serverTime")), Device);
				Show(FString::Printf(TEXT("serverTime=%s device=%s"), *Str(List, TEXT("serverTime")), *Device.ToIso8601()));
				for (const TSharedPtr<FJsonObject>& Ev : Rows(List, TEXT("items")))
				{
					// 期間の内か外かと残り時間はサーバーの時刻（端末の今 + 差）で出す（§2.8）
					FDateTime Start, End;
					const FDateTime ServerNow = Clock.Now(Device);
					const bool bOpen = FRpgOnlineServerClock::ParseTime(Str(Ev, TEXT("startsAt")), Start) && ServerNow >= Start
						&& (!FRpgOnlineServerClock::ParseTime(Str(Ev, TEXT("endsAt")), End) || ServerNow < End);
					const FString NextReset = Str(Ev, TEXT("nextResetAt"));
					Show(FString::Printf(TEXT("%s %s claimed=%s reset in %s"), *Str(Ev, TEXT("eventId")), bOpen ? TEXT("[open]") : TEXT("[closed]"),
						Bool(Ev, TEXT("claimed")) ? TEXT("true") : TEXT("false"),
						*FormatSpan(Clock.Remaining(NextReset.IsEmpty() ? Str(Ev, TEXT("endsAt")) : NextReset, Device))));
				}
				EndBusy();
			}));
		}));
	}));
}

const TArray<FString>& RpgOnlineScenario::StepNames()
{
	static const TArray<FString> Names = []()
	{
		TArray<FString> Out;
		for (const TCHAR* Name : StepList) Out.Add(Name);
		return Out;
	}();
	return Names;
}

void RpgOnlineScenario::Run(TSharedRef<FRpgOnlineClient, ESPMode::ThreadSafe> Client, const FRpgOnlineScenarioOptions& Options,
	FRpgOnlineScenarioStepDelegate OnStep, FRpgOnlineScenarioDoneDelegate OnDone)
{
	const TSharedRef<FRun, ESPMode::ThreadSafe> R = MakeShared<FRun, ESPMode::ThreadSafe>();
	R->Client = Client;
	R->O = Options;
	R->OnStep = OnStep;
	R->OnDone = OnDone;
	Next(R, [](TSharedRef<FRun, ESPMode::ThreadSafe> Run, const FString& Name, FStepOk Ok, FStepFail Fail) { RunStep(Run, Name, Ok, Fail); });
}

void RpgOnlineScenario::RunWithEventCommands(TSharedRef<FRpgOnlineClient, ESPMode::ThreadSafe> Client,
	FRpgOnlineScenarioStepDelegate OnStep, FRpgOnlineScenarioDoneDelegate OnDone)
{
	const TSharedRef<FMemoryEventHost, ESPMode::ThreadSafe> Host = MakeShared<FMemoryEventHost, ESPMode::ThreadSafe>();
	Host->SetVariable(10, 1200); // scoreVariable
	Host->SetVariable(20, 0);    // baseRevisionVariable（新しいスロット）
	Host->SetVariable(39, 0);    // beforeVariable（最初から）
	Host->SetVariable(41, 1);    // valueVariable（統計値に足す 1）
	const TSharedRef<FRpgOnlineEventCommandRunner, ESPMode::ThreadSafe> Runner = MakeShared<FRpgOnlineEventCommandRunner, ESPMode::ThreadSafe>(Client, Host);
	const FString BoardId = TEXT("boss-score-ue-") + Base36(FDateTime::UtcNow().ToUnixTimestamp());

	const TSharedRef<FRun, ESPMode::ThreadSafe> R = MakeShared<FRun, ESPMode::ThreadSafe>();
	R->Client = Client;
	R->OnStep = OnStep;
	R->OnDone = OnDone;
	Next(R, [Runner, Host, BoardId](TSharedRef<FRun, ESPMode::ThreadSafe> /*Run*/, const FString& Name, FStepOk Ok, FStepFail Fail)
	{
		const TSharedRef<TArray<FCommandLine>> Lines = MakeShared<TArray<FCommandLine>>(CommandsFor(Name, BoardId));
		RunLines(Runner, Host, Lines, 0, Ok, Fail);
	});
}
