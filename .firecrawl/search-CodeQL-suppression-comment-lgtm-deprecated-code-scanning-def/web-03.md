[Skip to content](https://github.com/github/codeql/discussions/10940#start-of-content)

You signed in with another tab or window. [Reload](https://github.com/github/codeql/discussions/10940) to refresh your session.You signed out in another tab or window. [Reload](https://github.com/github/codeql/discussions/10940) to refresh your session.You switched accounts on another tab or window. [Reload](https://github.com/github/codeql/discussions/10940) to refresh your session.Dismiss alert

{{ message }}

# Suppressing results when running with the CodeQL CLI  \#10940

[NateD-MSFT](https://github.com/NateD-MSFT)

started this conversation in
[Ideas](https://github.com/github/codeql/discussions/categories/ideas)

[Suppressing results when running with the CodeQL CLI](https://github.com/github/codeql/discussions/10940#top)#10940

[![@NateD-MSFT](https://avatars.githubusercontent.com/u/34494373?s=40&v=4)\\
NateD-MSFT](https://github.com/NateD-MSFT)

on Oct 21, 2022Oct 21, 2022·
1 comments
·
7 replies


[Return to top](https://github.com/github/codeql/discussions/10940#top)

Discussion options

### Uh oh!

There was an error while loading. [Please reload this page](https://github.com/github/codeql/discussions/10940).

# {{title}}

Quote reply

## [![](https://avatars.githubusercontent.com/u/34494373?s=64&v=4)\ NateD-MSFT](https://github.com/NateD-MSFT) [on Oct 21, 2022Oct 21, 2022](https://github.com/github/codeql/discussions/10940\#discussion-4494258)

|     |
| --- |
| Hi there,<br>I'm a dev over in the Windows group at Microsoft. We've been building up a repo of CodeQL queries related to or useful for driver development ( [https://github.com/microsoft/Windows-Driver-Developer-Supplemental-Tools](https://github.com/microsoft/Windows-Driver-Developer-Supplemental-Tools)) and have been evangelizing the tool to partners.<br>One aspect we've been running into issues with is that, as is the case with any static analysis tool, CodeQL has queries that may provide useful results but may also cause false positives. With our other tools, it's possible for driver developers to use pragmas or comments to suppress specific warnings in their code when they know it's a false positive.<br>I've done some research, but to the best of my knowledge there is no such mechanism available for CodeQL at the CLI level. Is this correct? If so, I'd love to know the general thoughts on suppression going forward and if there is any plan to add this feature at the CLI/code level. (I understand LGTM previously had suppression comments that worked for LGTM, but LGTM is going away - and regardless, these comments wouldn't help devs running the CLI.) |

1You must be logged in to vote

All reactions

## Replies:   1 comment  ·  7 replies

Comment options

### Uh oh!

There was an error while loading. [Please reload this page](https://github.com/github/codeql/discussions/10940).

# {{title}}

Quote reply

### [![](https://avatars.githubusercontent.com/u/10979737?s=64&v=4)\ aibaars](https://github.com/aibaars) [on Oct 22, 2022Oct 22, 2022](https://github.com/github/codeql/discussions/10940\#discussioncomment-3939274)

|     |     |
| --- | --- |
| Hi [@NateD-MSFT](https://github.com/NateD-MSFT) , the CodeQL CLI does support suppression annotations. It works by running a query with `@kind alert-suppression` as part of the analysis. These queries looks for suppression annotation and return the code-ranges that are affected by such an annotation. When these alert-suppression queries are run together with a suite of alert queries then CodeQL CLI will mark any alerts that are affect by a suppression annotation with a `suppressions.kind: ["InSource"]` marker in the SARIF output.

Here is an example of an alert suppression query:

[codeql/go/ql/src/AlertSuppression.ql](https://github.com/github/codeql/blob/e5663574feaf6d3910ea715b4204851d7a005a26/go/ql/src/AlertSuppression.ql#L4)

Line 4
in
[e566357](https://github.com/github/codeql/commit/e5663574feaf6d3910ea715b4204851d7a005a26)

|     |     |
| --- | --- |
|  | \\* @kind alert-suppression |

. |

1You must be logged in to vote

All reactions

7 replies


Show 2 previous replies

[![@aibaars](https://avatars.githubusercontent.com/u/10979737?s=60&v=4)](https://github.com/aibaars)

Comment options

### Uh oh!

There was an error while loading. [Please reload this page](https://github.com/github/codeql/discussions/10940).

# {{title}}

Quote reply

#### [aibaars](https://github.com/aibaars) [on Oct 28, 2022Oct 28, 2022](https://github.com/github/codeql/discussions/10940\#discussioncomment-3997976)

|     |
| --- |
| Alert suppressions are defined by special QL queries with `@kind alert-suppression` . You can define a custom `alert-suppression` query that finds the annotations you need. |

All reactions

[![@NateD-MSFT](https://avatars.githubusercontent.com/u/34494373?s=60&v=4)](https://github.com/NateD-MSFT)

Comment options

### Uh oh!

There was an error while loading. [Please reload this page](https://github.com/github/codeql/discussions/10940).

# {{title}}

Quote reply

#### [NateD-MSFT](https://github.com/NateD-MSFT) [on Oct 28, 2022Oct 28, 2022](https://github.com/github/codeql/discussions/10940\#discussioncomment-3998059)   Author

|     |
| --- |
| Okay - is there documentation on this style of query? From what I can tell, the existing queries select, for example, "lgtm\[cpp/windows/drivers/queries/extended-deprecated-apis\]" as part of the result they return, which suggests to me that CodeQL internally takes that text and strips it to get the ID "cpp/windows/drivers/queries/extended-deprecated-apis" and matches that to suppress any violations with that query ID.<br>For our purposes, we would like to have, for example, a query where the ID in the CodeQL query might be "cpp/windows/drivers/queries/extended-deprecated-apis" but we could still suppress it with existing VS-style suppressions, which would use a numerical ID (1234) instead of the new CodeQL text ID. |

All reactions

[![@aibaars](https://avatars.githubusercontent.com/u/10979737?s=60&v=4)](https://github.com/aibaars)

Comment options

### Uh oh!

There was an error while loading. [Please reload this page](https://github.com/github/codeql/discussions/10940).

# {{title}}

Quote reply

#### [aibaars](https://github.com/aibaars) [on Oct 29, 2022Oct 29, 2022](https://github.com/github/codeql/discussions/10940\#discussioncomment-4002567)

|     |
| --- |
| I don't think there is any documentation for that type of query. The query needs to have `@kind alert-suppression` and a `select` with 4 columns:<br>1. the annotation itself , type `Location` or any element with a `getLocation/hasLocation` predicate.<br>2. the text of the annotation, type `string`<br>3. a suppression "instruction" of the form `lgtm` or `lgtm[queryID]`, type `string`<br>4. the target area (or target AST element) affected by the suppression, type `Location` or any element with a `getLocation/hasLocation` predicate. |

All reactions

[![@NateD-MSFT](https://avatars.githubusercontent.com/u/34494373?s=60&v=4)](https://github.com/NateD-MSFT)

Comment options

### Uh oh!

There was an error while loading. [Please reload this page](https://github.com/github/codeql/discussions/10940).

# {{title}}

Quote reply

#### [NateD-MSFT](https://github.com/NateD-MSFT) [on Oct 31, 2022Oct 31, 2022](https://github.com/github/codeql/discussions/10940\#discussioncomment-4021137)   Author

|     |
| --- |
| Thanks for the additional detail! I think with this we should be able to construct a suppression query that can take the old format and convert it into a CodeQL-suppression-readable format.<br>An additional question for you: do you know if this mechanism and syntax are expected to be supported for the foreseeable future, or are there plans in the pipeline to change or deprecate any part of this?<br>I really appreciate your help in all this. |

All reactions

[![@aibaars](https://avatars.githubusercontent.com/u/10979737?s=60&v=4)](https://github.com/aibaars)

Comment options

### Uh oh!

There was an error while loading. [Please reload this page](https://github.com/github/codeql/discussions/10940).

# {{title}}

Quote reply

#### [aibaars](https://github.com/aibaars) [on Oct 31, 2022Oct 31, 2022](https://github.com/github/codeql/discussions/10940\#discussioncomment-4022092)

|     |
| --- |
| You're welcome. There are no plans to change or remove this mechanism for now. However, I can't make any promises. |

All reactions

[Sign up for free](https://github.com/join?source=comment-repo) **to join this conversation on GitHub**.
Already have an account?
[Sign in to comment](https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fgithub%2Fcodeql%2Fdiscussions%2F10940)

Category


[💡\\
\\
Ideas](https://github.com/github/codeql/discussions/categories/ideas)

Labels


None yet


2 participants


[![@NateD-MSFT](https://avatars.githubusercontent.com/u/34494373?s=48&v=4)](https://github.com/NateD-MSFT)[![@aibaars](https://avatars.githubusercontent.com/u/10979737?s=48&v=4)](https://github.com/aibaars)

Heading

Bold

Italic

Quote

Code

Link

* * *

Numbered list

Unordered list

Task list

* * *

Attach files

Mention

Reference

# Select a reply

Loading

[Create a new saved reply](https://github.com/github/codeql/discussions/10940)

👍1 reacted with thumbs up emoji👎1 reacted with thumbs down emoji😄1 reacted with laugh emoji🎉1 reacted with hooray emoji😕1 reacted with confused emoji❤️1 reacted with heart emoji🚀1 reacted with rocket emoji👀1 reacted with eyes emoji

You can’t perform that action at this time.