// RpgOnlineScenario.h — §4 の同一の API シナリオ（Unreal 版）の口。クライアント層で直に流す形と、イベントコマンドの橋渡しを通して流す形の 2 つ。
//
// 手順の名前と順は、ブラウザの SDK（clients/browser/rpg-online-client.mjs）の SCENARIO_STEPS と同じ（中身は RpgOnlineScenario.cpp）。
// 人が専用 PC で見るためのコンソールのコマンド（RpgOnline.Scenario など）も RpgOnlineScenario.cpp にある。手順は docs/guides/procedures/unreal-client-check.md。
//
// 概要記述: Claude Opus 5.5 — 2026-11-01

#pragma once

#include "CoreMinimal.h"
#include "RpgOnlineClient.h"

/** 手順 1 つの結果。 */
struct RPGONLINECLIENT_API FRpgOnlineScenarioStep
{
	FString Name;
	bool bOk = false;
	FString Detail;
	FString Category;
};

/** シナリオ全体の結果。失敗したら FailedName・FailedCategory・FailedReason が入る。 */
struct RPGONLINECLIENT_API FRpgOnlineScenarioResult
{
	bool bOk = false;
	TArray<FRpgOnlineScenarioStep> Steps;
	FString FailedName;
	FString FailedCategory;
	FString FailedReason;
};

/** シナリオが使う demo-rpg の手本（ブラウザの SDK の SCENARIO_DEFAULTS と同じ値。名前と枠だけ UE 用）。 */
struct RPGONLINECLIENT_API FRpgOnlineScenarioOptions
{
	FString ClientVersion = TEXT("1.0.0");
	FString BoardPrefix = TEXT("boss-score");
	FString DisplayName = TEXT("UE Tester");
	int32 Score = 1200;
	FString SlotId = TEXT("ue-smoke");
	FString EventId = TEXT("daily-login");
	FString PlayerDataKey = TEXT("slimes-defeated");
	FString AchievementId = TEXT("first-slime");
	FString QuestId = TEXT("first-hunt");
};

DECLARE_DELEGATE_OneParam(FRpgOnlineScenarioStepDelegate, const FRpgOnlineScenarioStep& /*Step*/);
DECLARE_DELEGATE_OneParam(FRpgOnlineScenarioDoneDelegate, const FRpgOnlineScenarioResult& /*Result*/);

namespace RpgOnlineScenario
{
	/** §4 の手順の名前（順）。ブラウザの SDK の SCENARIO_STEPS と同じ。 */
	RPGONLINECLIENT_API const TArray<FString>& StepNames();

	/** §4 のシナリオをクライアント層で直に流す（H6 のシナリオ・H5 の前の確かめ）。失敗した手順で止まる。送るだけですぐ戻る。 */
	RPGONLINECLIENT_API void Run(TSharedRef<FRpgOnlineClient, ESPMode::ThreadSafe> Client, const FRpgOnlineScenarioOptions& Options,
		FRpgOnlineScenarioStepDelegate OnStep, FRpgOnlineScenarioDoneDelegate OnDone);

	/** 同じ手順を、イベントコマンド（online.<機能>.<操作> の JSON）を順に実行して流す（H6 のイベントコマンドでシナリオが通る）。 */
	RPGONLINECLIENT_API void RunWithEventCommands(TSharedRef<FRpgOnlineClient, ESPMode::ThreadSafe> Client,
		FRpgOnlineScenarioStepDelegate OnStep, FRpgOnlineScenarioDoneDelegate OnDone);
}
