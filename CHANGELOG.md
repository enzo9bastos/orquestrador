# Changelog

What changed in each version of the app. While the app is in alpha, versions
follow `0.MINOR.PATCH`: a new feature raises the middle number, a fix raises the
last one. Each version has a tag (`vX.Y.Z`) and a release with these notes.

## 0.4.1 (2026-11-16)

- Desktop helper: when it walks out with a question and the user goes
  straight to the app instead of answering it, it now leaves on its own. It
  stays if an answer had already been started there (text typed, an option
  marked, one of several questions answered) or if the user is chatting with
  it.
- Notes: the ✕ on a folder tab only closes the tab. The folder stays in the
  app and on disk, the tab stays closed after a restart, and it reopens from
  "+ Folder", from the empty screen or when one of its notes is opened.
  Removing a folder from the app stays in Settings.

## 0.4.0 (2026-11-16)

- Clean screen: the agents column (left) and the requests column (right)
  collapse, with a button at each end of the top bar or with `Ctrl+Alt+,` and
  `Ctrl+Alt+.`. Outside the Orchestrator tab they collapse on their own, so
  Notes, Workflows and the other tabs get the whole window; what the user
  reopens is remembered per tab and survives a restart. A collapsed column
  never hides something that needs the user: its button shows a counter.
- Settings has a Shortcuts section: the two column shortcuts can be changed
  or turned off, and a combination already taken by the app or by the system
  is refused.
- Wider conversation: it follows the free space up to 1200 px, with answers
  on the left and the user's messages on the right, each side leaving a
  margin for the other; running text stops at 960 px. The message box, the
  cards and the code blocks follow the same column.
- Notes: the note grows with the free space too, and the formatting bar shows
  on focus or hover and never wraps to a second line.
- The "Update ready. Restart the app" banner is now part of the top bar: it
  no longer covers buttons, at any window width.

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
