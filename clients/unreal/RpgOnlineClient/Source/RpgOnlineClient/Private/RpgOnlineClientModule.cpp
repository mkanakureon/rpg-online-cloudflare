// RpgOnlineClientModule.cpp — プラグイン RpgOnlineClient のモジュールの登録と、ログの分類 LogRpgOnline の定義。
//
// モジュールの開始・終了ですることは無い（クライアント層は使う側が FRpgOnlineClient::Create で作る）。
//
// 概要記述: Claude Opus 5.5 — 2026-11-01

#include "Modules/ModuleManager.h"
#include "RpgOnlineClient.h"

DEFINE_LOG_CATEGORY(LogRpgOnline);

IMPLEMENT_MODULE(FDefaultModuleImpl, RpgOnlineClient)
