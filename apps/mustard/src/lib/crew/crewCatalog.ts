// 봇 카탈로그(#1394) — 고를 수 있는 봇 = 기본 8 + 외부 MIT 에이전트 54. 순수 모듈(화면·서버 공용).
// 외부 항목: 이름·한 줄 설명은 여기서 ko/ja/en, 지시문·권한은 생성물(crewCatalogAgents.ts, 서버에서만 읽음).
// 기본 항목: 이름·설명은 기존 i18n(crew.role.<id> / crew.roleDesc.<id>), 지시문은 crewRoleDefaults.
// langs = 이 봇이 맞는 파일 확장자(레포 언어 비율로 추천할 때 씀). 비면 언어 무관.
import { CREW_ROLES } from "./crewTypes.ts";

export type CatalogGroup = "team" | "review" | "lang" | "build" | "test" | "security" | "design" | "docs" | "assistant";
export type L10n = { ko: string; ja: string; en: string };
export type CatalogItem = { id: string; group: CatalogGroup; langs: string[]; builtin?: boolean; name?: L10n; desc?: L10n };

const TS = ["ts", "tsx", "js", "jsx", "mjs", "cjs"];
const x = (id: string, group: CatalogGroup, langs: string[], ko: [string, string], ja: [string, string], en: [string, string]): CatalogItem =>
  ({ id, group, langs, name: { ko: ko[0], ja: ja[0], en: en[0] }, desc: { ko: ko[1], ja: ja[1], en: en[1] } });

const EXTERNAL: CatalogItem[] = [
  // 리뷰(언어 무관)
  x("code-reviewer", "review", [], ["코드 리뷰어", "바뀐 코드를 품질·보안·유지보수 눈으로 봐요"], ["コードレビュアー", "変更を品質・セキュリティ・保守性の目で見ます"], ["Code Reviewer", "Reviews changes for quality, security and maintainability"]),
  x("commit-reviewer", "review", [], ["커밋 리뷰어", "올릴 변경을 보고 레포 관례에 맞는 커밋 메시지를 써요"], ["コミットレビュアー", "変更を見てリポジトリの慣例に合うコミットメッセージを書きます"], ["Commit Reviewer", "Reads the staged diff and drafts a commit message in the repo's style"]),
  x("pr-test-analyzer", "review", [], ["PR 테스트 분석가", "PR의 테스트가 실제 버그를 막는지 따져요"], ["PRテスト分析", "PRのテストが本当にバグを防げるかを確かめます"], ["PR Test Analyzer", "Checks whether a PR's tests actually prevent bugs"]),
  x("silent-failure-hunter", "review", [], ["조용한 실패 사냥꾼", "삼킨 오류·잘못된 대체값·안 넘긴 에러를 찾아요"], ["サイレント障害ハンター", "握りつぶした例外や誤ったフォールバックを探します"], ["Silent Failure Hunter", "Finds swallowed errors, bad fallbacks and lost error propagation"]),
  x("comment-analyzer", "review", [], ["주석 점검", "주석이 코드와 맞는지, 낡지 않았는지 봐요"], ["コメント点検", "コメントがコードと合っているか、古くないかを見ます"], ["Comment Analyzer", "Checks comments for accuracy and rot"]),
  x("type-design-analyzer", "review", TS, ["타입 설계 점검", "타입이 규칙을 제대로 담고 막아 주는지 봐요"], ["型設計点検", "型がルールをきちんと表し守っているかを見ます"], ["Type Design Analyzer", "Checks that types express and enforce the rules"]),
  x("database-reviewer", "review", ["sql"], ["DB 리뷰어", "PostgreSQL 쿼리·스키마·마이그레이션을 봐요"], ["DBレビュアー", "PostgreSQLのクエリ・スキーマ・マイグレーションを見ます"], ["Database Reviewer", "Reviews PostgreSQL queries, schemas and migrations"]),
  x("mle-reviewer", "review", ["py", "ipynb"], ["ML 엔지니어링 리뷰어", "데이터·학습 재현·서빙·모니터링을 봐요"], ["MLエンジニアリングレビュアー", "データ・学習の再現性・サービング・監視を見ます"], ["ML Engineering Reviewer", "Reviews data contracts, training reproducibility, serving and monitoring"]),
  x("rag-pipeline-reviewer", "review", ["py", "ts"], ["RAG 리뷰어", "검색 품질·청크 나누기·임베딩·평가를 봐요"], ["RAGレビュアー", "検索品質・チャンク分割・埋め込み・評価を見ます"], ["RAG Pipeline Reviewer", "Reviews retrieval quality, chunking, embeddings and evaluation"]),
  // 언어별 리뷰
  x("typescript-reviewer", "lang", TS, ["TypeScript 리뷰어", "TS/JS 코드의 타입 안전·비동기·관용구를 봐요"], ["TypeScriptレビュアー", "TS/JSの型安全・非同期・慣用句を見ます"], ["TypeScript Reviewer", "Reviews TS/JS for type safety, async and idioms"]),
  x("react-reviewer", "lang", ["tsx", "jsx"], ["React 리뷰어", "훅 규칙·렌더링·접근성을 봐요"], ["Reactレビュアー", "フックのルール・レンダリング・アクセシビリティを見ます"], ["React Reviewer", "Reviews hooks rules, rendering and accessibility"]),
  x("vue-reviewer", "lang", ["vue"], ["Vue 리뷰어", "Vue 컴포넌트·반응성·관례를 봐요"], ["Vueレビュアー", "Vueのコンポーネント・リアクティビティ・慣例を見ます"], ["Vue Reviewer", "Reviews Vue components, reactivity and conventions"]),
  x("python-reviewer", "lang", ["py"], ["Python 리뷰어", "PEP 8·타입 힌트·보안·관용구를 봐요"], ["Pythonレビュアー", "PEP 8・型ヒント・セキュリティ・慣用句を見ます"], ["Python Reviewer", "Reviews PEP 8, type hints, security and idioms"]),
  x("django-reviewer", "lang", ["py"], ["Django 리뷰어", "ORM·마이그레이션·보안 설정을 봐요"], ["Djangoレビュアー", "ORM・マイグレーション・セキュリティ設定を見ます"], ["Django Reviewer", "Reviews ORM use, migrations and security settings"]),
  x("fastapi-reviewer", "lang", ["py"], ["FastAPI 리뷰어", "라우트·의존성·검증·비동기를 봐요"], ["FastAPIレビュアー", "ルート・依存性・検証・非同期を見ます"], ["FastAPI Reviewer", "Reviews routes, dependencies, validation and async"]),
  x("go-reviewer", "lang", ["go"], ["Go 리뷰어", "관용구·동시성·오류 처리를 봐요"], ["Goレビュアー", "慣用句・並行処理・エラー処理を見ます"], ["Go Reviewer", "Reviews idioms, concurrency and error handling"]),
  x("rust-reviewer", "lang", ["rs"], ["Rust 리뷰어", "소유권·수명·unsafe·관용구를 봐요"], ["Rustレビュアー", "所有権・ライフタイム・unsafe・慣用句を見ます"], ["Rust Reviewer", "Reviews ownership, lifetimes, unsafe and idioms"]),
  x("java-reviewer", "lang", ["java"], ["Java 리뷰어", "Spring·JPA·동시성·보안을 봐요"], ["Javaレビュアー", "Spring・JPA・並行処理・セキュリティを見ます"], ["Java Reviewer", "Reviews Spring, JPA, concurrency and security"]),
  x("kotlin-reviewer", "lang", ["kt", "kts"], ["Kotlin 리뷰어", "코루틴·널 안전·Android/KMP 관례를 봐요"], ["Kotlinレビュアー", "コルーチン・null安全・Android/KMPの慣例を見ます"], ["Kotlin Reviewer", "Reviews coroutines, null safety and Android/KMP conventions"]),
  x("swift-reviewer", "lang", ["swift"], ["Swift 리뷰어", "동시성·메모리·SwiftUI 관례를 봐요"], ["Swiftレビュアー", "並行処理・メモリ・SwiftUIの慣例を見ます"], ["Swift Reviewer", "Reviews concurrency, memory and SwiftUI conventions"]),
  x("flutter-reviewer", "lang", ["dart"], ["Flutter 리뷰어", "위젯·상태 관리·성능을 봐요"], ["Flutterレビュアー", "ウィジェット・状態管理・パフォーマンスを見ます"], ["Flutter Reviewer", "Reviews widgets, state management and performance"]),
  x("cpp-reviewer", "lang", ["cpp", "cc", "cxx", "h", "hpp", "c"], ["C++ 리뷰어", "메모리 안전·모던 C++·동시성을 봐요"], ["C++レビュアー", "メモリ安全・モダンC++・並行処理を見ます"], ["C++ Reviewer", "Reviews memory safety, modern C++ and concurrency"]),
  x("csharp-reviewer", "lang", ["cs"], ["C# 리뷰어", ".NET 관례·async·널 안전을 봐요"], ["C#レビュアー", ".NETの慣例・async・null安全を見ます"], ["C# Reviewer", "Reviews .NET conventions, async and nullability"]),
  x("fsharp-reviewer", "lang", ["fs", "fsx"], ["F# 리뷰어", "함수형 관용구·타입·.NET 연동을 봐요"], ["F#レビュアー", "関数型の慣用句・型・.NET連携を見ます"], ["F# Reviewer", "Reviews functional idioms, types and .NET interop"]),
  x("php-reviewer", "lang", ["php"], ["PHP 리뷰어", "보안·타입·프레임워크 관례를 봐요"], ["PHPレビュアー", "セキュリティ・型・フレームワークの慣例を見ます"], ["PHP Reviewer", "Reviews security, types and framework conventions"]),
  x("ruby-reviewer", "lang", ["rb"], ["Ruby 리뷰어", "Rails 관례·보안·성능을 봐요"], ["Rubyレビュアー", "Railsの慣例・セキュリティ・パフォーマンスを見ます"], ["Ruby Reviewer", "Reviews Rails conventions, security and performance"]),
  x("gdscript-reviewer", "lang", ["gd"], ["GDScript 리뷰어", "Godot 4 타입·씬·시그널을 봐요"], ["GDScriptレビュアー", "Godot 4の型・シーン・シグナルを見ます"], ["GDScript Reviewer", "Reviews Godot 4 typing, scenes and signals"]),
  // 빌드 오류 고치기
  x("build-error-resolver", "build", TS, ["빌드 오류 해결사", "빌드·타입 오류를 최소한으로 고쳐 다시 초록불로"], ["ビルドエラー解決", "ビルドと型のエラーを最小の変更で直します"], ["Build Error Resolver", "Fixes build and type errors with minimal changes"]),
  x("react-build-resolver", "build", ["tsx", "jsx"], ["React 빌드 해결사", "번들러·JSX·의존성 빌드 오류를 고쳐요"], ["Reactビルド解決", "バンドラー・JSX・依存関係のビルドエラーを直します"], ["React Build Resolver", "Fixes bundler, JSX and dependency build errors"]),
  x("go-build-resolver", "build", ["go"], ["Go 빌드 해결사", "go build·vet·모듈 오류를 고쳐요"], ["Goビルド解決", "go build・vet・モジュールのエラーを直します"], ["Go Build Resolver", "Fixes go build, vet and module errors"]),
  x("rust-build-resolver", "build", ["rs"], ["Rust 빌드 해결사", "cargo·빌림 검사기 오류를 고쳐요"], ["Rustビルド解決", "cargo・借用チェッカーのエラーを直します"], ["Rust Build Resolver", "Fixes cargo and borrow-checker errors"]),
  x("java-build-resolver", "build", ["java"], ["Java 빌드 해결사", "Maven·Gradle·컴파일 오류를 고쳐요"], ["Javaビルド解決", "Maven・Gradle・コンパイルエラーを直します"], ["Java Build Resolver", "Fixes Maven, Gradle and compile errors"]),
  x("kotlin-build-resolver", "build", ["kt", "kts"], ["Kotlin 빌드 해결사", "Gradle·컴파일 오류를 고쳐요"], ["Kotlinビルド解決", "Gradle・コンパイルエラーを直します"], ["Kotlin Build Resolver", "Fixes Gradle and compile errors"]),
  x("swift-build-resolver", "build", ["swift"], ["Swift 빌드 해결사", "Xcode·SPM 빌드 오류를 고쳐요"], ["Swiftビルド解決", "Xcode・SPMのビルドエラーを直します"], ["Swift Build Resolver", "Fixes Xcode and SPM build errors"]),
  x("dart-build-resolver", "build", ["dart"], ["Dart 빌드 해결사", "Flutter·pub·분석 오류를 고쳐요"], ["Dartビルド解決", "Flutter・pub・解析エラーを直します"], ["Dart Build Resolver", "Fixes Flutter, pub and analyzer errors"]),
  x("cpp-build-resolver", "build", ["cpp", "cc", "cxx", "h", "hpp", "c"], ["C++ 빌드 해결사", "CMake·링크·컴파일 오류를 고쳐요"], ["C++ビルド解決", "CMake・リンク・コンパイルエラーを直します"], ["C++ Build Resolver", "Fixes CMake, link and compile errors"]),
  x("django-build-resolver", "build", ["py"], ["Django 빌드 해결사", "마이그레이션·설정·임포트 오류를 고쳐요"], ["Djangoビルド解決", "マイグレーション・設定・インポートエラーを直します"], ["Django Build Resolver", "Fixes migration, settings and import errors"]),
  x("pytorch-build-resolver", "build", ["py"], ["PyTorch 오류 해결사", "CUDA·텐서 모양·학습 오류를 고쳐요"], ["PyTorchエラー解決", "CUDA・テンソル形状・学習のエラーを直します"], ["PyTorch Build Resolver", "Fixes CUDA, tensor shape and training errors"]),
  // 테스트
  x("tdd-guide", "test", [], ["TDD 코치", "테스트 먼저 쓰고 구현하게 이끌어요"], ["TDDコーチ", "テストを先に書いてから実装するよう導きます"], ["TDD Guide", "Drives test-first development"]),
  x("e2e-runner", "test", TS, ["E2E 테스터", "브라우저 E2E 테스트를 만들고 돌려요"], ["E2Eテスター", "ブラウザのE2Eテストを作って実行します"], ["E2E Runner", "Writes and runs browser end-to-end tests"]),
  // 보안·성능
  x("security-reviewer", "security", [], ["보안 리뷰어", "비밀값·주입·인증 같은 취약점을 찾아요"], ["セキュリティレビュアー", "秘密情報・インジェクション・認証の脆弱性を探します"], ["Security Reviewer", "Finds secrets, injection and auth vulnerabilities"]),
  x("performance-optimizer", "security", [], ["성능 최적화", "느린 곳을 찾아 고치고 번들을 줄여요"], ["パフォーマンス最適化", "遅い箇所を見つけて直し、バンドルを減らします"], ["Performance Optimizer", "Finds bottlenecks and trims bundle size"]),
  // 설계·정리
  x("planner", "design", [], ["기획자", "큰 기능·리팩터링을 단계별 계획으로 쪼개요"], ["プランナー", "大きな機能やリファクタリングを段階的な計画に分けます"], ["Planner", "Breaks big features and refactors into step-by-step plans"]),
  x("architect", "design", [], ["아키텍트", "시스템 설계·확장성·기술 결정을 도와요"], ["アーキテクト", "システム設計・拡張性・技術判断を手伝います"], ["Architect", "Helps with system design, scalability and technical decisions"]),
  x("code-architect", "design", [], ["기능 설계자", "기존 패턴을 보고 파일·인터페이스까지 설계도를 그려요"], ["機能設計", "既存パターンを見てファイルやインターフェースまで設計します"], ["Code Architect", "Designs features from existing patterns down to files and interfaces"]),
  x("code-explorer", "design", [], ["코드 탐색가", "실행 흐름·계층·의존성을 따라가 지도를 만들어요"], ["コード探索", "実行の流れ・層・依存関係をたどって地図にします"], ["Code Explorer", "Traces execution paths and maps layers and dependencies"]),
  x("code-simplifier", "design", [], ["코드 단순화", "동작은 그대로 두고 코드를 더 읽기 쉽게"], ["コード簡素化", "動作はそのままにコードを読みやすくします"], ["Code Simplifier", "Makes code clearer without changing behavior"]),
  x("refactor-cleaner", "design", TS, ["정리 담당", "안 쓰는 코드·중복을 찾아 지워요"], ["整理担当", "使われていないコードや重複を探して消します"], ["Refactor Cleaner", "Finds and removes dead code and duplicates"]),
  x("a11y-architect", "design", ["tsx", "jsx", "vue", "html", "swift", "kt"], ["접근성 설계", "WCAG 2.2 기준으로 화면·컴포넌트를 봐요"], ["アクセシビリティ設計", "WCAG 2.2に沿って画面とコンポーネントを見ます"], ["Accessibility Architect", "Designs and audits UI for WCAG 2.2"]),
  // 문서
  x("doc-updater", "docs", [], ["문서 갱신", "README·가이드·코드 지도를 최신으로 맞춰요"], ["ドキュメント更新", "README・ガイド・コードマップを最新にします"], ["Doc Updater", "Keeps READMEs, guides and code maps current"]),
  x("docs-lookup", "docs", [], ["문서 찾기", "라이브러리·API의 최신 사용법을 찾아 예시로 답해요"], ["ドキュメント検索", "ライブラリやAPIの最新の使い方を例付きで答えます"], ["Docs Lookup", "Finds current library and API docs with examples"]),
  // 비서·마케팅
  x("chief-of-staff", "assistant", [], ["비서실장", "메일·Slack 메시지를 분류하고 답장 초안을 써요"], ["チーフ・オブ・スタッフ", "メールやSlackを仕分けて返信の下書きを書きます"], ["Chief of Staff", "Triages email and Slack and drafts replies"]),
  x("marketing-agent", "assistant", [], ["마케터", "캠페인·포지셔닝·카피를 기획하고 써요"], ["マーケター", "キャンペーン・ポジショニング・コピーを企画して書きます"], ["Marketing Agent", "Plans campaigns, positioning and copy"]),
  x("seo-specialist", "assistant", ["html", "tsx", "jsx", "md", "mdx"], ["SEO 담당", "기술 SEO·메타·구조화 데이터를 점검해요"], ["SEO担当", "技術SEO・メタ・構造化データを点検します"], ["SEO Specialist", "Audits technical SEO, meta tags and structured data"]),
];

const BUILTIN: CatalogItem[] = CREW_ROLES.map((id) => ({ id, group: "team", langs: [], builtin: true }));

export const CATALOG: CatalogItem[] = [...BUILTIN, ...EXTERNAL];
export const catalogItem = (id: string) => CATALOG.find((c) => c.id === id);
