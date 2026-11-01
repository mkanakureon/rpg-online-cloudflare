// RpgOnlineEventCommands.h — RPG 制作ツールのイベントコマンドとクライアント層の橋渡し。コマンドの一覧（1 か所）・応答の番号の表・差し替え口・実行の口。
//
// 設計は docs/guides/working/client-integration-design.md §6.4 と architecture.md §5（{ "command": "online.ranking.submit", "params": { ..., "responseVariable": 121 } }）。
// コマンドの名前は online.<機能>.<操作> で、スキーマの 20 の操作（§4 のシナリオの操作。更新の refreshToken を含む）に 1 つずつ当てる。
// 各コマンドは params に入力（文字はそのまま・名前が Variable で終わるものは変数の番号）と、結果を書く変数の番号 responseVariable を持つ。
// responseVariable には、成功なら 0、失敗なら画面の文の種類（§2.5 の 11 と unknown の 12）の番号を書く。
// 実行はイベントを「待ち」に入れ、応答（再試行を含む全部）が来たら OnFinished で次のコマンドへ進める。待ちの間もゲームを止めない（クライアント層が非同期）。
// 制作ツールのイベント実行機構にどうつなぐかは要確認（専用 PC で決める）。ここは差し替え口 IRpgOnlineEventHost までで、ツールのクラスを読み込まない。
// Mac の試験 test/unreal-client.test.ts が、このファイルを文字列として読む。そのため、表の行の形を変えない:
//   { TEXT("online.<機能>.<操作>"), TEXT("operationId"), TEXT("入力,..."), TEXT("出力,...") },（Commands の行）   { TEXT("種類"), 番号 },（ResponseNumbers の行）
// コマンドの名前の文字列は、この表の外（このファイルのコード）に書かない（試験が重なりとして数える）。
//
// 概要記述: Claude Opus 5.5 — 2026-11-01

#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "RpgOnlineClient.h"
#include "RpgOnlineClientPolicy.h"

/** イベントコマンド 1 つの定義（名前・当てる操作・params の入力と出力の名前。名前が Variable で終わるものは変数の番号）。 */
struct FRpgOnlineEventCommandDef
{
	const TCHAR* Name;
	const TCHAR* OperationId;
	const TCHAR* Inputs;
	const TCHAR* Outputs;
};

/** 画面の文の種類 1 つの応答の番号（responseVariable に書く値）。 */
struct FRpgOnlineResponseNumber
{
	const TCHAR* Category;
	int32 Number;
};

namespace RpgOnlineEventCommands
{
	/** 全部のコマンドが持つ、結果を書く変数の番号の params の名前。 */
	inline constexpr const TCHAR* ResponseVariableParam = TEXT("responseVariable");

	/** 成功のとき responseVariable に書く値。 */
	inline constexpr int32 SuccessNumber = 0;

	/** §2.5 の 12 の種類の番号（失敗のとき responseVariable に書く値。ゲームはこの番号で文を選ぶ）。 */
	inline constexpr FRpgOnlineResponseNumber ResponseNumbers[] = {
		{ TEXT("client-bug"), 1 },
		{ TEXT("not-found"), 2 },
		{ TEXT("unavailable"), 3 },
		{ TEXT("network"), 4 },
		{ TEXT("busy"), 5 },
		{ TEXT("session"), 6 },
		{ TEXT("banned"), 7 },
		{ TEXT("conflict"), 8 },
		{ TEXT("limit"), 9 },
		{ TEXT("expired"), 10 },
		{ TEXT("not-ready"), 11 },
		{ TEXT("unknown"), 12 },
	};

	/** イベントコマンドの一覧（ここ 1 か所。スキーマの 20 の操作に 1 つずつ）。 */
	inline constexpr FRpgOnlineEventCommandDef Commands[] = {
		{ TEXT("online.health.get"), TEXT("getHealth"), TEXT(""), TEXT("") },
		{ TEXT("online.config.get"), TEXT("getConfig"), TEXT("clientVersion"), TEXT("") },
		{ TEXT("online.config.master"), TEXT("getMasterData"), TEXT("key"), TEXT("sizeVariable") },
		{ TEXT("online.announcements.list"), TEXT("listAnnouncements"), TEXT(""), TEXT("countVariable") },
		{ TEXT("online.account.guest"), TEXT("issueGuest"), TEXT(""), TEXT("") },
		{ TEXT("online.account.refresh"), TEXT("refreshToken"), TEXT(""), TEXT("") },
		{ TEXT("online.ranking.submit"), TEXT("submitScore"), TEXT("boardId,scoreVariable,displayName"), TEXT("") },
		{ TEXT("online.ranking.get"), TEXT("getRanking"), TEXT("boardId,limit"), TEXT("countVariable,topScoreVariable") },
		{ TEXT("online.save.list"), TEXT("listSaves"), TEXT(""), TEXT("countVariable") },
		{ TEXT("online.save.get"), TEXT("getSave"), TEXT("slotId"), TEXT("revisionVariable") },
		{ TEXT("online.save.put"), TEXT("putSave"), TEXT("slotId,data,baseRevisionVariable"), TEXT("revisionVariable") },
		{ TEXT("online.save.delete"), TEXT("deleteSave"), TEXT("slotId,baseRevisionVariable"), TEXT("") },
		{ TEXT("online.inventory.get"), TEXT("getInventory"), TEXT("itemId"), TEXT("amountVariable") },
		{ TEXT("online.inventory.history"), TEXT("listInventoryHistory"), TEXT("limit,beforeVariable"), TEXT("countVariable,nextBeforeVariable") },
		{ TEXT("online.event.list"), TEXT("listEvents"), TEXT("eventId"), TEXT("openVariable,claimedVariable,remainingSecondsVariable") },
		{ TEXT("online.event.claim"), TEXT("claimEventReward"), TEXT("eventId"), TEXT("") },
		{ TEXT("online.player-data.get"), TEXT("getPlayerData"), TEXT("key"), TEXT("valueVariable") },
		{ TEXT("online.player-data.write"), TEXT("writePlayerData"), TEXT("key,valueVariable"), TEXT("") },
		{ TEXT("online.quest.list"), TEXT("listQuests"), TEXT("questId"), TEXT("completedVariable,claimedVariable,remainingSecondsVariable") },
		{ TEXT("online.quest.claim"), TEXT("claimQuest"), TEXT("questId"), TEXT("") },
	};

	/** 名前でコマンドを引く。知らない名前は nullptr。 */
	inline const FRpgOnlineEventCommandDef* Find(const FString& Name)
	{
		for (const FRpgOnlineEventCommandDef& Def : Commands)
		{
			if (Name.Equals(Def.Name, ESearchCase::CaseSensitive)) return &Def;
		}
		return nullptr;
	}

	/** 画面の文の種類の番号。知らない種類は unknown の番号。 */
	inline int32 NumberOf(const FString& Category)
	{
		int32 Unknown = 0;
		for (const FRpgOnlineResponseNumber& Row : ResponseNumbers)
		{
			if (Category.Equals(Row.Category, ESearchCase::CaseSensitive)) return Row.Number;
			if (FCString::Strcmp(Row.Category, RpgOnlineClientPolicy::UnknownCategory) == 0) Unknown = Row.Number;
		}
		return Unknown;
	}
}

/**
 * 制作ツールのイベント実行機構の側の差し替え口（要確認: 専用 PC のツールの変数の API に合わせて実装する）。
 * 変数は番号で読み書きする整数（architecture.md §5 の scoreVariable・responseVariable）。
 */
class RPGONLINECLIENT_API IRpgOnlineEventHost
{
public:
	virtual ~IRpgOnlineEventHost() = default;
	virtual int32 GetVariable(int32 Index) const = 0;
	virtual void SetVariable(int32 Index, int32 Value) = 0;
};

DECLARE_DELEGATE_OneParam(FRpgOnlineEventFinished, int32 /*ResponseNumber*/);

/**
 * イベントコマンドを実行する口。Execute は送るだけですぐ戻る。イベントの側は true が返ったら「待ち」に入り、
 * OnFinished が来たら次のコマンドへ進む（待ちの間もマップの描画と入力は止めない）。
 */
class RPGONLINECLIENT_API FRpgOnlineEventCommandRunner : public TSharedFromThis<FRpgOnlineEventCommandRunner, ESPMode::ThreadSafe>
{
public:
	FRpgOnlineEventCommandRunner(TSharedRef<FRpgOnlineClient, ESPMode::ThreadSafe> InClient, TSharedRef<IRpgOnlineEventHost, ESPMode::ThreadSafe> InHost);

	/**
	 * Command（online.<機能>.<操作>）を Params で実行する。知らない名前・params の誤りは送らずに responseVariable へ client-bug を書き、
	 * その場で OnFinished を呼んで false を返す（イベントは待ちに入らない）。
	 */
	bool Execute(const FString& Command, const TSharedRef<FJsonObject>& Params, FRpgOnlineEventFinished OnFinished);

	/** { "command": "...", "params": { ... } } の JSON の文字列 1 つを実行する（architecture.md §5 の形）。 */
	bool ExecuteJson(const FString& CommandJson, FRpgOnlineEventFinished OnFinished);

	/** いま応答を待っているコマンドの数（イベントの「待ち」の表示に使う）。 */
	int32 NumWaiting() const { return Waiting; }

	/** 結果を responseVariable に書く番号にする（成功は 0、失敗は種類の番号）。 */
	static int32 ResponseNumberOf(const FRpgOnlineResult& Result);

private:
	void Complete(const TSharedRef<FJsonObject>& Params, const FRpgOnlineResult& Result, TFunction<void(const TSharedPtr<FJsonObject>&)> WriteOutputs, FRpgOnlineEventFinished OnFinished);
	int32 ReadVariable(const TSharedRef<FJsonObject>& Params, const TCHAR* Name, int32 Default) const;
	void WriteVariable(const TSharedRef<FJsonObject>& Params, const TCHAR* Name, int32 Value);

	TSharedRef<FRpgOnlineClient, ESPMode::ThreadSafe> Client;
	TSharedRef<IRpgOnlineEventHost, ESPMode::ThreadSafe> Host;
	FRpgOnlineServerClock Clock;
	int32 Waiting = 0;
};
