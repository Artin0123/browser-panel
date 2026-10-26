- [CodeQL](https://codeql.github.com/docs/contents/) »
- [CodeQL overview](https://codeql.github.com/docs/codeql-overview/) »
- [CodeQL change logs](https://codeql.github.com/docs/codeql-overview/codeql-changelog/) »

# CodeQL 2.12.0 (2023-01-10) [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#codeql-2-12-0-2023-01-10 "Link to this heading")

This is an overview of changes in the CodeQL CLI and relevant CodeQL query and library packs. For additional updates on changes to the CodeQL code scanning experience, check out the [code scanning section on the GitHub blog](https://github.blog/tag/code-scanning/), [relevant GitHub Changelog updates](https://github.blog/changelog/label/application-security/), [changes in the CodeQL extension for Visual Studio Code](https://marketplace.visualstudio.com/items/GitHub.vscode-codeql/changelog), and the [CodeQL Action changelog](https://github.com/github/codeql-action/blob/main/CHANGELOG.md).

## Security Coverage [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#security-coverage "Link to this heading")

CodeQL 2.12.0 runs a total of 365 security queries when configured with the Default suite (covering 150 CWE). The Extended suite enables an additional 116 queries (covering 32 more CWE). 8 security queries have been added with this release.

## CodeQL CLI [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#codeql-cli "Link to this heading")

### Breaking Changes [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#breaking-changes "Link to this heading")

- The `--[no-]count-lines` option to `codeql database create` and related commands that was deprecated in 2.11.1 has been removed. Users of this option should instead pass
`--[no-]calculate-baseline`.


### Bug Fixes [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#bug-fixes "Link to this heading")

- Fixed a bug where the `codeql pack install` command would fail if a [CodeQL configuration file](https://codeql.github.com/docs/codeql-cli/specifying-command-options-in-a-codeql-configuration-file/#using-a-codeql-configuration-file) is used and the `--additional-packs` option is specified.


### New Features [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#new-features "Link to this heading")

- Query packs created by `codeql pack create`, `codeql pack bundle`, and `codeql pack release` now contain precompiled queries in a new format that aims to be compatible with future (and, to a certain extent, past) releases of the CodeQL CLI. Previously the precompiled queries were in a format specific to each CLI release, and all other releases would need to re-compile queries.

Published packs contain precompiled queries in files with a `.qlx` extension located next to each query’s `.ql` source file. In case of differences between the `.ql` and `.qlx` files, the `.qlx` file takes priority when evaluating queries from the command line, so if you need to modify a published pack, be sure to delete the `.qlx` files first.

A new `--precompile` flag to `codeql query compile` can be used to construct `*.qlx` file explicitly, but in all usual cases it should be enough to rely on `codeql pack create` doing the right thing.

- The `codeql database init` command now accepts a PAT that allows you to download queries from external, private repositories when using the `--codescanning-config <config-file>` option. For example, you can specify the following queries block in the config file, which will checkout the main branch of the `codeql-test/my-private-repository` repository and evaluate any queries found in that repository:





```
queries:
  - codeql-test/my-private-repository@main
```

If the repository is private, you can add a `--external-repository-token-stdin` option and supply a PAT with appropriate permissions via standard input. For more information on queries and external repositories in Code Scanning, see [Using queries in QL packs](https://docs.github.com/en/code-security/code-scanning/automatically-scanning-your-code-for-vulnerabilities-and-errors/configuring-code-scanning#using-queries-in-ql-packs).

- The baseline information produced by `codeql database init` and
  `codeql database create` now accounts for
  [`paths` and `paths-ignore` configuration](https://docs.github.com/en/code-security/code-scanning/automatically-scanning-your-code-for-vulnerabilities-and-errors/configuring-code-scanning#specifying-directories-to-scan).

- In the VS Code extension, recursive calls will be marked with inlay hints. These can be disabled with the global inlay hints setting
  (`editor.inlayHints.enabled`). If you just want to disable them for codeql the settings can be scoped to just codeql files (language id is `ql`).
  See [Language Specific Editor Settings](https://code.visualstudio.com/docs/getstarted/settings#_language-specific-editor-settings) in the VS Code documentation for more information.

- The CLI now gives a more helpful error message when asked to run queries on a database that has not been finalized.


## Query Packs [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#query-packs "Link to this heading")

### Bug Fixes [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id1 "Link to this heading")

#### C\# [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#c "Link to this heading")

- Fixes a bug where the Owin.qll framework library will look for “URI” instead of “Uri” in the OwinRequest class.


### Minor Analysis Improvements [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#minor-analysis-improvements "Link to this heading")

#### C/C++ [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#c-c "Link to this heading")

- The `AlertSuppression.ql` query has been updated to support the new `// codeql[query-id]` supression comments. These comments can be used to suppress an alert and must be placed on a blank line before the alert. In addition the legacy `// lgtm` and `// lgtm[query-id]` comments can now also be placed on the line before an alert.

- The `cpp/missing-check-scanf` query no longer reports the free’ing of `scanf` output variables as potential reads.


#### C\# [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id2 "Link to this heading")

- The `AlertSuppression.ql` query has been updated to support the new `// codeql[query-id]` supression comments. These comments can be used to suppress an alert and must be placed on a blank line before the alert. In addition the legacy `// lgtm` and `// lgtm[query-id]` comments can now also be placed on the line before an alert.

- The extensible predicates for Models as Data have been renamed (the `ext` prefix has been removed). As an example, `extSummaryModel` has been renamed to `summaryModel`.


#### Golang [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#golang "Link to this heading")

- The `AlertSuppression.ql` query has been updated to support the new `// codeql[query-id]` supression comments. These comments can be used to suppress an alert and must be placed on a blank line before the alert. In addition the legacy `// lgtm` and `// lgtm[query-id]` comments can now also be placed on the line before an alert.


#### Java/Kotlin [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#java-kotlin "Link to this heading")

- The `AlertSuppression.ql` query has been updated to support the new `// codeql[query-id]` supression comments. These comments can be used to suppress an alert and must be placed on a blank line before the alert. In addition the legacy `// lgtm` and `// lgtm[query-id]` comments can now also be placed on the line before an alert.

- The extensible predicates for Models as Data have been renamed (the `ext` prefix has been removed). As an example, `extSummaryModel` has been renamed to `summaryModel`.

- The query `java/misnamed-type` is now enabled for Kotlin.

- The query `java/non-serializable-field` is now enabled for Kotlin.

- Fixed an issue in the query `java/android/implicit-pendingintents` by which an implicit Pending Intent marked as immutable was not correctly recognized as such.

- The query `java/maven/non-https-url` no longer alerts about disabled repositories.


#### JavaScript/TypeScript [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#javascript-typescript "Link to this heading")

- The `AlertSuppression.ql` query has been updated to support the new `// codeql[query-id]` supression comments. These comments can be used to suppress an alert and must be placed on a blank line before the alert. In addition the legacy `// lgtm` and `// lgtm[query-id]` comments can now also be placed on the line before an alert.


#### Python [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#python "Link to this heading")

- The `analysis/AlertSuppression.ql` query has moved to the root folder. Users that refer to this query by path should update their configurations. The query has been updated to support the new `# codeql[query-id]` supression comments. These comments can be used to suppress an alert and must be placed on a blank line before the alert. In addition the legacy `# lgtm` and `# lgtm[query-id]` comments can now also be placed on the line before an alert.

- Bumped the minimum keysize we consider secure for elliptic curve cryptography from 224 to 256 bits, following current best practices. This might effect results from the _Use of weak cryptographic key_ (`py/weak-crypto-key`) query.

- Added modeling of `getpass.getpass` as a source of passwords, which will be an additional source for `py/clear-text-logging-sensitive-data`, `py/clear-text-storage-sensitive-data`, and `py/weak-sensitive-data-hashing`.


#### Ruby [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#ruby "Link to this heading")

- The `AlertSuppression.ql` query has been updated to support the new `# codeql[query-id]` supression comments. These comments can be used to suppress an alert and must be placed on a blank line before the alert. In addition the legacy `# lgtm` and `# lgtm[query-id]` comments can now also be placed on the line before an alert.

- Extended the `rb/kernel-open` query with following sinks: `IO.write`, `IO.binread`, `IO.binwrite`, `IO.foreach`, `IO.readlines`, and `URI.open`.


### New Queries [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#new-queries "Link to this heading")

#### C\# [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id3 "Link to this heading")

- Added a new query, `csharp/telemetry/supported-external-api`, to detect supported 3rd party APIs used in a codebase.


#### Java/Kotlin [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id4 "Link to this heading")

- Added a new query, `java/summary/generated-vs-manual-coverage`, to expose metrics for the number of API endpoints covered by generated versus manual MaD models.

- Added a new query, `java/telemetry/supported-external-api`, to detect supported 3rd party APIs used in a codebase.

- Added a new query, `java/android/missing-certificate-pinning`, to find network calls where certificate pinning is not implemented.

- Added a new query, `java/android-webview-addjavascriptinterface`, to detect the use of `addJavascriptInterface`, which can lead to cross-site scripting.

- Added a new query, `java/android-websettings-file-access`, to detect configurations that enable file system access in Android WebViews.

- Added a new query, `java/android-websettings-javascript-enabled`, to detect if JavaScript execution is enabled in an Android WebView.

- The query `java/regex-injection` has been promoted from experimental to the main query pack. Its results will now appear by default. This query was originally [submitted as an experimental query by @edvraa](https://github.com/github/codeql/pull/5704).


#### Ruby [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id5 "Link to this heading")

- Added a new query, `rb/stack-trace-exposure`, to detect exposure of stack-traces to users via HTTP responses.


## Language Libraries [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#language-libraries "Link to this heading")

### Bug Fixes [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id6 "Link to this heading")

#### Golang [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id7 "Link to this heading")

- Fixed an issue in the taint tracking analysis where implicit reads were not allowed by default in sinks or additional taint steps that used flow states.


#### Java/Kotlin [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id8 "Link to this heading")

- We now correctly handle empty block comments, like `/**/`. Previously these could be mistaken for Javadoc comments and led to attribution of Javadoc tags to the wrong declaration.


#### Python [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id9 "Link to this heading")

- `except*` is now supported.

- The result of `Try.getAHandler` and `Try.getHandler(<index>)` is no longer of type `ExceptStmt`, as handlers may also be `ExceptGroupStmt`s (After Python 3.11 introduced PEP 654). Instead, it is of the new type `ExceptionHandler` of which `ExceptStmt` and `ExceptGroupStmt` are subtypes. To support selecting only one type of handler, `Try.getANormalHandler` and `Try.getAGroupHandler` have been added. Existing uses of `Try.getAHandler` for which it is important to select only normal handlers, will need to be updated to `Try.getANormalHandler`.


### Breaking Changes [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id10 "Link to this heading")

#### C/C++ [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id11 "Link to this heading")

- The predicates in the `MustFlow::Configuration` class used by the `MustFlow` library (`semmle.code.cpp.ir.dataflow.MustFlow`) have changed to be defined directly in terms of the C++ IR instead of IR dataflow nodes.


#### Golang [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id12 "Link to this heading")

- The signature of `allowImplicitRead` on `DataFlow::Configuration` and `TaintTracking::Configuration` has changed from `allowImplicitRead(DataFlow::Node node, DataFlow::Content c)` to `allowImplicitRead(DataFlow::Node node, DataFlow::ContentSet c)`.


### Major Analysis Improvements [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#major-analysis-improvements "Link to this heading")

#### Python [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id13 "Link to this heading")

- The _PAM authorization bypass due to incorrect usage_ (`py/pam-auth-bypass`) query has been converted to a taint-tracking query, resulting in significantly fewer false positives.


#### Ruby [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id14 "Link to this heading")

- Flow through `initialize` constructors is now taken into account. For example, in





  ```
  class C
    def initialize(x)
      @field = x
    end
  end

  C.new(y)
  ```





  there will be flow from `y` to the field `@field` on the constructed `C` object.


### Minor Analysis Improvements [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id15 "Link to this heading")

#### C/C++ [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id16 "Link to this heading")

- The `ArgvSource` flow source now uses the second parameter of `main` as its source instead of the uses of this parameter.

- The `ArgvSource` flow source has been generalized to handle cases where the argument vector of `main` is not named `argv`.

- The `getaddrinfo` function is now recognized as a flow source.

- The `secure_getenv` and `_wgetenv` functions are now recognized as local flow sources.

- The `scanf` and `fscanf` functions and their variants are now recognized as flow sources.

- Deleted the deprecated `getName` and `getShortName` predicates from the `Folder` class.


#### C\# [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id17 "Link to this heading")

- C# 11: Added support for list- and slice patterns in the extractor.

- Deleted the deprecated `getNameWithoutBrackets` predicate from the `ValueOrRefType` class in `Type.qll`.

- `Element::hasQualifiedName/1` has been deprecated. Use `hasQualifiedName/2` or `hasQualifiedName/3` instead.

- Added TCP/UDP sockets as taint sources.


#### Golang [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id18 "Link to this heading")

- The predicate `getNumParameter` on `FuncTypeExpr` has been changed to actually give the number of parameters. It previously gave the number of parameter declarations. `getNumParameterDecl` has been introduced to preserve this functionality.

- The definition of `mayHaveSideEffects` for `ReturnStmt` was incorrect when more than one expression was being returned. Such return statements were effectively considered to never have side effects. This has now been fixed. In rare circumstances `globalValueNumber` may have incorrectly treated two values as the same when they were in fact distinct.

- Queries that care about SQL, such as `go/sql-injection`, now recognise SQL-consuming functions belonging to the `gorqlite` and `GoFrame` packages.

- `rsync` has been added to the list of commands which may evaluate its parameters as a shell command.


#### Java/Kotlin [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id19 "Link to this heading")

- Added more dataflow models for frequently-used JDK APIs.

- The extraction of Kotlin extension methods has been improved when default parameter values are present. The dispatch and extension receiver parameters are extracted in the correct order. The `ExtensionMethod::getExtensionReceiverParameterIndex` predicate has been introduced to facilitate getting the correct extension parameter index.

- The query `java/insecure-cookie` now uses global dataflow to track secure cookies being set to the HTTP response object.

- The library `PathSanitizer.qll` has been improved to detect more path validation patterns in Kotlin.

- Models as Data models for Java are defined as data extensions instead of being inlined in the code. New models should be added in the `lib/ext` folder.

- Added a taint model for the method `java.nio.file.Path.getParent`.

- Fixed a problem in the taint model for the method `java.nio.file.Paths.get`.

- Deleted the deprecated `LocalClassDeclStmtNode` and `LocalClassDeclStmt` classes from `PrintAst.qll` and `Statement.qll` respectively.

- Deleted the deprecated `getLocalClass` predicate from `LocalTypeDeclStmt`, and the deprecated `getLocalClassDeclStmt` predicate from `LocalClassOrInterface`.

- Added support for Android Manifest `<activity-aliases>` elements in data flow sources.


#### JavaScript/TypeScript [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id20 "Link to this heading")

- Deleted the deprecated `Instance` class from the `Vue` module.

- Deleted the deprecated `VHtmlSourceWrite` class from `DomBasedXssQuery.qll`.

- Deleted all the deprecated `[QueryName].qll` files from the `javascript/ql/lib/semmle/javascript/security/dataflow` folder, use the corresponding `[QueryName]Query.qll` files instead.

- The ReDoS libraries in `semmle.code.javascript.security.regexp` has been moved to a shared pack inside the `shared/` folder, and the previous location has been deprecated.


#### Python [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id21 "Link to this heading")

- Added `subprocess.getoutput` and `subprocess.getoutputstatus` as new command injection sinks for the StdLib.

- The data-flow library has been rewritten to no longer rely on the points-to analysis in order to resolve references to modules. Improvements in the module resolution can lead to more results.

- Deleted the deprecated `importNode` predicate from the `DataFlowUtil.qll` file.

- Deleted the deprecated features from `PEP249.qll` that were not inside the `PEP249` module.

- Deleted the deprecated `werkzeug` from the `Werkzeug` module in `Werkzeug.qll`.

- Deleted the deprecated `methodResult` predicate from `PEP249::Cursor`.


#### Ruby [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id22 "Link to this heading")

- Calls to `Kernel.load`, `Kernel.require`, `Kernel.autoload` are now modeled as sinks for path injection.

- Calls to `mail` and `inbound_mail` in `ActionMailbox` controllers are now considered sources of remote input.

- Calls to `GlobalID::Locator.locate` and its variants are now recognized as instances of `OrmInstantiation`.

- Data flow through the `ActiveSupport` extensions `Enumerable#index_with`, `Enumerable#pick`, `Enumerable#pluck` and `Enumerable#sole` are now modeled.

- When resolving a method call, the analysis now also searches in sub-classes of the receiver’s type.

- Taint flow is now tracked through many common JSON parsing and generation methods.

- The ReDoS libraries in `codeql.ruby.security.regexp` has been moved to a shared pack inside the `shared/` folder, and the previous location has been deprecated.

- String literals and arrays of string literals in case expression patterns are now recognised as barrier guards.


### Deprecated APIs [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#deprecated-apis "Link to this heading")

#### C/C++ [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id23 "Link to this heading")

- Deprecated `semmle.code.cpp.ir.dataflow.DefaultTaintTracking`. Use `semmle.code.cpp.ir.dataflow.TaintTracking`.

- Deprecated `semmle.code.cpp.security.TaintTrackingImpl`. Use `semmle.code.cpp.ir.dataflow.TaintTracking`.

- Deprecated `semmle.code.cpp.valuenumbering.GlobalValueNumberingImpl`. Use `semmle.code.cpp.valuenumbering.GlobalValueNumbering`, which exposes the same API.


#### Golang [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id24 "Link to this heading")

- The `BarrierGuard` class has been deprecated. Such barriers and sanitizers can now instead be created using the new `BarrierGuard` parameterized module.


### New Features [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id25 "Link to this heading")

#### JavaScript/TypeScript [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id26 "Link to this heading")

- Improved support for [Restify](https://restify.com/) framework, leading to more results when scanning applications developed with this framework.

- Added support for the [Spife](https://github.com/npm/spife) framework.


## Shared Libraries [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#shared-libraries "Link to this heading")

### Minor Analysis Improvements [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#id27 "Link to this heading")

#### Type Trackers [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#type-trackers "Link to this heading")

- Initial release. Includes a parameterized module implementing type-trackers.


#### QL Detective Tutorial [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#ql-detective-tutorial "Link to this heading")

- Initial release. Contains the library for the CodeQL detective tutorials, helping new users learn to write CodeQL queries.


#### Utility Classes [¶](https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.12.0/\#utility-classes "Link to this heading")

- Initial release. Includes common utility classes and modules: Unit, Boolean, and Option.


- [GitHub on Twitter](https://twitter.com/github "GitHub on Twitter")
- [GitHub on Facebook](https://www.facebook.com/GitHub "GitHub on Facebook")
- [GitHub on YouTube](https://www.youtube.com/github "GitHub on YouTube")
- [GitHub on Linkedin](https://www.linkedin.com/company/github "GitHub on Linkedin")
- [GitHub's organization](https://github.com/github "GitHub's organization")

- ©
2026 GitHub, Inc.
- [Terms](https://docs.github.com/site-policy/github-terms/github-terms-of-service)
- [Privacy](https://docs.github.com/site-policy/privacy-policies/github-privacy-statement)