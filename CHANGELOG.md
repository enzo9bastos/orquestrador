# Changelog

What changed in each version of the app. While the app is in alpha, versions
follow `0.MINOR.PATCH`: a new feature raises the middle number, a fix raises the
last one. Each version has a tag (`vX.Y.Z`) and a release with these notes.

## 0.3.1 (2026-11-16)

- orq-recado para works again: it crashed with a TypeError after the agent collector became asynchronous

## 0.3.0 (2026-11-16)

- Channel between orchestrators: images and PDFs can go as attachments
  (`orq-recado externo <contact> "text" --anexo file`, up to three; png, jpg,
  webp or pdf, checked by content). A message with an attachment always waits
  for the user's approval, with a thumbnail and a warning that the link stays
  open for a few days; approval is available in the Messages tab, in the
  conversation card and in the desktop helper. Image metadata (EXIF, GPS,
  text) is removed before sending, and the sending copy is deleted once the
  server confirms.
- Attachments that arrive are downloaded only from the channel's own server,
  checked by content and size, kept in a private folder and shown from the
  local file; the orchestrator receives only the local path, marked as data.
- Versions: the app now has a version number, a changelog, tags and releases;
  Settings shows the installed version and commit.

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
