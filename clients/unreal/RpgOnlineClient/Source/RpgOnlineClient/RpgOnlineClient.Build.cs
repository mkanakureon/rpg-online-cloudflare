// RpgOnlineClient.Build.cs — Unreal のプラグイン RpgOnlineClient の Runtime のモジュールの依存（HTTP・Json・JsonUtilities）。
//
// 設計は docs/guides/working/client-integration-design.md §6.1・§6.3。ソースだけを置き、ビルドの成果物（Binaries・Intermediate）は置かない。
// Mac には UE が無く、ビルドが通るかは専用 PC の手順 docs/guides/procedures/unreal-client-check.md の H5 で人が見る（要確認: UE の版）。
//
// 概要記述: Claude Opus 5.5 — 2026-11-01

using UnrealBuildTool;

public class RpgOnlineClient : ModuleRules
{
	public RpgOnlineClient(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"HTTP",
			"Json",
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"CoreUObject",
			"Engine",
			"JsonUtilities",
		});
	}
}
