// RpgOnlineEventCommands.cpp — イベントコマンドの実行の口（FRpgOnlineEventCommandRunner）の中身。コマンドの定義の操作（operationId）でクライアント層の関数に振り分ける。
//
// コマンドの名前の一覧は RpgOnlineEventCommands.h の 1 か所だけ（ここには名前を書かず、定義の operationId で分ける）。設計は client-integration-design.md §6.4。
// 結果は responseVariable に、成功なら 0、失敗なら画面の文の種類の番号で書く。出力の変数（countVariable など）は成功のときだけ書く。
// 期間の内か外か・残り時間の出力は、一覧の serverTime で取った差（FRpgOnlineServerClock）で出し、端末の時刻だけで決めない（§2.8・H6）。
//
// 概要記述: Claude Opus 5.5 — 2026-11-01

#include "RpgOnlineEventCommands.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace
{
	/** params の文字の値。数で書かれていても文字にする。無ければ空。 */
	FString StringParam(const TSharedRef<FJsonObject>& Params, const TCHAR* Name)
	{
		FString Value;
		if (Params->TryGetStringField(Name, Value)) return Value;
		double Number = 0;
		if (Params->TryGetNumberField(Name, Number)) return FString::FromInt(static_cast<int32>(Number));
		return FString();
	}

	int32 IntParam(const TSharedRef<FJsonObject>& Params, const TCHAR* Name, int32 Default)
	{
		int32 Value = Default;
		return Params->TryGetNumberField(Name, Value) ? Value : Default;
	}

	const TArray<TSharedPtr<FJsonValue>>* ArrayOf(const TSharedPtr<FJsonObject>& Body, const TCHAR* Name)
	{
		const TArray<TSharedPtr<FJsonValue>>* Items = nullptr;
		return Body.IsValid() && Body->TryGetArrayField(Name, Items) ? Items : nullptr;
	}

	/** 配列 Name の中で、Field が Value の最初のオブジェクト。 */
	TSharedPtr<FJsonObject> FindRow(const TSharedPtr<FJsonObject>& Body, const TCHAR* Name, const TCHAR* Field, const FString& Value)
	{
		if (const TArray<TSharedPtr<FJsonValue>>* Items = ArrayOf(Body, Name))
		{
			for (const TSharedPtr<FJsonValue>& Item : *Items)
			{
				const TSharedPtr<FJsonObject> Row = Item.IsValid() ? Item->AsObject() : nullptr;
				FString Got;
				if (Row.IsValid() && Row->TryGetStringField(Field, Got) && Got == Value) return Row;
			}
		}
		return nullptr;
	}

	FRpgOnlineResult ClientBug(const FString& Reason)
	{
		FRpgOnlineResult Res;
		Res.Error.Category = TEXT("client-bug");
		Res.Error.Reason = Reason;
		return Res;
	}
}

FRpgOnlineEventCommandRunner::FRpgOnlineEventCommandRunner(TSharedRef<FRpgOnlineClient, ESPMode::ThreadSafe> InClient, TSharedRef<IRpgOnlineEventHost, ESPMode::ThreadSafe> InHost)
	: Client(InClient)
	, Host(InHost)
{
}

int32 FRpgOnlineEventCommandRunner::ResponseNumberOf(const FRpgOnlineResult& Result)
{
	return Result.bOk ? RpgOnlineEventCommands::SuccessNumber : RpgOnlineEventCommands::NumberOf(Result.Error.Category);
}

int32 FRpgOnlineEventCommandRunner::ReadVariable(const TSharedRef<FJsonObject>& Params, const TCHAR* Name, int32 Default) const
{
	int32 Index = -1;
	return Params->TryGetNumberField(Name, Index) && Index >= 0 ? Host->GetVariable(Index) : Default;
}

void FRpgOnlineEventCommandRunner::WriteVariable(const TSharedRef<FJsonObject>& Params, const TCHAR* Name, int32 Value)
{
	int32 Index = -1;
	if (Params->TryGetNumberField(Name, Index) && Index >= 0) Host->SetVariable(Index, Value);
}

void FRpgOnlineEventCommandRunner::Complete(const TSharedRef<FJsonObject>& Params, const FRpgOnlineResult& Result,
	TFunction<void(const TSharedPtr<FJsonObject>&)> WriteOutputs, FRpgOnlineEventFinished OnFinished)
{
	if (Result.bOk && WriteOutputs) WriteOutputs(Result.Json());
	const int32 Number = ResponseNumberOf(Result);
	WriteVariable(Params, RpgOnlineEventCommands::ResponseVariableParam, Number);
	OnFinished.ExecuteIfBound(Number);
}

bool FRpgOnlineEventCommandRunner::ExecuteJson(const FString& CommandJson, FRpgOnlineEventFinished OnFinished)
{
	TSharedPtr<FJsonObject> Root;
	const TSharedRef<TJsonReader<TCHAR>> Reader = TJsonReaderFactory<TCHAR>::Create(CommandJson);
	FString Command;
	const TSharedPtr<FJsonObject>* Params = nullptr;
	if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid() || !Root->TryGetStringField(TEXT("command"), Command)
		|| !Root->TryGetObjectField(TEXT("params"), Params) || Params == nullptr || !Params->IsValid())
	{
		// responseVariable が読めないので書けない。番号だけ返す
		OnFinished.ExecuteIfBound(RpgOnlineEventCommands::NumberOf(TEXT("client-bug")));
		return false;
	}
	return Execute(Command, Params->ToSharedRef(), OnFinished);
}

bool FRpgOnlineEventCommandRunner::Execute(const FString& Command, const TSharedRef<FJsonObject>& Params, FRpgOnlineEventFinished OnFinished)
{
	const FRpgOnlineEventCommandDef* Def = RpgOnlineEventCommands::Find(Command);
	if (Def == nullptr)
	{
		Complete(Params, ClientBug(TEXT("unknown command")), nullptr, OnFinished);
		return false;
	}

	const FString Op = Def->OperationId;
	const TWeakPtr<FRpgOnlineEventCommandRunner, ESPMode::ThreadSafe> WeakThis = AsShared();
	Waiting += 1;

	// 応答が来たら出力を書き、responseVariable を書いて、イベントを先へ進める
	auto Done = [WeakThis, Params, OnFinished](TFunction<void(const TSharedPtr<FJsonObject>&)> WriteOutputs)
	{
		return FRpgOnlineResultDelegate::CreateLambda([WeakThis, Params, OnFinished, WriteOutputs](const FRpgOnlineResult& Res)
		{
			const TSharedPtr<FRpgOnlineEventCommandRunner, ESPMode::ThreadSafe> This = WeakThis.Pin();
			if (!This.IsValid()) return;
			This->Waiting -= 1;
			This->Complete(Params, Res, WriteOutputs, OnFinished);
		});
	};
	auto Count = [this, Params](const TCHAR* ArrayName)
	{
		return [this, Params, ArrayName](const TSharedPtr<FJsonObject>& Body)
		{
			const TArray<TSharedPtr<FJsonValue>>* Items = ArrayOf(Body, ArrayName);
			WriteVariable(Params, TEXT("countVariable"), Items ? Items->Num() : 0);
		};
	};
	// 期間の出力（イベントとクエスト）。期間の内外と残りはサーバーの時刻で出す
	auto Period = [this, Params](const TCHAR* IdField, const FString& Id, const TCHAR* FlagField, const TCHAR* FlagVariable)
	{
		return [this, Params, IdField, Id, FlagField, FlagVariable](const TSharedPtr<FJsonObject>& Body)
		{
			FString ServerTime;
			if (Body.IsValid() && Body->TryGetStringField(TEXT("serverTime"), ServerTime)) Clock.Update(ServerTime, FDateTime::UtcNow());
			const TSharedPtr<FJsonObject> Row = FindRow(Body, TEXT("items"), IdField, Id);
			if (!Row.IsValid()) return;
			bool bFlag = false;
			bool bClaimed = false;
			Row->TryGetBoolField(FlagField, bFlag);
			Row->TryGetBoolField(TEXT("claimed"), bClaimed);
			FString StartsAt, EndsAt, NextResetAt;
			Row->TryGetStringField(TEXT("startsAt"), StartsAt);
			Row->TryGetStringField(TEXT("endsAt"), EndsAt);
			Row->TryGetStringField(TEXT("nextResetAt"), NextResetAt);
			const FDateTime Now = FDateTime::UtcNow();
			if (FlagVariable != nullptr)
			{
				// open: サーバーの時刻（端末の今 + 差）で開始と終了の間か
				FDateTime Start, End;
				const FDateTime ServerNow = Clock.Now(Now);
				const bool bOpen = FRpgOnlineServerClock::ParseTime(StartsAt, Start) && ServerNow >= Start
					&& (!FRpgOnlineServerClock::ParseTime(EndsAt, End) || ServerNow < End);
				WriteVariable(Params, FlagVariable, bOpen ? 1 : 0);
			}
			else
			{
				WriteVariable(Params, TEXT("completedVariable"), bFlag ? 1 : 0);
			}
			WriteVariable(Params, TEXT("claimedVariable"), bClaimed ? 1 : 0);
			const FTimespan Left = Clock.Remaining(NextResetAt.IsEmpty() ? EndsAt : NextResetAt, Now);
			WriteVariable(Params, TEXT("remainingSecondsVariable"), static_cast<int32>(Left.GetTotalSeconds()));
		};
	};

	if (Op == TEXT("getHealth")) Client->GetHealth(Done(nullptr));
	else if (Op == TEXT("getConfig")) Client->GetConfig(StringParam(Params, TEXT("clientVersion")), FString(), Done(nullptr));
	else if (Op == TEXT("getMasterData"))
	{
		Client->GetMasterData(StringParam(Params, TEXT("key")), FString(), Done([this, Params](const TSharedPtr<FJsonObject>& Body)
		{
			FString Data;
			if (Body.IsValid() && Body->TryGetStringField(TEXT("data"), Data)) WriteVariable(Params, TEXT("sizeVariable"), FTCHARToUTF8(*Data).Length());
		}));
	}
	else if (Op == TEXT("listAnnouncements")) Client->ListAnnouncements(Done(Count(TEXT("items"))));
	else if (Op == TEXT("issueGuest")) Client->IssueGuest(Done(nullptr));
	else if (Op == TEXT("refreshToken")) Client->RefreshToken(Done(nullptr));
	else if (Op == TEXT("submitScore"))
	{
		Client->SubmitScore(StringParam(Params, TEXT("boardId")), ReadVariable(Params, TEXT("scoreVariable"), 0), StringParam(Params, TEXT("displayName")), Done(nullptr));
	}
	else if (Op == TEXT("getRanking"))
	{
		Client->GetRanking(StringParam(Params, TEXT("boardId")), IntParam(Params, TEXT("limit"), 0), Done([this, Params](const TSharedPtr<FJsonObject>& Body)
		{
			const TArray<TSharedPtr<FJsonValue>>* Items = ArrayOf(Body, TEXT("items"));
			WriteVariable(Params, TEXT("countVariable"), Items ? Items->Num() : 0);
			int32 Top = 0;
			if (Items && Items->Num() > 0 && (*Items)[0].IsValid() && (*Items)[0]->AsObject().IsValid()) (*Items)[0]->AsObject()->TryGetNumberField(TEXT("score"), Top);
			WriteVariable(Params, TEXT("topScoreVariable"), Top);
		}));
	}
	else if (Op == TEXT("listSaves")) Client->ListSaves(Done(Count(TEXT("items"))));
	else if (Op == TEXT("getSave") || Op == TEXT("putSave"))
	{
		auto Revision = [this, Params](const TSharedPtr<FJsonObject>& Body)
		{
			int32 Rev = 0;
			if (Body.IsValid() && Body->TryGetNumberField(TEXT("revision"), Rev)) WriteVariable(Params, TEXT("revisionVariable"), Rev);
		};
		const FString SlotId = StringParam(Params, TEXT("slotId"));
		if (Op == TEXT("getSave")) Client->GetSave(SlotId, Done(Revision));
		else
		{
			const FString Data = StringParam(Params, TEXT("data"));
			Client->PutSave(SlotId, Data, FRpgOnlineClient::Sha256Hex(Data), ReadVariable(Params, TEXT("baseRevisionVariable"), 0), 1, Done(Revision));
		}
	}
	else if (Op == TEXT("deleteSave"))
	{
		Client->DeleteSave(StringParam(Params, TEXT("slotId")), ReadVariable(Params, TEXT("baseRevisionVariable"), 0), Done(nullptr));
	}
	else if (Op == TEXT("getInventory"))
	{
		const FString ItemId = StringParam(Params, TEXT("itemId"));
		Client->GetInventory(Done([this, Params, ItemId](const TSharedPtr<FJsonObject>& Body)
		{
			TSharedPtr<FJsonObject> Row = FindRow(Body, TEXT("currencies"), TEXT("itemId"), ItemId);
			if (!Row.IsValid()) Row = FindRow(Body, TEXT("items"), TEXT("itemId"), ItemId);
			int32 Amount = 0;
			if (Row.IsValid()) Row->TryGetNumberField(TEXT("amount"), Amount);
			WriteVariable(Params, TEXT("amountVariable"), Amount);
		}));
	}
	else if (Op == TEXT("listInventoryHistory"))
	{
		Client->ListInventoryHistory(IntParam(Params, TEXT("limit"), 0), ReadVariable(Params, TEXT("beforeVariable"), 0), Done([this, Params](const TSharedPtr<FJsonObject>& Body)
		{
			const TArray<TSharedPtr<FJsonValue>>* Items = ArrayOf(Body, TEXT("items"));
			WriteVariable(Params, TEXT("countVariable"), Items ? Items->Num() : 0);
			int32 NextBefore = 0;
			if (Body.IsValid()) Body->TryGetNumberField(TEXT("nextBefore"), NextBefore);
			WriteVariable(Params, TEXT("nextBeforeVariable"), NextBefore);
		}));
	}
	else if (Op == TEXT("listEvents"))
	{
		Client->ListEvents(Done(Period(TEXT("eventId"), StringParam(Params, TEXT("eventId")), TEXT("claimed"), TEXT("openVariable"))));
	}
	else if (Op == TEXT("claimEventReward")) Client->ClaimEventReward(StringParam(Params, TEXT("eventId")), Done(nullptr));
	else if (Op == TEXT("getPlayerData"))
	{
		const FString Key = StringParam(Params, TEXT("key"));
		Client->GetPlayerData(Done([this, Params, Key](const TSharedPtr<FJsonObject>& Body)
		{
			const TSharedPtr<FJsonObject> Row = FindRow(Body, TEXT("values"), TEXT("key"), Key);
			int32 Value = 0;
			if (Row.IsValid()) Row->TryGetNumberField(TEXT("value"), Value);
			WriteVariable(Params, TEXT("valueVariable"), Value);
		}));
	}
	else if (Op == TEXT("writePlayerData"))
	{
		// 鍵は呼び出しごとに新しく作り、クライアント層の再試行の間は同じ鍵を使う
		TArray<FRpgOnlinePlayerDataChange> Changes;
		FRpgOnlinePlayerDataChange Change;
		Change.Key = StringParam(Params, TEXT("key"));
		Change.Value = ReadVariable(Params, TEXT("valueVariable"), 0);
		Changes.Add(Change);
		Client->WritePlayerData(Changes, FString(), Done(nullptr));
	}
	else if (Op == TEXT("listQuests"))
	{
		Client->ListQuests(Done(Period(TEXT("questId"), StringParam(Params, TEXT("questId")), TEXT("completed"), nullptr)));
	}
	else if (Op == TEXT("claimQuest")) Client->ClaimQuest(StringParam(Params, TEXT("questId")), Done(nullptr));
	else
	{
		// 一覧にあるのに振り分けの無い操作（一覧と振り分けの食い違い）
		Waiting -= 1;
		Complete(Params, ClientBug(TEXT("command without a handler")), nullptr, OnFinished);
		return false;
	}
	return true;
}
