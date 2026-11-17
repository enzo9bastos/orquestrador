# Changelog

What changed in each version of the app. While the app is in alpha, versions
follow `0.MINOR.PATCH`: a new feature raises the middle number, a fix raises the
last one. Each version has a tag (`vX.Y.Z`) and a release with these notes.

## 0.5.0 (2026-11-17)

- Conversation bar redone: four chips and a ⋯ menu. Usage is one chip (a ring
  with the context; the 5-hour and 7-day windows inside, and a badge when one
  goes past 80%). A new permission mode chip switches the mode live (Ask,
  Accept edits, Auto, Plan; Ctrl+Shift+M, or Shift+Tab on an empty box), and
  asks first when the orchestrator leaves Auto. With a narrow window the
  chips keep only their icons.
- Model menu: "Opus plans, Sonnet executes", other models folded, effort on
  one line with the arrows, and a fast-mode switch on models that have it.
- Activity strip above the box: what the engine is doing now, how many tasks
  run in the background, how many messages wait, and Stop (Esc).
- Message queue: while the engine works, Enter queues your message (visible,
  with "Send now" and "Remove") and Ctrl+Enter steers. If you stop the engine
  yourself, the queue waits for you.
- Esc does one thing at a time: it closes what is on top, and only then
  interrupts the engine; never from a terminal or another field.
- Hints under the box and a shortcuts panel (Ctrl+/).
- Start and Shut down show one at a time, only in the orchestrator
  conversation; a Settings option moves them into the ⋯ menu.
- `/exit` ends only that conversation (the app stays open) and can be undone
  with "Go back to the previous session".
- `/config` popup: the keys come from the CLI's own usage text, grouped and
  searchable, with the current value where Claude reports it.
- "No questions" (Bypass) mode exists only behind a Settings option that is
  off by default, only in side conversations, with a confirmation every time
  and a red strip on screen. See SECURITY.md.
- Requests: deleting shows what is lost first (the note, files, size, where
  it goes), and only the card's Delete button deletes. The `orq-topico
  apagar` command, which the orchestrator runs, no longer deletes: it leaves
  a request on the card for you to decide.

## 0.4.3 (2026-11-17)

- Codex: `/ps` and `/stop` work. The app now declares the capability Codex
  requires for background terminals (checked against Codex 0.167.1: it only
  adds methods and optional fields) and answers the one request Codex may
  send to such clients.
- Library: reads the folders other CLIs use now (OpenCode's plural folders,
  Gemini skills and agents, Qwen Code commands in Markdown, Cursor skills),
  and a skill reached through a link is listed once.
- Tests: the rewind screen test no longer misreads a late log line when many
  screen files run at once.

## 0.4.2 (2026-11-17)

- Desktop helper: what counts is what the user can see, not where the
  keyboard is. With the app in view the warning stays inside the app, even
  while typing in another window or on another monitor; and if the helper is
  already out, it leaves once the app comes into view.
- The "Update ready. Restart the app" banner now also shows when a release
  changes only code outside the screen.
- The app records which control requests the installed Claude CLI serves, per
  CLI version. It asks only the read-only ones, and only while the
  conversation is idle. Nothing changes on screen.
- New `scripts/contrato-cli.js`: checks the app's contract with the installed
  Claude and Codex CLIs in a temporary home and without network, to run after
  each CLI update.
- Base modules for the next stages, not wired to anything yet: `apagar.js`
  (delete and overwrite only through the trash or a copy, with the cost in
  numbers and one confirmation per item) and `confianca.js` (trusted folder:
  real path plus a fingerprint of what the folder would run).
- Tests: the fake Claude CLI answers unknown requests like the real one and
  can simulate another CLI version or a missing request.
- The in-app helper's speech balloon no longer blocks clicks on what is
  under it.
- Turning the desktop pet off in Settings now holds from the moment the app
  opens.
- Tests: the screen tests draw on a virtual display and no longer depend on
  the user's own session (a locked screen used to fail them); they run in
  parallel (about 2 min 40 s instead of 7 min 40 s), delete the temporary
  folders they create, use a private tmux and never start the real CLIs.
  `npm test -- --rapido` skips the slow files.

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
