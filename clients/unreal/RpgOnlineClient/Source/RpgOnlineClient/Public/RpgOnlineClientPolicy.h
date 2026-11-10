// RpgOnlineClientPolicy.h — Unreal のクライアント層の決まりの値（RpgOnlineClientPolicy:: の名前空間 1 つ）。タイムアウト・再試行・Retry-After・エラーコードの表・操作ごとの再試行の種類。
//
// 値の正はスキーマ openapi/rpg-online.v1.json の最上位の x-client-policy と各操作の x-retry（設計は
// docs/guides/working/client-integration-design.md §2・§3）。ここはその書き写しで、ブラウザの SDK（clients/browser/rpg-online-client.mjs）・
// Unity の RpgOnlineClientPolicy.cs と同じ値。食い違いは Mac の試験 test/unreal-client.test.ts が、このファイルを文字列として読んで見つける。
// そのため、値の行の形を変えない:
//   inline constexpr int32 Name = 数;   inline constexpr const TCHAR* Name = TEXT("文字");   inline constexpr int32 Name[] = { 数, ... };
//   { TEXT("コード"), TEXT("種類"), true|false },（ErrorCatalog の行）   { TEXT("operationId"), TEXT("種類") },（OperationRetry の行）
// 値を変えるときは、スキーマと 3 つのクライアントの定数を同じコミットで直す。
// UE 5.1 以上（C++17 の inline constexpr）を前提にした（要確認: 専用 PC の UE の版）。
//
// 概要記述: Claude Opus 5.5 — 2026-11-01

#pragma once

#include "CoreMinimal.h"

/** エラーコード 1 つの画面の文の種類と自動の再試行の可否（x-client-policy の errorCatalog の 1 行）。 */
struct FRpgOnlineErrorRule
{
	const TCHAR* Code;
	const TCHAR* Category;
	bool bRetry;
};

/** 操作 1 つの再試行の種類（各操作の x-retry）。 */
struct FRpgOnlineOperationRule
{
	const TCHAR* OperationId;
	const TCHAR* Kind;
};

/** 3 つのクライアントで共通の決まり（設計書 §2）。クライアント層はここだけから値を読む。 */
namespace RpgOnlineClientPolicy
{
	// §2.1 タイムアウトと再試行
	inline constexpr int32 TimeoutSeconds = 10;
	inline constexpr int32 MaxAttempts = 3;
	inline constexpr int32 BackoffBaseSeconds = 1;
	inline constexpr int32 BackoffFactor = 2;
	inline constexpr int32 BackoffMaxSeconds = 8;
	inline constexpr const TCHAR* BackoffJitter = TEXT("full");

	// §2.3 429 の Retry-After
	inline constexpr int32 RetryAfterMaxWaitSeconds = 60;
	inline constexpr int32 RetryAfterMaxRetries = 1;

	// 再試行する状態（回線断・タイムアウトも再試行する）
	inline constexpr int32 RetryStatuses[] = { 429, 500, 502, 503, 504 };

	// §2.7 期限までの残りがこの秒を切ったら次の要求の前にトークンを更新する
	inline constexpr int32 TokenRefreshBeforeSeconds = 604800;

	// 再試行の種類のうち、自動で送り直さないもの（§2.2）
	inline constexpr const TCHAR* NoAutoRetryKind = TEXT("revision");

	// §2.5 のエラーコードの表（スキーマの errorCatalog と同じ 19 行）
	inline constexpr FRpgOnlineErrorRule ErrorCatalog[] = {
		{ TEXT("INVALID_ARGUMENT"), TEXT("client-bug"), false },
		{ TEXT("INVALID_JSON"), TEXT("client-bug"), false },
		{ TEXT("PERMISSION_DENIED"), TEXT("client-bug"), false },
		{ TEXT("IDEMPOTENCY_KEY_REUSED"), TEXT("client-bug"), false },
		{ TEXT("PAYLOAD_TOO_LARGE"), TEXT("client-bug"), false },
		{ TEXT("NOT_FOUND"), TEXT("not-found"), false },
		{ TEXT("NOT_READY_FOR_PRODUCTION"), TEXT("unavailable"), false },
		{ TEXT("INTERNAL_ERROR"), TEXT("network"), true },
		{ TEXT("RATE_LIMITED"), TEXT("busy"), true },
		{ TEXT("UNAUTHENTICATED"), TEXT("session"), false },
		{ TEXT("TOKEN_EXPIRED"), TEXT("session"), false },
		{ TEXT("PLAYER_BANNED"), TEXT("banned"), false },
		{ TEXT("SAVE_CONFLICT"), TEXT("conflict"), false },
		{ TEXT("SLOT_LIMIT_EXCEEDED"), TEXT("limit"), false },
		{ TEXT("INVENTORY_LIMIT_EXCEEDED"), TEXT("limit"), false },
		{ TEXT("PLAYER_DATA_LIMIT_EXCEEDED"), TEXT("limit"), false },
		{ TEXT("RANKING_LIMIT_EXCEEDED"), TEXT("limit"), false },
		{ TEXT("EVENT_NOT_ACTIVE"), TEXT("expired"), false },
		{ TEXT("QUEST_NOT_ACTIVE"), TEXT("expired"), false },
		{ TEXT("QUEST_NOT_COMPLETED"), TEXT("not-ready"), false },
	};

	// §2.2 の操作ごとの再試行の種類（スキーマの 20 の操作の x-retry）
	inline constexpr FRpgOnlineOperationRule OperationRetry[] = {
		{ TEXT("getHealth"), TEXT("safe") },
		{ TEXT("issueGuest"), TEXT("new-resource") },
		{ TEXT("listAnnouncements"), TEXT("safe") },
		{ TEXT("getRanking"), TEXT("safe") },
		{ TEXT("submitScore"), TEXT("natural-key") },
		{ TEXT("listSaves"), TEXT("safe") },
		{ TEXT("getSave"), TEXT("safe") },
		{ TEXT("putSave"), TEXT("revision") },
		{ TEXT("deleteSave"), TEXT("revision") },
		{ TEXT("getConfig"), TEXT("safe") },
		{ TEXT("getMasterData"), TEXT("safe") },
		{ TEXT("getInventory"), TEXT("safe") },
		{ TEXT("listInventoryHistory"), TEXT("safe") },
		{ TEXT("listEvents"), TEXT("safe") },
		{ TEXT("claimEventReward"), TEXT("natural-key") },
		{ TEXT("getPlayerData"), TEXT("safe") },
		{ TEXT("writePlayerData"), TEXT("idempotency-key") },
		{ TEXT("listQuests"), TEXT("safe") },
		{ TEXT("claimQuest"), TEXT("natural-key") },
		{ TEXT("refreshToken"), TEXT("new-resource") },
	};

	// 表に無いコード・JSON でない 4xx の種類（§2.5）
	inline constexpr const TCHAR* UnknownCategory = TEXT("unknown");
	// コードの無い回線断・タイムアウト・5xx の種類（§2.4）
	inline constexpr const TCHAR* NetworkCategory = TEXT("network");
	// 429 のコードの無い応答の種類（§2.3）
	inline constexpr const TCHAR* BusyCategory = TEXT("busy");
	// トークンが無い・期限切れ・壊れたときの種類（§2.7）
	inline constexpr const TCHAR* SessionCategory = TEXT("session");

	/** コードの行を引く。表に無ければ nullptr。 */
	inline const FRpgOnlineErrorRule* FindError(const FString& Code)
	{
		if (Code.IsEmpty()) return nullptr;
		for (const FRpgOnlineErrorRule& Rule : ErrorCatalog)
		{
			if (Code.Equals(Rule.Code, ESearchCase::CaseSensitive)) return &Rule;
		}
		return nullptr;
	}

	/** 操作の再試行の種類。知らない操作は nullptr（自動で送り直さない）。 */
	inline const TCHAR* RetryKindOf(const FString& OperationId)
	{
		for (const FRpgOnlineOperationRule& Rule : OperationRetry)
		{
			if (OperationId.Equals(Rule.OperationId, ESearchCase::CaseSensitive)) return Rule.Kind;
		}
		return nullptr;
	}

	/** 再試行の n 回目（1 から）の前に待つ上限の秒（基本 × 倍率の n-1 乗・上限で頭打ち）。 */
	inline int32 BackoffCapSeconds(int32 RetryNumber)
	{
		double Cap = static_cast<double>(BackoffBaseSeconds);
		for (int32 I = 1; I < RetryNumber; ++I) Cap *= BackoffFactor;
		return static_cast<int32>(FMath::Min(static_cast<double>(BackoffMaxSeconds), Cap));
	}

	/** 状態コードが再試行する状態か。 */
	inline bool IsRetryStatus(int32 Status)
	{
		for (int32 S : RetryStatuses)
		{
			if (S == Status) return true;
		}
		return false;
	}
}
