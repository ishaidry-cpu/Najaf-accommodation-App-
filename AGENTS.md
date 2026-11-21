# Repository workflow

For every completed Codex task that changes this repository, stage and commit all changes belonging to the task, including new files and deletions. Use a descriptive commit message. Leave unrelated edits, credentials, and ignored files out of the commit.

Before finishing the task, publish the commit to `origin/main` without asking for a separate commit or merge confirmation unless the user asks to keep the changes local or use another branch. Fetch the latest `origin/main` and use a normal fast-forward push when GitHub permits it. If GitHub requires a pull request, push a task branch, open the pull request against `main`, and merge it as soon as GitHub allows. Use GitHub auto-merge for that pull request when available and required checks are pending. Respect branch rules and avoid force-pushing `main`.

Verify that the completed changes are on GitHub's `main` before reporting them as merged. If a conflict, GitHub permission, or required check blocks the merge, report what is blocking it and link the pull request if one exists.
