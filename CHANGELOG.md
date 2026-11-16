# Changelog

What changed in each version of the app. While the app is in alpha, versions
follow `0.MINOR.PATCH`: a new feature raises the middle number, a fix raises the
last one. Each version has a tag (`vX.Y.Z`) and a release with these notes.

## 0.2.1 (2026-11-16)

- The screen only reloads by itself when the main-process code is unchanged
  since startup. When an update also changes the main process, the app keeps
  the current screen and shows "Update ready. Restart the app to apply it"
  (a new screen talking to an old main process stopped showing messages).

## 0.2.0 (2026-11-16)

- Performance: the agent collector no longer blocks the main process (worst
  stall with ten agents went from about 2 s to under 40 ms); transcripts and
  logs are read by their ends instead of whole (a 120 MB session opens in a
  few milliseconds); sends to the screen are batched (about 20 per second
  instead of one per piece of text).
- Slash commands: every Claude Code and Codex command works in the app; the
  list shows about six commands at a time, like the terminal.
- Conversation engine: model and effort switch live, the permission mode and
  the session survive a restart, `/clear` keeps the earlier session reachable.
- Links in the conversation: Ctrl+click opens web links, with the real host as
  a hint and a confirmation when the text points somewhere else; links to
  local files and folders open in the file explorer; addresses written without
  `http://` are links too.
- Security: writes into a project's `.orq` folder refuse symlinks; an agent's
  permission prompt is pinned by hash; secret answers are masked; the channel
  envelope is hardened.
- The desktop helper exits quietly when the app is gone, and no longer stands
  on the Stop button.
- Test runs no longer send desktop notifications.

## 0.1.0 (2026-11-10)

- First public alpha: an orchestrator conversation on Claude Code or Codex CLI,
  the agents column, demands, notes, workflows, the library, messages between
  orchestrators on different computers, and the desktop helper.
