// RpgOnlineClient.cpp — Unreal のクライアント層の HTTP と再試行の中身。FHttpModule で送り、OnProcessRequestComplete で受け、待ちは FTSTicker のタイマー。
//
// 決まりは docs/guides/working/client-integration-design.md §2・§6.3 と、ブラウザの SDK の request()・Unity の RpgOnlineClient.Request() と同じ。
// 再試行は Request() から始まる 1 本の流れ（SendAttempt → HandleComplete → ScheduleRetry）だけで決め、操作の関数には書かない。値は RpgOnlineClientPolicy:: からだけ読む。
// タイムアウトは版に依る IHttpRequest::SetTimeout を使わず、タイマーで 10 秒たったら CancelRequest で切る（UE 5.1 より前の版でも同じに動く形。要確認: 専用 PC の版）。
// 完了のコールバックはゲームのスレッドで呼ばれる前提（要確認: UE 5.4 以降の完了のスレッドの設定。既定はゲームのスレッド）。ゲームのスレッドで同期の待ちはしない。
// トークンは保存先と Authorization の見出しにだけ置き、結果・ログ・UE_LOG に出さない。
//
// 概要記述: Claude Opus 5.5 — 2026-11-01

#include "RpgOnlineClient.h"
#include "RpgOnlineClientPolicy.h"
#include "HttpModule.h"
#include "GenericPlatform/GenericPlatformHttp.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonWriter.h"
#include "Serialization/JsonSerializer.h"
#include "Policies/CondensedJsonPrintPolicy.h"
#include "Misc/Guid.h"

namespace
{
	/** メモリーだけに置く既定の保存先（ゲームを閉じると消える）。 */
	class FMemorySessionStore final : public IRpgOnlineSessionStore
	{
	public:
		virtual FString Load(const FString& Key) override { const FString* V = Values.Find(Key); return V ? *V : FString(); }
		virtual void Save(const FString& Key, const FString& Value) override { Values.Add(Key, Value); }
		virtual void Delete(const FString& Key) override { Values.Remove(Key); }

	private:
		TMap<FString, FString> Values;
	};

	FString WriteJson(const TSharedRef<FJsonObject>& Object)
	{
		FString Out;
		const TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer = TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Out);
		FJsonSerializer::Serialize(Object, Writer);
		return Out;
	}

	TSharedPtr<FJsonObject> ReadJson(const FString& Text)
	{
		if (Text.IsEmpty()) return nullptr;
		TSharedPtr<FJsonObject> Object;
		const TSharedRef<TJsonReader<TCHAR>> Reader = TJsonReaderFactory<TCHAR>::Create(Text);
		return FJsonSerializer::Deserialize(Reader, Object) ? Object : nullptr;
	}

	FString Enc(const FString& S) { return FGenericPlatformHttp::UrlEncode(S); }

	// ---- SHA-256（セーブの checksum。版に依る暗号の部品を使わずに書く。FIPS 180-4） ----
	constexpr uint32 K256[64] = {
		0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
		0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
		0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
		0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
		0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
		0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
		0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
		0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
	};
	inline uint32 Rotr(uint32 X, uint32 N) { return (X >> N) | (X << (32 - N)); }

	FString Sha256OfBytes(const uint8* Data, int64 Length)
	{
		uint32 H[8] = { 0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19 };
		TArray<uint8> Msg;
		Msg.Append(Data, static_cast<int32>(Length));
		Msg.Add(0x80);
		while (Msg.Num() % 64 != 56) Msg.Add(0);
		const uint64 BitLength = static_cast<uint64>(Length) * 8;
		for (int32 I = 7; I >= 0; --I) Msg.Add(static_cast<uint8>(BitLength >> (I * 8)));
		for (int32 Chunk = 0; Chunk < Msg.Num(); Chunk += 64)
		{
			uint32 W[64];
			for (int32 I = 0; I < 16; ++I)
			{
				const uint8* P = &Msg[Chunk + I * 4];
				W[I] = (uint32(P[0]) << 24) | (uint32(P[1]) << 16) | (uint32(P[2]) << 8) | uint32(P[3]);
			}
			for (int32 I = 16; I < 64; ++I)
			{
				const uint32 S0 = Rotr(W[I - 15], 7) ^ Rotr(W[I - 15], 18) ^ (W[I - 15] >> 3);
				const uint32 S1 = Rotr(W[I - 2], 17) ^ Rotr(W[I - 2], 19) ^ (W[I - 2] >> 10);
				W[I] = W[I - 16] + S0 + W[I - 7] + S1;
			}
			uint32 A = H[0], B = H[1], C = H[2], D = H[3], E = H[4], F = H[5], G = H[6], HH = H[7];
			for (int32 I = 0; I < 64; ++I)
			{
				const uint32 S1 = Rotr(E, 6) ^ Rotr(E, 11) ^ Rotr(E, 25);
				const uint32 Ch = (E & F) ^ (~E & G);
				const uint32 T1 = HH + S1 + Ch + K256[I] + W[I];
				const uint32 S0 = Rotr(A, 2) ^ Rotr(A, 13) ^ Rotr(A, 22);
				const uint32 Maj = (A & B) ^ (A & C) ^ (B & C);
				const uint32 T2 = S0 + Maj;
				HH = G; G = F; F = E; E = D + T1; D = C; C = B; B = A; A = T1 + T2;
			}
			H[0] += A; H[1] += B; H[2] += C; H[3] += D; H[4] += E; H[5] += F; H[6] += G; H[7] += HH;
		}
		FString Hex;
		for (uint32 V : H) Hex += FString::Printf(TEXT("%08x"), V);
		return Hex;
	}
}

// ---- 結果・時刻 ----

TSharedPtr<FJsonObject> FRpgOnlineResult::Json() const
{
	return ReadJson(Text);
}

void FRpgOnlineServerClock::Update(const FString& ServerTime, const FDateTime& DeviceUtcNow)
{
	FDateTime Server;
	if (ParseTime(ServerTime, Server)) Offset = Server - DeviceUtcNow;
}

FTimespan FRpgOnlineServerClock::Remaining(const FString& Until, const FDateTime& DeviceUtcNow) const
{
	FDateTime End;
	if (!ParseTime(Until, End)) return FTimespan::Zero();
	const FTimespan Left = End - Now(DeviceUtcNow);
	return Left > FTimespan::Zero() ? Left : FTimespan::Zero();
}

// ---- 作り ----

TSharedRef<FRpgOnlineClient, ESPMode::ThreadSafe> FRpgOnlineClient::Create(const FRpgOnlineClientOptions& Options)
{
	return MakeShareable(new FRpgOnlineClient(Options));
}

FRpgOnlineClient::FRpgOnlineClient(const FRpgOnlineClientOptions& Options)
	: GameId(Options.GameId)
	, Root(Options.BaseUrl)
	, Store(Options.Store)
	, Log(Options.Log)
	, Random(Options.Random)
{
	Root.RemoveFromEnd(TEXT("/"));
	if (!Store.IsValid()) Store = MakeShared<FMemorySessionStore, ESPMode::ThreadSafe>();
	if (!Random) Random = []() { return FMath::FRand(); };
	SessionKey = FString::Printf(TEXT("rpg-online:%s:session"), *GameId);
}

FRpgOnlineClient::~FRpgOnlineClient()
{
	for (const FTSTicker::FDelegateHandle& Handle : PendingTickers) FTSTicker::GetCoreTicker().RemoveTicker(Handle);
	for (const TSharedPtr<FRequestState, ESPMode::ThreadSafe>& State : InFlight)
	{
		if (!State.IsValid()) continue;
		State->bFinished = true;
		FTSTicker::GetCoreTicker().RemoveTicker(State->TimeoutHandle);
		if (State->Http.IsValid())
		{
			State->Http->OnProcessRequestComplete().Unbind();
			State->Http->CancelRequest();
		}
	}
}

// ---- 決まりの道具 ----

FString FRpgOnlineClient::Categorize(int32 Status, const FString& Code)
{
	if (!Code.IsEmpty())
	{
		const FRpgOnlineErrorRule* Rule = RpgOnlineClientPolicy::FindError(Code);
		return Rule ? FString(Rule->Category) : FString(RpgOnlineClientPolicy::UnknownCategory);
	}
	if (Status == 0 || Status >= 500) return RpgOnlineClientPolicy::NetworkCategory;
	if (Status == 429) return RpgOnlineClientPolicy::BusyCategory;
	return RpgOnlineClientPolicy::UnknownCategory;
}

int32 FRpgOnlineClient::ParseRetryAfter(const FString& Value)
{
	const FString T = Value.TrimStartAndEnd();
	if (T.IsEmpty() || T.Len() > 9) return -1;
	for (const TCHAR Ch : T)
	{
		if (Ch < TEXT('0') || Ch > TEXT('9')) return -1;
	}
	const int32 Seconds = FCString::Atoi(*T);
	return Seconds >= 1 && Seconds <= RpgOnlineClientPolicy::RetryAfterMaxWaitSeconds ? Seconds : -1;
}

FString FRpgOnlineClient::Sha256Hex(const FString& Text)
{
	const FTCHARToUTF8 Utf8(*Text);
	return Sha256OfBytes(reinterpret_cast<const uint8*>(Utf8.Get()), Utf8.Length());
}

FString FRpgOnlineClient::NewIdempotencyKey()
{
	return FGuid::NewGuid().ToString(EGuidFormats::DigitsWithHyphens).ToLower();
}

// ---- セッション ----

bool FRpgOnlineClient::ReadSession(FString& OutBearer, FRpgOnlineSessionInfo& OutInfo) const
{
	const TSharedPtr<FJsonObject> Saved = ReadJson(Store->Load(SessionKey));
	if (!Saved.IsValid()) return false;
	FString Secret;
	if (!Saved->TryGetStringField(TEXT("token"), Secret) || Secret.IsEmpty()) return false;
	OutBearer = Secret;
	Saved->TryGetStringField(TEXT("gameId"), OutInfo.GameId);
	Saved->TryGetStringField(TEXT("playerId"), OutInfo.PlayerId);
	Saved->TryGetStringField(TEXT("expiresAt"), OutInfo.ExpiresAt);
	return true;
}

bool FRpgOnlineClient::GetSession(FRpgOnlineSessionInfo& OutInfo) const
{
	FString Ignored;
	return ReadSession(Ignored, OutInfo);
}

void FRpgOnlineClient::ClearSession()
{
	Store->Delete(SessionKey);
}

FRpgOnlineResult FRpgOnlineClient::StoreSession(const FRpgOnlineResult& Result)
{
	const TSharedPtr<FJsonObject> Body = Result.Json();
	FString Secret;
	if (!Body.IsValid() || !Body->TryGetStringField(TEXT("token"), Secret) || Secret.IsEmpty()) return Result;
	FRpgOnlineSessionInfo Info;
	Body->TryGetStringField(TEXT("gameId"), Info.GameId);
	Body->TryGetStringField(TEXT("playerId"), Info.PlayerId);
	Body->TryGetStringField(TEXT("expiresAt"), Info.ExpiresAt);

	const TSharedRef<FJsonObject> Saved = MakeShared<FJsonObject>();
	Saved->SetStringField(TEXT("gameId"), Info.GameId);
	Saved->SetStringField(TEXT("playerId"), Info.PlayerId);
	Saved->SetStringField(TEXT("token"), Secret);
	Saved->SetStringField(TEXT("expiresAt"), Info.ExpiresAt);
	Store->Save(SessionKey, WriteJson(Saved));

	// 結果の本文からトークンを除く
	const TSharedRef<FJsonObject> Visible = MakeShared<FJsonObject>();
	Visible->SetStringField(TEXT("gameId"), Info.GameId);
	Visible->SetStringField(TEXT("playerId"), Info.PlayerId);
	Visible->SetStringField(TEXT("expiresAt"), Info.ExpiresAt);
	FRpgOnlineResult Out = Result;
	Out.Text = WriteJson(Visible);
	return Out;
}

bool FRpgOnlineClient::NeedsRefresh(const FRpgOnlineSessionInfo& Info) const
{
	FDateTime ExpiresAt;
	if (!FRpgOnlineServerClock::ParseTime(Info.ExpiresAt, ExpiresAt)) return false;
	return (ExpiresAt - FDateTime::UtcNow()).GetTotalSeconds() < RpgOnlineClientPolicy::TokenRefreshBeforeSeconds;
}

void FRpgOnlineClient::RefreshOnce(FRpgOnlineResultDelegate OnDone)
{
	RefreshWaiters.Add(OnDone);
	if (bRefreshing) return;
	bRefreshing = true;
	FRequestSpec Spec;
	Spec.OperationId = TEXT("refreshToken");
	Spec.Verb = TEXT("POST");
	Spec.PathWithQuery = TEXT("/v1/accounts/token");
	Spec.bAuth = true;
	Spec.bSkipRefresh = true;
	TWeakPtr<FRpgOnlineClient, ESPMode::ThreadSafe> WeakThis = AsShared();
	Request(MoveTemp(Spec), FRpgOnlineResultDelegate::CreateLambda([WeakThis](const FRpgOnlineResult& Res)
	{
		const TSharedPtr<FRpgOnlineClient, ESPMode::ThreadSafe> This = WeakThis.Pin();
		if (!This.IsValid()) return;
		const FRpgOnlineResult Out = Res.bOk ? This->StoreSession(Res) : Res;
		TArray<FRpgOnlineResultDelegate> Waiters = MoveTemp(This->RefreshWaiters);
		This->RefreshWaiters.Reset();
		This->bRefreshing = false;
		for (FRpgOnlineResultDelegate& Waiter : Waiters) Waiter.ExecuteIfBound(Out);
	}));
}

// ---- 送り方と再試行（ここ 1 か所） ----

FString FRpgOnlineClient::BuildPath(const FString& Path, const TArray<TPair<FString, FString>>& Query) const
{
	FString Out = Path;
	bool bFirst = true;
	for (const TPair<FString, FString>& Pair : Query)
	{
		if (Pair.Value.IsEmpty()) continue;
		Out += bFirst ? TEXT("?") : TEXT("&");
		Out += Enc(Pair.Key) + TEXT("=") + Enc(Pair.Value);
		bFirst = false;
	}
	return Out;
}

void FRpgOnlineClient::Emit(const FRpgOnlineRequestLog& Entry) const
{
	// 記録にはトークンと本文を入れない（操作の名前・回数・状態・理由だけ）
	UE_LOG(LogRpgOnline, Verbose, TEXT("%s #%d -> %d %s %d ms"), *Entry.OperationId, Entry.Attempt, Entry.Status, *Entry.Reason, Entry.WaitMs);
	Log.ExecuteIfBound(Entry);
}

void FRpgOnlineClient::Request(FRequestSpec Spec, FRpgOnlineResultDelegate OnDone)
{
	const TSharedRef<FRequestState, ESPMode::ThreadSafe> State = MakeShared<FRequestState, ESPMode::ThreadSafe>();
	State->Spec = MoveTemp(Spec);
	State->OnDone = OnDone;
	InFlight.Add(State);

	if (!State->Spec.bAuth)
	{
		SendAttempt(State);
		return;
	}
	FString Bearer;
	FRpgOnlineSessionInfo Info;
	if (!ReadSession(Bearer, Info))
	{
		FRpgOnlineResult Res;
		Res.Error.Category = RpgOnlineClientPolicy::SessionCategory;
		Res.Error.Reason = TEXT("no-session");
		Finish(State, Res);
		return;
	}
	if (!State->Spec.bSkipRefresh && NeedsRefresh(Info))
	{
		TWeakPtr<FRpgOnlineClient, ESPMode::ThreadSafe> WeakThis = AsShared();
		RefreshOnce(FRpgOnlineResultDelegate::CreateLambda([WeakThis, State](const FRpgOnlineResult& Refreshed)
		{
			const TSharedPtr<FRpgOnlineClient, ESPMode::ThreadSafe> This = WeakThis.Pin();
			if (!This.IsValid()) return;
			// 期限切れ・壊れたトークンは更新できない。ゲストを発行し直さず session を返す（§2.7）
			if (!Refreshed.bOk && Refreshed.Error.Category == RpgOnlineClientPolicy::SessionCategory)
			{
				This->Finish(State, Refreshed);
				return;
			}
			This->StartWithSession(State);
		}));
		return;
	}
	StartWithSession(State);
}

void FRpgOnlineClient::StartWithSession(TSharedRef<FRequestState, ESPMode::ThreadSafe> State)
{
	FString Bearer;
	FRpgOnlineSessionInfo Info;
	if (!ReadSession(Bearer, Info))
	{
		FRpgOnlineResult Res;
		Res.Error.Category = RpgOnlineClientPolicy::SessionCategory;
		Res.Error.Reason = TEXT("no-session");
		Finish(State, Res);
		return;
	}
	State->Spec.Headers.Add(TEXT("Authorization"), TEXT("Bearer ") + Bearer);
	SendAttempt(State);
}

void FRpgOnlineClient::SendAttempt(TSharedRef<FRequestState, ESPMode::ThreadSafe> State)
{
	State->Attempts += 1;
	State->bTimedOut = false;

	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Http = FHttpModule::Get().CreateRequest();
	Http->SetURL(Root + State->Spec.PathWithQuery);
	Http->SetVerb(State->Spec.Verb);
	if (!State->Spec.Body.IsEmpty())
	{
		Http->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
		Http->SetContentAsString(State->Spec.Body);
	}
	for (const TPair<FString, FString>& Header : State->Spec.Headers) Http->SetHeader(Header.Key, Header.Value);
	State->Http = Http;

	TWeakPtr<FRpgOnlineClient, ESPMode::ThreadSafe> WeakThis = AsShared();
	Http->OnProcessRequestComplete().BindLambda([WeakThis, State](FHttpRequestPtr /*Request*/, FHttpResponsePtr Response, bool bConnectedSuccessfully)
	{
		const TSharedPtr<FRpgOnlineClient, ESPMode::ThreadSafe> This = WeakThis.Pin();
		if (This.IsValid()) This->HandleComplete(State, Response, bConnectedSuccessfully);
	});

	// 1 回の要求のタイムアウト（§2.1）。タイマーで切る。切った要求は OnProcessRequestComplete が接続の失敗として呼ばれる
	const IHttpRequest* Sent = &Http.Get();
	TWeakPtr<FRequestState, ESPMode::ThreadSafe> WeakState = State;
	State->TimeoutHandle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([WeakState, Sent](float /*DeltaTime*/)
	{
		const TSharedPtr<FRequestState, ESPMode::ThreadSafe> S = WeakState.Pin();
		if (S.IsValid() && !S->bFinished && S->Http.IsValid() && S->Http.Get() == Sent)
		{
			S->bTimedOut = true;
			S->Http->CancelRequest();
		}
		return false; // 1 回だけ
	}), static_cast<float>(RpgOnlineClientPolicy::TimeoutSeconds));

	if (!Http->ProcessRequest())
	{
		// 送る前に断られた（URL が不正など）。例外にせず回線断として扱う（ProcessRequest が false のとき完了は呼ばれない前提。要確認）
		HandleComplete(State, nullptr, false);
	}
}

void FRpgOnlineClient::HandleComplete(TSharedRef<FRequestState, ESPMode::ThreadSafe> State, FHttpResponsePtr Response, bool bConnectedSuccessfully)
{
	if (State->bFinished) return;
	FTSTicker::GetCoreTicker().RemoveTicker(State->TimeoutHandle);
	State->Http.Reset();

	const FRequestSpec& Spec = State->Spec;
	const TCHAR* Kind = RpgOnlineClientPolicy::RetryKindOf(Spec.OperationId);
	const bool bIsRevision = Kind != nullptr && FCString::Strcmp(Kind, RpgOnlineClientPolicy::NoAutoRetryKind) == 0;
	const bool bAutoRetry = Kind != nullptr && !bIsRevision;

	const bool bFailed = !bConnectedSuccessfully || !Response.IsValid() || Response->GetResponseCode() <= 0;
	const FString Failure = State->bTimedOut ? TEXT("timeout") : TEXT("network");
	const int32 Status = bFailed ? 0 : Response->GetResponseCode();
	const FString Text = bFailed ? FString() : Response->GetContentAsString();

	FRpgOnlineRequestLog Entry;
	Entry.OperationId = Spec.OperationId;
	Entry.Verb = Spec.Verb;
	Entry.Path = Spec.PathWithQuery;
	Entry.Attempt = State->Attempts;
	Entry.Status = Status;
	Entry.Reason = bFailed ? Failure : FString();
	Emit(Entry);

	if (!bFailed && ((Status >= 200 && Status < 300) || Status == 304))
	{
		FRpgOnlineResult Res;
		Res.bOk = true;
		Res.Status = Status;
		Res.Text = Text;
		Res.ETag = Response->GetHeader(TEXT("ETag"));
		Res.Attempts = State->Attempts;
		Finish(State, Res);
		return;
	}

	FString Code;
	if (!bFailed)
	{
		// JSON でない応答は状態コードだけで扱う（§2.4）
		const TSharedPtr<FJsonObject> Body = ReadJson(Text);
		const TSharedPtr<FJsonObject>* ErrorObject = nullptr;
		if (Body.IsValid() && Body->TryGetObjectField(TEXT("error"), ErrorObject) && ErrorObject && ErrorObject->IsValid())
		{
			(*ErrorObject)->TryGetStringField(TEXT("code"), Code);
		}
	}
	const FString Category = Categorize(Status, Code);
	const FString Reason = bFailed ? Failure : (Code.IsEmpty() ? FString::Printf(TEXT("HTTP %d"), Status) : FString::Printf(TEXT("HTTP %d %s"), Status, *Code));
	// 決まりの上で再試行してよい失敗か（コードが表にあれば表の retry、コードが無ければ回線断・タイムアウトと再試行する状態）
	bool bRetryableByPolicy = false;
	if (!Code.IsEmpty())
	{
		const FRpgOnlineErrorRule* Rule = RpgOnlineClientPolicy::FindError(Code);
		bRetryableByPolicy = Rule != nullptr && Rule->bRetry;
	}
	else
	{
		bRetryableByPolicy = bFailed || RpgOnlineClientPolicy::IsRetryStatus(Status);
	}

	auto Fail = [&](const FString& Extra)
	{
		FRpgOnlineResult Res;
		Res.Status = Status;
		Res.Attempts = State->Attempts;
		Res.Error.Code = Code;
		Res.Error.Category = Category;
		Res.Error.Status = Status;
		Res.Error.bRetryable = bAutoRetry && bRetryableByPolicy;
		Res.Error.Reason = Extra.IsEmpty() ? Reason : Reason + TEXT(" (") + Extra + TEXT(")");
		// revision の操作が通信の失敗・5xx で終わったら、書けたかどうか分からない（§2.4）
		Res.Error.bOutcomeUnknown = bIsRevision && Category == RpgOnlineClientPolicy::NetworkCategory;
		Finish(State, Res);
	};

	if (!bAutoRetry || !bRetryableByPolicy)
	{
		Fail(bIsRevision && Category == RpgOnlineClientPolicy::NetworkCategory ? TEXT("not retried: revision") : TEXT(""));
		return;
	}
	if (State->Attempts >= RpgOnlineClientPolicy::MaxAttempts)
	{
		Fail(FString::Printf(TEXT("gave up after %d attempts"), State->Attempts));
		return;
	}

	int32 WaitMs = 0;
	if (Status == 429)
	{
		const int32 Seconds = ParseRetryAfter(Response.IsValid() ? Response->GetHeader(TEXT("Retry-After")) : FString());
		if (Seconds < 0) { Fail(TEXT("no usable Retry-After")); return; }
		if (State->RateLimitRetries >= RpgOnlineClientPolicy::RetryAfterMaxRetries) { Fail(TEXT("rate limited again")); return; }
		State->RateLimitRetries += 1;
		WaitMs = Seconds * 1000;
	}
	else
	{
		const int32 CapMs = RpgOnlineClientPolicy::BackoffCapSeconds(State->Attempts) * 1000;
		const bool bFullJitter = FCString::Strcmp(RpgOnlineClientPolicy::BackoffJitter, TEXT("full")) == 0;
		WaitMs = bFullJitter ? FMath::RoundToInt(FMath::Clamp(Random(), 0.0f, 1.0f) * CapMs) : CapMs;
	}
	FRpgOnlineRequestLog WaitEntry = Entry;
	WaitEntry.Reason = TEXT("retry-wait");
	WaitEntry.WaitMs = WaitMs;
	Emit(WaitEntry);
	ScheduleRetry(State, WaitMs);
}

void FRpgOnlineClient::ScheduleRetry(TSharedRef<FRequestState, ESPMode::ThreadSafe> State, int32 WaitMs)
{
	// 再試行の前の待ちはタイマー（ゲームのスレッドを止めない）。待ちが 0 でも次のフレームで送る
	TWeakPtr<FRpgOnlineClient, ESPMode::ThreadSafe> WeakThis = AsShared();
	TSharedRef<FTSTicker::FDelegateHandle> HandleBox = MakeShared<FTSTicker::FDelegateHandle>();
	*HandleBox = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([WeakThis, State, HandleBox](float /*DeltaTime*/)
	{
		const TSharedPtr<FRpgOnlineClient, ESPMode::ThreadSafe> This = WeakThis.Pin();
		if (This.IsValid())
		{
			This->PendingTickers.Remove(*HandleBox);
			if (!State->bFinished) This->SendAttempt(State);
		}
		return false; // 1 回だけ
	}), WaitMs / 1000.0f);
	PendingTickers.Add(*HandleBox);
}

void FRpgOnlineClient::Finish(TSharedRef<FRequestState, ESPMode::ThreadSafe> State, const FRpgOnlineResult& Result)
{
	if (State->bFinished) return;
	State->bFinished = true;
	FTSTicker::GetCoreTicker().RemoveTicker(State->TimeoutHandle);
	InFlight.Remove(State);
	FRpgOnlineResultDelegate OnDone = State->OnDone;
	State->OnDone.Unbind();
	OnDone.ExecuteIfBound(Result);
}

// ---- 操作（20 個） ----

namespace
{
	using FQuery = TArray<TPair<FString, FString>>;
	FString Num(int32 Value) { return Value > 0 ? FString::FromInt(Value) : FString(); }
}

void FRpgOnlineClient::GetHealth(FRpgOnlineResultDelegate OnDone)
{
	FRequestSpec Spec;
	Spec.OperationId = TEXT("getHealth");
	Spec.Verb = TEXT("GET");
	Spec.PathWithQuery = TEXT("/health");
	Request(MoveTemp(Spec), OnDone);
}

void FRpgOnlineClient::IssueGuest(FRpgOnlineResultDelegate OnDone)
{
	const TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("gameId"), GameId);
	FRequestSpec Spec;
	Spec.OperationId = TEXT("issueGuest");
	Spec.Verb = TEXT("POST");
	Spec.PathWithQuery = TEXT("/v1/accounts/guest");
	Spec.Body = WriteJson(Body);
	TWeakPtr<FRpgOnlineClient, ESPMode::ThreadSafe> WeakThis = AsShared();
	Request(MoveTemp(Spec), FRpgOnlineResultDelegate::CreateLambda([WeakThis, OnDone](const FRpgOnlineResult& Res)
	{
		const TSharedPtr<FRpgOnlineClient, ESPMode::ThreadSafe> This = WeakThis.Pin();
		OnDone.ExecuteIfBound(Res.bOk && This.IsValid() ? This->StoreSession(Res) : Res);
	}));
}

void FRpgOnlineClient::RefreshToken(FRpgOnlineResultDelegate OnDone)
{
	RefreshOnce(OnDone);
}

void FRpgOnlineClient::ListAnnouncements(FRpgOnlineResultDelegate OnDone)
{
	FRequestSpec Spec;
	Spec.OperationId = TEXT("listAnnouncements");
	Spec.Verb = TEXT("GET");
	Spec.PathWithQuery = BuildPath(TEXT("/v1/announcements"), FQuery{ { TEXT("gameId"), GameId } });
	Request(MoveTemp(Spec), OnDone);
}

void FRpgOnlineClient::GetRanking(const FString& BoardId, int32 Limit, FRpgOnlineResultDelegate OnDone)
{
	FRequestSpec Spec;
	Spec.OperationId = TEXT("getRanking");
	Spec.Verb = TEXT("GET");
	Spec.PathWithQuery = BuildPath(TEXT("/v1/rankings/") + Enc(BoardId), FQuery{ { TEXT("gameId"), GameId }, { TEXT("limit"), Num(Limit) } });
	Request(MoveTemp(Spec), OnDone);
}

void FRpgOnlineClient::SubmitScore(const FString& BoardId, int32 Score, const FString& DisplayName, FRpgOnlineResultDelegate OnDone)
{
	FRpgOnlineSessionInfo Info;
	GetSession(Info);
	const TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("gameId"), GameId);
	Body->SetStringField(TEXT("playerId"), Info.PlayerId);
	Body->SetStringField(TEXT("displayName"), DisplayName);
	Body->SetNumberField(TEXT("score"), Score);
	FRequestSpec Spec;
	Spec.OperationId = TEXT("submitScore");
	Spec.Verb = TEXT("POST");
	Spec.PathWithQuery = TEXT("/v1/rankings/") + Enc(BoardId);
	Spec.Body = WriteJson(Body);
	Spec.bAuth = true;
	Request(MoveTemp(Spec), OnDone);
}

void FRpgOnlineClient::ListSaves(FRpgOnlineResultDelegate OnDone)
{
	FRequestSpec Spec;
	Spec.OperationId = TEXT("listSaves");
	Spec.Verb = TEXT("GET");
	Spec.PathWithQuery = BuildPath(TEXT("/v1/saves"), FQuery{ { TEXT("gameId"), GameId } });
	Spec.bAuth = true;
	Request(MoveTemp(Spec), OnDone);
}

void FRpgOnlineClient::GetSave(const FString& SlotId, FRpgOnlineResultDelegate OnDone)
{
	FRequestSpec Spec;
	Spec.OperationId = TEXT("getSave");
	Spec.Verb = TEXT("GET");
	Spec.PathWithQuery = BuildPath(TEXT("/v1/saves/") + Enc(SlotId), FQuery{ { TEXT("gameId"), GameId } });
	Spec.bAuth = true;
	Request(MoveTemp(Spec), OnDone);
}

void FRpgOnlineClient::PutSave(const FString& SlotId, const FString& Data, const FString& Checksum, int32 BaseRevision, int32 FormatVersion, FRpgOnlineResultDelegate OnDone)
{
	const TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetNumberField(TEXT("formatVersion"), FormatVersion);
	Body->SetStringField(TEXT("data"), Data);
	Body->SetStringField(TEXT("checksum"), Checksum);
	Body->SetNumberField(TEXT("baseRevision"), BaseRevision);
	FRequestSpec Spec;
	Spec.OperationId = TEXT("putSave");
	Spec.Verb = TEXT("PUT");
	Spec.PathWithQuery = BuildPath(TEXT("/v1/saves/") + Enc(SlotId), FQuery{ { TEXT("gameId"), GameId } });
	Spec.Body = WriteJson(Body);
	Spec.bAuth = true;
	Request(MoveTemp(Spec), OnDone);
}

void FRpgOnlineClient::DeleteSave(const FString& SlotId, int32 BaseRevision, FRpgOnlineResultDelegate OnDone)
{
	FRequestSpec Spec;
	Spec.OperationId = TEXT("deleteSave");
	Spec.Verb = TEXT("DELETE");
	Spec.PathWithQuery = BuildPath(TEXT("/v1/saves/") + Enc(SlotId), FQuery{ { TEXT("gameId"), GameId }, { TEXT("baseRevision"), FString::FromInt(BaseRevision) } });
	Spec.bAuth = true;
	Request(MoveTemp(Spec), OnDone);
}

void FRpgOnlineClient::ConfirmSave(const FString& SlotId, int32 ExpectedRevision, const FString& ExpectedChecksum, FRpgOnlineConfirmDelegate OnDone)
{
	GetSave(SlotId, FRpgOnlineResultDelegate::CreateLambda([ExpectedRevision, ExpectedChecksum, OnDone](const FRpgOnlineResult& Res)
	{
		if (ExpectedRevision < 0)
		{
			OnDone.ExecuteIfBound(!Res.bOk && Res.Error.Status == 404);
			return;
		}
		const TSharedPtr<FJsonObject> Save = Res.bOk ? Res.Json() : nullptr;
		int32 Revision = -1;
		FString Checksum;
		const bool bSame = Save.IsValid() && Save->TryGetNumberField(TEXT("revision"), Revision) && Save->TryGetStringField(TEXT("checksum"), Checksum)
			&& Revision == ExpectedRevision && Checksum == ExpectedChecksum;
		OnDone.ExecuteIfBound(bSame);
	}));
}

void FRpgOnlineClient::GetConfig(const FString& ClientVersion, const FString& IfNoneMatch, FRpgOnlineResultDelegate OnDone)
{
	FRequestSpec Spec;
	Spec.OperationId = TEXT("getConfig");
	Spec.Verb = TEXT("GET");
	Spec.PathWithQuery = BuildPath(TEXT("/v1/config"), FQuery{ { TEXT("gameId"), GameId }, { TEXT("clientVersion"), ClientVersion } });
	if (!IfNoneMatch.IsEmpty()) Spec.Headers.Add(TEXT("If-None-Match"), IfNoneMatch);
	Request(MoveTemp(Spec), OnDone);
}

void FRpgOnlineClient::GetMasterData(const FString& Key, const FString& IfNoneMatch, FRpgOnlineResultDelegate OnDone)
{
	FRequestSpec Spec;
	Spec.OperationId = TEXT("getMasterData");
	Spec.Verb = TEXT("GET");
	Spec.PathWithQuery = BuildPath(TEXT("/v1/config/master/") + Enc(Key), FQuery{ { TEXT("gameId"), GameId } });
	if (!IfNoneMatch.IsEmpty()) Spec.Headers.Add(TEXT("If-None-Match"), IfNoneMatch);
	Request(MoveTemp(Spec), OnDone);
}

void FRpgOnlineClient::GetInventory(FRpgOnlineResultDelegate OnDone)
{
	FRequestSpec Spec;
	Spec.OperationId = TEXT("getInventory");
	Spec.Verb = TEXT("GET");
	Spec.PathWithQuery = BuildPath(TEXT("/v1/inventory"), FQuery{ { TEXT("gameId"), GameId } });
	Spec.bAuth = true;
	Request(MoveTemp(Spec), OnDone);
}

void FRpgOnlineClient::ListInventoryHistory(int32 Limit, int32 Before, FRpgOnlineResultDelegate OnDone)
{
	FRequestSpec Spec;
	Spec.OperationId = TEXT("listInventoryHistory");
	Spec.Verb = TEXT("GET");
	Spec.PathWithQuery = BuildPath(TEXT("/v1/inventory/history"), FQuery{ { TEXT("gameId"), GameId }, { TEXT("limit"), Num(Limit) }, { TEXT("before"), Num(Before) } });
	Spec.bAuth = true;
	Request(MoveTemp(Spec), OnDone);
}

void FRpgOnlineClient::ListEvents(FRpgOnlineResultDelegate OnDone)
{
	FRequestSpec Spec;
	Spec.OperationId = TEXT("listEvents");
	Spec.Verb = TEXT("GET");
	Spec.PathWithQuery = BuildPath(TEXT("/v1/events"), FQuery{ { TEXT("gameId"), GameId } });
	Spec.bAuth = true;
	Request(MoveTemp(Spec), OnDone);
}

void FRpgOnlineClient::ClaimEventReward(const FString& EventId, FRpgOnlineResultDelegate OnDone)
{
	FRequestSpec Spec;
	Spec.OperationId = TEXT("claimEventReward");
	Spec.Verb = TEXT("POST");
	Spec.PathWithQuery = BuildPath(TEXT("/v1/events/") + Enc(EventId) + TEXT("/claim"), FQuery{ { TEXT("gameId"), GameId } });
	Spec.bAuth = true;
	Request(MoveTemp(Spec), OnDone);
}

void FRpgOnlineClient::GetPlayerData(FRpgOnlineResultDelegate OnDone)
{
	FRequestSpec Spec;
	Spec.OperationId = TEXT("getPlayerData");
	Spec.Verb = TEXT("GET");
	Spec.PathWithQuery = BuildPath(TEXT("/v1/player-data"), FQuery{ { TEXT("gameId"), GameId } });
	Spec.bAuth = true;
	Request(MoveTemp(Spec), OnDone);
}

void FRpgOnlineClient::WritePlayerData(const TArray<FRpgOnlinePlayerDataChange>& Changes, const FString& IdempotencyKey, FRpgOnlineResultDelegate OnDone)
{
	TArray<TSharedPtr<FJsonValue>> Rows;
	for (const FRpgOnlinePlayerDataChange& Change : Changes)
	{
		const TSharedRef<FJsonObject> Row = MakeShared<FJsonObject>();
		Row->SetStringField(TEXT("key"), Change.Key);
		Row->SetNumberField(TEXT("value"), Change.Value);
		Rows.Add(MakeShared<FJsonValueObject>(Row));
	}
	const TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetArrayField(TEXT("changes"), Rows);
	FRequestSpec Spec;
	Spec.OperationId = TEXT("writePlayerData");
	Spec.Verb = TEXT("POST");
	Spec.PathWithQuery = BuildPath(TEXT("/v1/player-data"), FQuery{ { TEXT("gameId"), GameId } });
	Spec.Body = WriteJson(Body);
	Spec.bAuth = true;
	// 鍵は Spec に入れて再試行の間も変えない（§2.2 の idempotency-key）。呼び出しごとに新しい鍵は FGuid::NewGuid から
	Spec.Headers.Add(TEXT("Idempotency-Key"), IdempotencyKey.IsEmpty() ? NewIdempotencyKey() : IdempotencyKey);
	Request(MoveTemp(Spec), OnDone);
}

void FRpgOnlineClient::ListQuests(FRpgOnlineResultDelegate OnDone)
{
	FRequestSpec Spec;
	Spec.OperationId = TEXT("listQuests");
	Spec.Verb = TEXT("GET");
	Spec.PathWithQuery = BuildPath(TEXT("/v1/quests"), FQuery{ { TEXT("gameId"), GameId } });
	Spec.bAuth = true;
	Request(MoveTemp(Spec), OnDone);
}

void FRpgOnlineClient::ClaimQuest(const FString& QuestId, FRpgOnlineResultDelegate OnDone)
{
	FRequestSpec Spec;
	Spec.OperationId = TEXT("claimQuest");
	Spec.Verb = TEXT("POST");
	Spec.PathWithQuery = BuildPath(TEXT("/v1/quests/") + Enc(QuestId) + TEXT("/claim"), FQuery{ { TEXT("gameId"), GameId } });
	Spec.bAuth = true;
	Request(MoveTemp(Spec), OnDone);
}
