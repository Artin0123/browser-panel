[Back to changelog](https://github.blog/changelog/)

On December 13, 2023, we released CodeQL Action v3, which runs on the Node.js 20 runtime. CodeQL Action v2 will be deprecated at the same time as GHES 3.11, which is currently scheduled for December 2024.

## [How does this affect me?](https://github.blog/changelog/2024-01-11-code-scanning-deprecation-of-codeql-action-v2/\#how-does-this-affect-me)

### [Default setup](https://github.blog/changelog/2024-01-11-code-scanning-deprecation-of-codeql-action-v2/\#default-setup)

Users of [code scanning default setup](https://docs.github.com/en/code-security/code-scanning/enabling-code-scanning/configuring-default-setup-for-code-scanning) do not need to take any action in order to automatically move to CodeQL Action v3.

### [Advanced setup](https://github.blog/changelog/2024-01-11-code-scanning-deprecation-of-codeql-action-v2/\#advanced-setup)

Users of [code scanning advanced setup](https://docs.github.com/en/code-security/code-scanning/creating-an-advanced-setup-for-code-scanning/configuring-advanced-setup-for-code-scanning) need to change their workflow files in order to start using CodeQL Action v3.

#### [Users of GitHub.com and GitHub Enterprise Server 3.12 (and newer)](https://github.blog/changelog/2024-01-11-code-scanning-deprecation-of-codeql-action-v2/\#users-of-githubcom-and-github-enterprise-server-312-and-newer)

All users of GitHub code scanning (which by default uses the CodeQL analysis engine) on GitHub Actions on the following platforms should update their workflow files:

- GitHub.com (including open source repositories, users of GitHub Teams and GitHub Enterprise Cloud)
- GitHub Enterprise Server (GHES) 3.12 (and newer)

Users of the above-mentioned platforms should update their CodeQL workflow file(s) to refer to the new `v3` version of the CodeQL Action. Note that the upcoming release of GitHub Enterprise Server 3.12 will ship with `v3` of the CodeQL Action included.

#### [Users of GitHub Enterprise Server 3.11](https://github.blog/changelog/2024-01-11-code-scanning-deprecation-of-codeql-action-v2/\#users-of-github-enterprise-server-311)

While GHES 3.11 _does_ support Node 20 Actions, it does _not_ ship with CodeQL Action v3. Users who want to migrate to `v3` on GHES 3.11 should request that their system administrator enables [GitHub Connect](https://docs.github.com/en/enterprise-server@3.11/admin/github-actions/managing-access-to-actions-from-githubcom/using-the-latest-version-of-the-official-bundled-actions#using-github-connect-to-access-the-latest-actions) to download `v3` onto GHES before updating their workflow files.

#### [Users of GitHub Enterprise Server 3.10 (and older)](https://github.blog/changelog/2024-01-11-code-scanning-deprecation-of-codeql-action-v2/\#users-of-github-enterprise-server-310-and-older)

GHES 3.10 (and earlier) does not support running Actions using the Node 20 runtime and is therefore unable to run CodeQL Action v3. Please upgrade to a newer version of GitHub Enterprise Server prior to changing your CodeQL Action workflow files.

## [Exactly what do I need to change?](https://github.blog/changelog/2024-01-11-code-scanning-deprecation-of-codeql-action-v2/\#exactly-what-do-i-need-to-change)

To upgrade to CodeQL Action v3, open your CodeQL workflow file(s) in the `.github` directory of your repository and look for references to:

- `github/codeql-action/init@v2`
- `github/codeql-action/autobuild@v2`
- `github/codeql-action/analyze@v2`
- `github/codeql-action/upload-sarif@v2`

These entries need to be replaced with their `v3` equivalents:

- `github/codeql-action/init@v3`
- `github/codeql-action/autobuild@v3`
- `github/codeql-action/analyze@v3`
- `github/codeql-action/upload-sarif@v3`

## [Can I use Dependabot to help me with this upgrade?](https://github.blog/changelog/2024-01-11-code-scanning-deprecation-of-codeql-action-v2/\#can-i-use-dependabot-to-help-me-with-this-upgrade)

Yes, you can! For more details on how to configure Dependabot to automatically upgrade your Actions dependencies, [please see this page](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/keeping-your-actions-up-to-date-with-dependabot).

## [What happens in December 2024?](https://github.blog/changelog/2024-01-11-code-scanning-deprecation-of-codeql-action-v2/\#what-happens-in-december-2024)

In December 2024, CodeQL Action v2 will be officially deprecated (at the same time as the GHES 3.11 deprecation). At that point, no new updates will be made to CodeQL Action v2, which means that new CodeQL analysis capabilities will only be available to users of CodeQL Action v3. We will keep a close eye on the migration progress across GitHub. If many workflow files still refer to CodeQL Action v2, we might consider scheduling one or more brownout moments later in the year to increase awareness.

## Related Posts

### Oct.23Improvement

[Public monitoring adds triage, validity, API, and webhooks](https://github.blog/changelog/2026-10-23-public-monitoring-adds-triage-validity-api-and-webhooks)

[application security](https://github.blog/changelog/2026/?label=application-security)

### Oct.22Improvement

[Public monitoring now available with data residency](https://github.blog/changelog/2026-10-22-public-monitoring-now-available-with-data-residency)

[application security](https://github.blog/changelog/2026/?label=application-security)

### Oct.21Release

[GitHub CLI: Opt in to expiring, auto-refreshing OAuth tokens](https://github.blog/changelog/2026-10-21-github-cli-opt-in-to-expiring-auto-refreshing-oauth-tokens)

[application security](https://github.blog/changelog/2026/?label=application-security) [client apps](https://github.blog/changelog/2026/?label=client-apps)...
+1

### Oct.20Improvement

[Updates to GitHub secret scanning](https://github.blog/changelog/2026-10-20-updates-to-github-secret-scanning)

[application security](https://github.blog/changelog/2026/?label=application-security)

### Oct.19Retired

[CodeQL changes for macOS 27, Xcode 27, and Swift 6.4](https://github.blog/changelog/2026-10-19-codeql-changes-for-macos-27-xcode-27-and-swift-6-4)

[application security](https://github.blog/changelog/2026/?label=application-security)

### Oct.15Improvement

[Download GitHub Code Quality license usage as a CSV](https://github.blog/changelog/2026-10-15-download-github-code-quality-license-usage-as-a-csv)

[account management](https://github.blog/changelog/2026/?label=account-management) [application security](https://github.blog/changelog/2026/?label=application-security)...
+1

### Oct.15Release

[AI Scan for pull requests generally available](https://github.blog/changelog/2026-10-15-ai-scan-for-pull-requests-generally-available)

[application security](https://github.blog/changelog/2026/?label=application-security) [universe26](https://github.blog/changelog/2026/?label=universe26)...
+1

### Oct.15Release

[Agentic autofix for code scanning alerts general availability](https://github.blog/changelog/2026-10-15-agentic-autofix-for-code-scanning-alerts-general-availability)

[application security](https://github.blog/changelog/2026/?label=application-security) [copilot](https://github.blog/changelog/2026/?label=copilot) [universe26](https://github.blog/changelog/2026/?label=universe26)...
+2

### Oct.13Improvement

[Audit GitHub Code Quality finding dismissals and reopenings](https://github.blog/changelog/2026-10-13-audit-github-code-quality-finding-dismissals-and-reopenings)

[application security](https://github.blog/changelog/2026/?label=application-security) [platform governance](https://github.blog/changelog/2026/?label=platform-governance)...
+1

## Subscribe to our developer newsletter

Discover tips, technical guides, and best practices in our biweekly newsletter just for devs.

Enter your email\*
Subscribe

By submitting, I agree to let GitHub and its affiliates use my information for personalized communications, targeted advertising, and campaign effectiveness. See the [GitHub Privacy Statement](https://github.com/site/privacy) for more details.

[Back to top](https://github.blog/changelog/2024-01-11-code-scanning-deprecation-of-codeql-action-v2/#start-of-content)

×