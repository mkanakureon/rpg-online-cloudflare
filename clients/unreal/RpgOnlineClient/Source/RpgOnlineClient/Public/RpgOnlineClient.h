// RpgOnlineClient.h — Unreal のクライアント層の HTTP と再試行の口（FRpgOnlineClient）。結果の構造体・ログの記録・セッションの保存先の差し替え口・サーバーの時刻の差。
//
// 決まり（タイムアウト・再試行・Retry-After・画面の文の種類）は docs/guides/working/client-integration-design.md §2・§5.4・§6.3 と、
// ブラウザの SDK（clients/browser/rpg-online-client.mjs）・Unity の層（clients/unity/Runtime/RpgOnlineClient.cs）と同じ。値は RpgOnlineClientPolicy:: からだけ読む。
// 送り方は FHttpModule。完了は OnProcessRequestComplete のコールバックで受け、再試行の待ちとタイムアウトは FTSTicker のタイマー（ゲームのスレッドで同期の待ちをしない）。
// 失敗は例外にせず FRpgOnlineResult（bOk=false・Error）で返す。トークンはセッションの保存先にだけ置き、結果にもログにも出さない。
// Steam などの認証は作らない（設計書 §8。既定はゲストのトークン）。UE 5.1 以上を前提にした（要確認: 専用 PC の UE の版）。
//
// 概要記述: Claude Opus 5.5 — 2026-11-01

#pragma once

#include "CoreMinimal.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Containers/Ticker.h"
#include "Dom/JsonObject.h"

RPGONLINECLIENT_API DECLARE_LOG_CATEGORY_EXTERN(LogRpgOnline, Log, All);

/** 失敗の中身（ブラウザの SDK の { code, category, status, retryable, reason, outcomeUnknown } に当たる）。 */
struct RPGONLINECLIENT_API FRpgOnlineError
{
	/** サーバーのエラーコード。回線断・タイムアウト・JSON でない応答は空。 */
	FString Code;
	/** 画面の文の種類（§2.5 の 11 と unknown）。ゲームはこれで文を選ぶ。 */
	FString Category;
	/** HTTP の状態コード。応答が無い（回線断・タイムアウト）ときは 0。 */
	int32 Status = 0;
	/** 決まりの上で再試行してよい失敗で、その操作が自動の再試行を許すか。 */
	bool bRetryable = false;
	/** 開発者が読む理由（画面に出さない）。 */
	FString Reason;
	/** revision の操作（セーブの書き込み・削除）が通信の失敗で終わり、書けたか分からない（§2.4。ConfirmSave で読み直す）。 */
	bool bOutcomeUnknown = false;
};

/** 操作 1 つの結果（§5.4 の { ok, error } に当たる）。成功は bOk=true と Status・Text、失敗は bOk=false と Error。 */
struct RPGONLINECLIENT_API FRpgOnlineResult
{
	bool bOk = false;
	int32 Status = 0;
	/** 応答の生の本文（304 は空。発行・更新の応答はトークンを除いた本文）。 */
	FString Text;
	FString ETag;
	int32 Attempts = 0;
	FRpgOnlineError Error;

	/** 本文を JSON のオブジェクトにする。空・JSON でないときは無効なポインター。 */
	TSharedPtr<FJsonObject> Json() const;
};

/** 要求ごとのログの記録（トークンと本文を含まない）。 */
struct RPGONLINECLIENT_API FRpgOnlineRequestLog
{
	FString OperationId;
	FString Verb;
	FString Path;
	int32 Attempt = 0;
	int32 Status = 0;
	/** 応答が無いときの理由（timeout・network）か、再試行の待ちのとき retry-wait。 */
	FString Reason;
	int32 WaitMs = 0;
};

DECLARE_DELEGATE_OneParam(FRpgOnlineResultDelegate, const FRpgOnlineResult& /*Result*/);
DECLARE_DELEGATE_OneParam(FRpgOnlineConfirmDelegate, bool /*bConfirmed*/);
DECLARE_DELEGATE_OneParam(FRpgOnlineLogDelegate, const FRpgOnlineRequestLog& /*Entry*/);

/** トークンの保存先の差し替え口。既定はメモリーだけ（要確認: 長く置くなら USaveGame などの UE の保存の API。設計書 §2.7）。 */
class RPGONLINECLIENT_API IRpgOnlineSessionStore
{
public:
	virtual ~IRpgOnlineSessionStore() = default;
	virtual FString Load(const FString& Key) = 0;
	virtual void Save(const FString& Key, const FString& Value) = 0;
	virtual void Delete(const FString& Key) = 0;
};

/** 保存したセッション（トークンを除く）。 */
struct RPGONLINECLIENT_API FRpgOnlineSessionInfo
{
	FString GameId;
	FString PlayerId;
	FString ExpiresAt;
};

/** 統計値の書き込みの 1 行（POST /v1/player-data の changes）。 */
struct RPGONLINECLIENT_API FRpgOnlinePlayerDataChange
{
	FString Key;
	int32 Value = 0;
};

/** クライアントの作りの差し替え口（人の確かめで乱数・保存先・ログを替える）。 */
struct RPGONLINECLIENT_API FRpgOnlineClientOptions
{
	FString BaseUrl = TEXT("http://127.0.0.1:8787");
	FString GameId = TEXT("demo-rpg");
	/** 保存先。無ければメモリー。 */
	TSharedPtr<IRpgOnlineSessionStore, ESPMode::ThreadSafe> Store;
	/** 要求ごとの記録を受ける口（トークンと本文を含まない）。 */
	FRpgOnlineLogDelegate Log;
	/** 0 以上 1 以下の乱数（全幅の揺らぎ）。無ければ FMath::FRand。 */
	TFunction<float()> Random;
};

/**
 * Unreal のクライアント層の入口。操作ごとの関数は送るだけですぐ戻り、結果は渡した FRpgOnlineResultDelegate で受ける（ゲームのスレッド。フレームは止まらない）。
 * 作るときは FRpgOnlineClient::Create（コールバックが弱い参照で自分を指すため、TSharedRef で持つ）。
 */
class RPGONLINECLIENT_API FRpgOnlineClient : public TSharedFromThis<FRpgOnlineClient, ESPMode::ThreadSafe>
{
public:
	static TSharedRef<FRpgOnlineClient, ESPMode::ThreadSafe> Create(const FRpgOnlineClientOptions& Options = FRpgOnlineClientOptions());
	~FRpgOnlineClient();

	const FString& GetGameId() const { return GameId; }

	// ---- 決まりの道具（§2.3・§2.5） ----

	/** エラーのコードと状態コードから画面の文の種類を決める。表に無いコードと JSON でない 4xx は unknown、コードの無い回線断・タイムアウト・5xx は network。 */
	static FString Categorize(int32 Status, const FString& Code);
	/** Retry-After の見出しの値を秒（1〜上限）にする。無い・数でない・0・上限を超えるときは -1（待たずに返す）。 */
	static int32 ParseRetryAfter(const FString& Value);
	/** Text の UTF-8 のバイト列の SHA-256 を小文字の 16 進で返す（セーブの checksum。要確認: FSHA256 の無い版は別の実装を使う）。 */
	static FString Sha256Hex(const FString& Text);

	// ---- セッション（トークンを外へ出さない） ----

	/** 保存したセッション（トークンを除く）。無ければ false。 */
	bool GetSession(FRpgOnlineSessionInfo& OutInfo) const;
	/** 保存したセッションを消す（ゲームが「新しく始める」を選んだとき）。 */
	void ClearSession();

	// ---- 操作（20 個。operationId はスキーマの名前） ----

	void GetHealth(FRpgOnlineResultDelegate OnDone);
	/** ゲストを発行し、トークンを保存先に置く。結果の Text にトークンは入れない。 */
	void IssueGuest(FRpgOnlineResultDelegate OnDone);
	/** 保存したトークンを、期限を先にした新しいトークンに取り替える（期限まで 7 日を切れば、トークンの要る要求の前に自分で呼ぶ）。 */
	void RefreshToken(FRpgOnlineResultDelegate OnDone);
	void ListAnnouncements(FRpgOnlineResultDelegate OnDone);
	void GetRanking(const FString& BoardId, int32 Limit, FRpgOnlineResultDelegate OnDone);
	void SubmitScore(const FString& BoardId, int32 Score, const FString& DisplayName, FRpgOnlineResultDelegate OnDone);
	void ListSaves(FRpgOnlineResultDelegate OnDone);
	void GetSave(const FString& SlotId, FRpgOnlineResultDelegate OnDone);
	/** セーブを書く（revision の種類なので自動で送り直さない。bOutcomeUnknown なら ConfirmSave で読み直す）。 */
	void PutSave(const FString& SlotId, const FString& Data, const FString& Checksum, int32 BaseRevision, int32 FormatVersion, FRpgOnlineResultDelegate OnDone);
	void DeleteSave(const FString& SlotId, int32 BaseRevision, FRpgOnlineResultDelegate OnDone);
	/** 結果が分からないセーブの書き込み・削除を読み直して確かめる（§2.4）。ExpectedRevision が負なら消えている（404）こと、そうでなければ revision と checksum が同じこと。 */
	void ConfirmSave(const FString& SlotId, int32 ExpectedRevision, const FString& ExpectedChecksum, FRpgOnlineConfirmDelegate OnDone);
	void GetConfig(const FString& ClientVersion, const FString& IfNoneMatch, FRpgOnlineResultDelegate OnDone);
	void GetMasterData(const FString& Key, const FString& IfNoneMatch, FRpgOnlineResultDelegate OnDone);
	void GetInventory(FRpgOnlineResultDelegate OnDone);
	/** 受領の履歴を 1 ページ読む。Before が 0 なら最初から（続きは応答の nextBefore）。 */
	void ListInventoryHistory(int32 Limit, int32 Before, FRpgOnlineResultDelegate OnDone);
	void ListEvents(FRpgOnlineResultDelegate OnDone);
	void ClaimEventReward(const FString& EventId, FRpgOnlineResultDelegate OnDone);
	void GetPlayerData(FRpgOnlineResultDelegate OnDone);
	/**
	 * 統計値を書く。IdempotencyKey が空なら呼び出しごとに FGuid::NewGuid() で新しい Idempotency-Key を作り、再試行では同じ鍵を使う。
	 * 同じ書き込みをゲームが送り直すときだけ、前の鍵を渡す。
	 */
	void WritePlayerData(const TArray<FRpgOnlinePlayerDataChange>& Changes, const FString& IdempotencyKey, FRpgOnlineResultDelegate OnDone);
	void ListQuests(FRpgOnlineResultDelegate OnDone);
	void ClaimQuest(const FString& QuestId, FRpgOnlineResultDelegate OnDone);

	/** 新しい Idempotency-Key（FGuid::NewGuid の小文字の 36 文字。サーバーの形 [a-zA-Z0-9_-]{8,64} に入る）。 */
	static FString NewIdempotencyKey();

private:
	explicit FRpgOnlineClient(const FRpgOnlineClientOptions& Options);

	/** 送る操作 1 つの中身（再試行の間も同じものを使う。Idempotency-Key もここに入って変わらない）。 */
	struct FRequestSpec
	{
		FString OperationId;
		FString Verb;
		FString PathWithQuery;
		FString Body;
		bool bAuth = false;
		bool bSkipRefresh = false;
		TMap<FString, FString> Headers;
	};
	/** 送っている操作 1 つの進み（回数・429 の送り直しの回数・タイムアウトのタイマー）。 */
	struct FRequestState
	{
		FRequestSpec Spec;
		FRpgOnlineResultDelegate OnDone;
		int32 Attempts = 0;
		int32 RateLimitRetries = 0;
		bool bTimedOut = false;
		bool bFinished = false;
		TSharedPtr<IHttpRequest, ESPMode::ThreadSafe> Http;
		FTSTicker::FDelegateHandle TimeoutHandle;
	};

	void Request(FRequestSpec Spec, FRpgOnlineResultDelegate OnDone);
	void StartWithSession(TSharedRef<FRequestState, ESPMode::ThreadSafe> State);
	void SendAttempt(TSharedRef<FRequestState, ESPMode::ThreadSafe> State);
	void HandleComplete(TSharedRef<FRequestState, ESPMode::ThreadSafe> State, FHttpResponsePtr Response, bool bConnectedSuccessfully);
	void ScheduleRetry(TSharedRef<FRequestState, ESPMode::ThreadSafe> State, int32 WaitMs);
	void Finish(TSharedRef<FRequestState, ESPMode::ThreadSafe> State, const FRpgOnlineResult& Result);
	void Emit(const FRpgOnlineRequestLog& Entry) const;

	FString BuildPath(const FString& Path, const TArray<TPair<FString, FString>>& Query) const;
	/** 発行・更新の応答の本文を保存し、トークンを除いた本文を結果の Text に戻す。 */
	FRpgOnlineResult StoreSession(const FRpgOnlineResult& Result);
	bool ReadSession(FString& OutBearer, FRpgOnlineSessionInfo& OutInfo) const;
	bool NeedsRefresh(const FRpgOnlineSessionInfo& Info) const;
	void RefreshOnce(FRpgOnlineResultDelegate OnDone);

	FString GameId;
	FString Root;
	FString SessionKey;
	TSharedPtr<IRpgOnlineSessionStore, ESPMode::ThreadSafe> Store;
	FRpgOnlineLogDelegate Log;
	TFunction<float()> Random;
	/** 進行中の更新を待つ呼び出し（同時に 2 本の更新を送らない）。 */
	TArray<FRpgOnlineResultDelegate> RefreshWaiters;
	bool bRefreshing = false;
	/** 動いているタイマー（壊すときに外す）。 */
	TArray<FTSTicker::FDelegateHandle> PendingTickers;
	TArray<TSharedPtr<FRequestState, ESPMode::ThreadSafe>> InFlight;
};

/**
 * サーバーの時刻と端末の時刻の差（§2.8）。一覧（イベント・クエスト）を読むたびに Update で取り直し、残り時間の表示だけに使う。
 * 期間の内か外か・受け取れるかはサーバーが決める（端末の時刻で判断しない。K4 の UE の 2 本目・H6）。
 */
class RPGONLINECLIENT_API FRpgOnlineServerClock
{
public:
	/** 差 = serverTime − 端末の今 を覚える。読めなければ前の差のまま。 */
	void Update(const FString& ServerTime, const FDateTime& DeviceUtcNow);
	/** サーバーの時刻での今（端末の今 + 差）。 */
	FDateTime Now(const FDateTime& DeviceUtcNow) const { return DeviceUtcNow + Offset; }
	/** Until（endsAt・nextResetAt）までの残り。読めない・過ぎたときは 0。 */
	FTimespan Remaining(const FString& Until, const FDateTime& DeviceUtcNow) const;
	static bool ParseTime(const FString& Iso, FDateTime& Out) { return FDateTime::ParseIso8601(*Iso, Out); }

private:
	FTimespan Offset = FTimespan::Zero();
};
