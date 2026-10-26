The 2026 Annual Developer Survey Results Site is live—
[view the results here!](https://survey.stackoverflow.co/2026/?utm_medium=referral&utm_source=stackoverflow-community&utm_campaign=dev-survey-2026&utm_content=announcement-banner-results)

[dismiss](https://stackoverflow.com/questions/74694174/inline-suppressing-of-warnings-with-github-codeql# "dismiss")

##### Collectives™ on Stack Overflow

Find centralized, trusted content and collaborate around the technologies you use most.

[Learn more about Collectives](https://stackoverflow.com/collectives)

# [Inline suppressing of warnings with Github CodeQL](https://stackoverflow.com/questions/74694174/inline-suppressing-of-warnings-with-github-codeql)

[Ask Question](https://stackoverflow.com/questions/ask)

Asked3 years, 10 months ago

Modified [3 years, 5 months ago](https://stackoverflow.com/questions/74694174/inline-suppressing-of-warnings-with-github-codeql?lastactivity "2023-05-08 13:16:17Z")

Viewed
4k times


This question shows research effort; it is useful and clear

8

This question does not show any research effort; it is unclear or not useful

Save this question.

[Timeline](https://stackoverflow.com/posts/74694174/timeline)

Show activity on this post.

CodeQL reports some true and some false positive for a specific rule.

Is there a way to mark a Python codeline so that the check is ignored by CodeQL?

Similar, for example to `# noqa` for Python flake or pep-8 checks.

- [python](https://stackoverflow.com/questions/tagged/python "show questions tagged 'python'")
- [suppress-warnings](https://stackoverflow.com/questions/tagged/suppress-warnings "show questions tagged 'suppress-warnings'")
- [static-code-analysis](https://stackoverflow.com/questions/tagged/static-code-analysis "show questions tagged 'static-code-analysis'")
- [codeql](https://stackoverflow.com/questions/tagged/codeql "show questions tagged 'codeql'")

[Share](https://stackoverflow.com/q/74694174)

Share a link to this question

Copy link [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/ "The current license for this post: CC BY-SA 4.0")

Short permalink to this question

[Improve this question](https://stackoverflow.com/posts/74694174/edit "")

Follow



Follow this question to receive notifications

[edited Dec 11, 2022 at 9:44](https://stackoverflow.com/posts/74694174/revisions "show all edits to this post")

[![wovano's user avatar](https://www.gravatar.com/avatar/256e13236fd3f35f5d3759695c603ec4?s=64&d=identicon&r=PG&f=y&so-version=2)](https://stackoverflow.com/users/10669875/wovano)

[wovano](https://stackoverflow.com/users/10669875/wovano)

5,20455 gold badges3333 silver badges5858 bronze badges

asked Dec 5, 2022 at 20:42

[![Josef's user avatar](https://www.gravatar.com/avatar/ad13088a623822caf74e635a68a55eae?s=64&d=identicon&r=PG)](https://stackoverflow.com/users/333700/josef)

[Josef](https://stackoverflow.com/users/333700/josef)

23.2k33 gold badges6161 silver badges7373 bronze badges

2

- 1





Looks like this is [not supported at the moment](https://github.com/github/codeql/issues/11427)



Marcono1234


–
[Marcono1234](https://stackoverflow.com/users/4288506/marcono1234 "7,397 reputation")



2022-12-10 23:47:01 +00:00

[CommentedDec 10, 2022 at 23:47](https://stackoverflow.com/questions/74694174/inline-suppressing-of-warnings-with-github-codeql#comment131938291_74694174)

- @Marcono1234, that could be a valid answer (at least until the feature is added in CodeQL)



wovano


–
[wovano](https://stackoverflow.com/users/10669875/wovano "5,204 reputation")



2022-12-11 09:45:46 +00:00

[CommentedDec 11, 2022 at 9:45](https://stackoverflow.com/questions/74694174/inline-suppressing-of-warnings-with-github-codeql#comment131941962_74694174)


[Add a comment](https://stackoverflow.com/questions/74694174/inline-suppressing-of-warnings-with-github-codeql# "Use comments to ask for more information or suggest improvements. Avoid answering questions in comments.") \| [Expand to show all comments on this post](https://stackoverflow.com/questions/74694174/inline-suppressing-of-warnings-with-github-codeql# "Expand to show all comments on this post")

## 1 Answer 1

Sorted by:
[Reset to default](https://stackoverflow.com/questions/74694174/inline-suppressing-of-warnings-with-github-codeql?answertab=scoredesc#tab-top)

Highest score (default)

Trending (recent votes count more)

Date modified (newest first)

Date created (oldest first)


This answer is useful

2

This answer is not useful

Save this answer.

Loading when this answer was accepted…

[Timeline](https://stackoverflow.com/posts/76186025/timeline)

Show activity on this post.

Check out one alternative using the open source project [advanced-security/dismiss-alerts](https://github.com/advanced-security/dismiss-alerts). It introduces an additional CodeQL query to extract out `//codeql[py/line-too-long]` or `# noqa` style comments in your code (see [test.py](https://github.com/github/codeql/blob/ededd466cb6301edc60115b9431b3909903f7fa4/python/ql/test/query-tests/analysis/suppression/test.py#L68-L75)). Those comments are then fed into the SARIF `suppression[]` object and dismissed in Code Scanning by calling the GitHub alerts api.

[Share](https://stackoverflow.com/a/76186025)

Share a link to this answer

Copy link [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/ "The current license for this post: CC BY-SA 4.0")

Short permalink to this answer

[Improve this answer](https://stackoverflow.com/posts/76186025/edit "")

Follow



Follow this answer to receive notifications

[edited May 8, 2023 at 13:16](https://stackoverflow.com/posts/76186025/revisions "show all edits to this post")

answered May 5, 2023 at 21:25

[![felickz's user avatar](https://www.gravatar.com/avatar/1cbc1d03642ef3ad308bd3704d052ef3?s=64&d=identicon&r=PG)](https://stackoverflow.com/users/343347/felickz)

[felickz](https://stackoverflow.com/users/343347/felickz)

4,50133 gold badges3636 silver badges4141 bronze badges

## Comments

Add a comment

## Your Answer

**Reminder:** Answers generated by AI tools are not allowed due to Stack Overflow's [artificial intelligence policy](https://stackoverflow.com/help/gen-ai-policy)

Draft saved

Draft discarded

### Sign up or [log in](https://stackoverflow.com/users/login?ssrc=question_page&returnurl=https%3a%2f%2fstackoverflow.com%2fquestions%2f74694174%2finline-suppressing-of-warnings-with-github-codeql%23new-answer)

Sign up using Google


Sign up using Email and Password


Submit

### Post as a guest

Name

Email

Required, but never shown

Post Your Answer

Discard


By clicking “Post Your Answer”, you agree to our [terms of service](https://stackoverflow.com/legal/terms-of-service/public) and acknowledge you have read our [privacy policy](https://stackoverflow.com/legal/privacy-policy).


Start asking to get answers

Find the answer to your question by asking.

[Ask question](https://stackoverflow.com/questions/ask)

Explore related questions

- [python](https://stackoverflow.com/questions/tagged/python "show questions tagged 'python'")
- [suppress-warnings](https://stackoverflow.com/questions/tagged/suppress-warnings "show questions tagged 'suppress-warnings'")
- [static-code-analysis](https://stackoverflow.com/questions/tagged/static-code-analysis "show questions tagged 'static-code-analysis'")
- [codeql](https://stackoverflow.com/questions/tagged/codeql "show questions tagged 'codeql'")

See similar questions with these tags.

lang-py