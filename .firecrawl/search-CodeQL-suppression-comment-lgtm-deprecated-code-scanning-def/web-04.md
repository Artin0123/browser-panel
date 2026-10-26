[Skip to last reply](https://forum.xwiki.org/t/replace-lgtm-by-codeql-analysis-on-github/11425/6) [Skip to top](https://forum.xwiki.org/t/replace-lgtm-by-codeql-analysis-on-github/11425/1)

[Skip to main content](https://forum.xwiki.org/t/replace-lgtm-by-codeql-analysis-on-github/11425#main-container)

Welcome to the XWiki user forum. Old messages can be seen in the [Mailing list archives](https://dev.xwiki.org/xwiki/bin/view/Community/Discuss#HMailingListArchives). Please mark topics you create [as Solved](https://meta.discourse.org/t/how-to-mark-a-topic-as-resolved/81793) ( [Unsolved topics](https://forum.xwiki.org/c/Discuss/l/latest?solved=no)) when you consider them solved!

# [Replace LGTM by CodeQL analysis on GitHub?](https://forum.xwiki.org/t/replace-lgtm-by-codeql-analysis-on-github/11425)

[Development](https://forum.xwiki.org/c/dev/13)

- [proposal](https://forum.xwiki.org/tag/proposal/6),
- [brainstorming](https://forum.xwiki.org/tag/brainstorming/128)

You have selected **0** posts.

[select all](https://forum.xwiki.org/t/replace-lgtm-by-codeql-analysis-on-github/11425)

[cancel selecting](https://forum.xwiki.org/t/replace-lgtm-by-codeql-analysis-on-github/11425)

1.2k
views
5
links


[![](https://forum.xwiki.org/user_avatar/forum.xwiki.org/vmassol/48/6_2.png)3](https://forum.xwiki.org/u/vmassol "vmassol")

[![](https://forum.xwiki.org/user_avatar/forum.xwiki.org/tmortagne/48/4930_2.png)](https://forum.xwiki.org/u/tmortagne "tmortagne")

[![](https://forum.xwiki.org/user_avatar/forum.xwiki.org/surli/48/2687_2.png)](https://forum.xwiki.org/u/surli "surli")

[![](https://forum.xwiki.org/user_avatar/forum.xwiki.org/michaelhamann/48/3813_2.png)](https://forum.xwiki.org/u/MichaelHamann "MichaelHamann")

[Nov 2022](https://forum.xwiki.org/t/replace-lgtm-by-codeql-analysis-on-github/11425/1 "Jump to the first post")

1 / 6


Nov 2022


[Sep 21](https://forum.xwiki.org/t/replace-lgtm-by-codeql-analysis-on-github/11425/6)

## post by vmassol on Nov 28, 2022

[![](https://forum.xwiki.org/user_avatar/forum.xwiki.org/vmassol/48/6_2.png)](https://forum.xwiki.org/u/vmassol)

[vmassol](https://forum.xwiki.org/u/vmassol)
XWiki Committer


[Nov 2022](https://forum.xwiki.org/t/replace-lgtm-by-codeql-analysis-on-github/11425 "Post date")

Hi Devs,

We’ve received a new PR ( [Add CodeQL workflow for GitHub code scanning by lgtm-com\[bot\] · Pull Request #1978 · xwiki/xwiki-platform · GitHub](https://github.com/xwiki/xwiki-platform/pull/1978)) to set up a GitHub Action workflow to set up GH code scanning using CodeQL analysis.

My understanding is that we would need to remove the configured LGTM GitHub app (on all 3 xwiki repos) and then configure “code scanning” on the 3 repos and use CodeQL. I guess we will need to check how to port our [xwiki-platform/.lgtm.yml at master · xwiki/xwiki-platform · GitHub](https://github.com/xwiki/xwiki-platform/blob/master/.lgtm.yml) (and remove it). The config for codeql scanning is at [Customizing your advanced setup for code scanning - GitHub Docs](https://docs.github.com/en/code-security/code-scanning/automatically-scanning-your-code-for-vulnerabilities-and-errors/configuring-code-scanning)

We need to decide if that’s what we want but it seems like a good idea to me and the way forward (since it’s LGTM that integrated with GitHub).

We could try to set it up and see what we get before removing anything related to LGTM.

WDYT?

Thanks

1.2k
views
5
links


[![](https://forum.xwiki.org/user_avatar/forum.xwiki.org/vmassol/48/6_2.png)3](https://forum.xwiki.org/u/vmassol "vmassol")

[![](https://forum.xwiki.org/user_avatar/forum.xwiki.org/tmortagne/48/4930_2.png)](https://forum.xwiki.org/u/tmortagne "tmortagne")

[![](https://forum.xwiki.org/user_avatar/forum.xwiki.org/surli/48/2687_2.png)](https://forum.xwiki.org/u/surli "surli")

[![](https://forum.xwiki.org/user_avatar/forum.xwiki.org/michaelhamann/48/3813_2.png)](https://forum.xwiki.org/u/MichaelHamann "MichaelHamann")

## post by MichaelHamann on Nov 28, 2022

## post by surli on Dec 1, 2022

## post by tmortagne on Dec 1, 2022

## post by vmassol on Dec 1, 2022

4 years later


## post by vmassol on Sep 21

Reply

### New & Unread Topics

| Topic | Replies | Views | Activity |
| --- | --- | --- | --- |
| [Organization-wide CONTRIBUTING.md for the xwiki GitHub org](https://forum.xwiki.org/t/organization-wide-contributing-md-for-the-xwiki-github-org/18992)<br>[Development](https://forum.xwiki.org/c/dev/13) <br>- [proposal](https://forum.xwiki.org/tag/proposal/6) | [0](https://forum.xwiki.org/t/organization-wide-contributing-md-for-the-xwiki-github-org/18992/1) | 18 | [9d](https://forum.xwiki.org/t/organization-wide-contributing-md-for-the-xwiki-github-org/18992/1) |
| [DocGuide: no parent repetition in a page name, even for the object of the action](https://forum.xwiki.org/t/docguide-no-parent-repetition-in-a-page-name-even-for-the-object-of-the-action/18976)<br>[Development](https://forum.xwiki.org/c/dev/13) <br>- [proposal](https://forum.xwiki.org/tag/proposal/6),<br>- [documentation](https://forum.xwiki.org/tag/documentation/147) | [1](https://forum.xwiki.org/t/docguide-no-parent-repetition-in-a-page-name-even-for-the-object-of-the-action/18976/1) | 50 | [12d](https://forum.xwiki.org/t/docguide-no-parent-repetition-in-a-page-name-even-for-the-object-of-the-action/18976/2) |
| [Brainstorm: UX Guidelines for XWiki and Cristal](https://forum.xwiki.org/t/brainstorm-ux-guidelines-for-xwiki-and-cristal/18339)<br>[Development](https://forum.xwiki.org/c/dev/13) <br>- [brainstorming](https://forum.xwiki.org/tag/brainstorming/128),<br>- [usability](https://forum.xwiki.org/tag/usability/118) | [6](https://forum.xwiki.org/t/brainstorm-ux-guidelines-for-xwiki-and-cristal/18339/1) | 183 | [Sep 15](https://forum.xwiki.org/t/brainstorm-ux-guidelines-for-xwiki-and-cristal/18339/7) |
| [Change the default fallback for \`XWIKI\_LLM\_WORK\` in the XWiki LLM plugin](https://forum.xwiki.org/t/change-the-default-fallback-for-xwiki-llm-work-in-the-xwiki-llm-plugin/18804)<br>[Development](https://forum.xwiki.org/c/dev/13) <br>- [brainstorming](https://forum.xwiki.org/tag/brainstorming/128) | [1](https://forum.xwiki.org/t/change-the-default-fallback-for-xwiki-llm-work-in-the-xwiki-llm-plugin/18804/1) | 69 | [Aug 31](https://forum.xwiki.org/t/change-the-default-fallback-for-xwiki-llm-work-in-the-xwiki-llm-plugin/18804/2) |
| [Generating unique entity references that honor the page naming strategy](https://forum.xwiki.org/t/generating-unique-entity-references-that-honor-the-page-naming-strategy/19001)<br>[Development](https://forum.xwiki.org/c/dev/13) <br>- [brainstorming](https://forum.xwiki.org/tag/brainstorming/128) | [0](https://forum.xwiki.org/t/generating-unique-entity-references-that-honor-the-page-naming-strategy/19001/1) | 24 | [6d](https://forum.xwiki.org/t/generating-unique-entity-references-that-honor-the-page-naming-strategy/19001/1) |

Topic list, column headers with buttons are sortable.

### Want to read more? Browse other topics in [Development](https://forum.xwiki.org/c/dev/13) or [view latest topics](https://forum.xwiki.org/latest).

[Powered by Discourse](https://discourse.org/powered-by)