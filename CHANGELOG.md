# Changelog

What changed in each version of the app. While the app is in alpha, versions
follow `0.MINOR.PATCH`: a new feature raises the middle number, a fix raises the
last one. Each version has a tag (`vX.Y.Z`) and a release with these notes.

## 0.11.0 (2026-11-18)

- Earlier conversations: a new "Earlier…" button above the conversation list opens the conversations
  Claude keeps on this computer, newest first, with folder, size and engine. Search by name or folder and
  press Enter to reopen one in the folder it ran in; the same conversation never opens twice.
- Archive and unarchive from that window. Delete shows the cost first (how many files and how much,
  including the subagent conversations; it goes to the system trash; what stays), needs a real click, and
  refuses a conversation that is open and the orchestrator's.
- Each conversation in the list now has a ⋯ menu where the ✕ used to be: Rename (also in Claude's own
  history, with no message in the conversation), Archive (with Undo), Branch, and Terminal in this folder.
  The orchestrator shows a lock instead: its folder and place are fixed.
- The list of earlier conversations never reads a whole file (there are 100+ MB conversations): only the
  beginning and the end of each, with an index so that only a changed file is read again.

## 0.10.0 (2026-11-18)

- A conversation can now work in a folder of your choice. "+ New conversation" opens a small window to pick
  the folder (your home folder, one used lately, or another from the system's folder picker) and the engine
  (Claude or Codex). The folder does not change afterwards; the orchestrator always runs in your home folder.
- Folder trust card: the first time Claude would start in a folder that is not your home folder, the
  conversation shows what the folder configures (commands that run by themselves, MCP servers, rules that
  already allow without asking, instructions) and waits for your answer: Trust and open, Open without the
  project's settings, or Cancel. Nothing from the folder runs before that, and only a real click accepts.
  If those files change later, the card comes back showing what changed.
- The list on the left shows each conversation's folder and state on a second line.
- The folder chip in the conversation bar opens a menu: the folder, the extra folders the conversation may
  use (add or remove), and a shortcut to open a new conversation in a folder used lately.
- A folder that no longer exists is a clear error; a conversation never moves to another folder by itself.
- For a project folder with an agent in a container, the acceptance is kept in memory only: the card comes
  back each time the app opens.
- `/resume` lists the earlier conversations of the conversation's own folder.

## 0.9.1 (2026-11-18)

- Quick question has a keyboard shortcut: `Ctrl+Alt+P` opens the drawer with the keyboard in its field,
  and closes it again. It works with the conversation in front and no dialog open.
- The shortcut has its own line in Settings › Shortcuts, next to the column shortcuts: you can change it,
  turn it off, or go back to the default. It cannot repeat a shortcut the app already uses or one of the
  column shortcuts.
- The shortcut list (`? Shortcuts`) shows the combination in use.

## 0.9.0 (2026-11-17)

- Quick question (`/btw`, or ⋯ › Quick question) now opens a drawer over the right-hand column instead of
  dropping a card in the middle of the conversation. You ask about the conversation while Claude keeps
  working; the question and the answer stay out of the conversation.
- A follow-up question sees the earlier ones (the newest 20, as in the terminal). You can stop a question
  that is waiting, copy an answer as Markdown, ask a failed one again, and clear the list. The list is kept in
  memory, one per conversation, until the app closes.
- A notice that Claude Code returns in place of an answer (a sign-in error, for example) is now shown as an
  error with its detail, not as if it were the answer.
- `/btw` with no question opens the drawer on the earlier questions. Esc closes the drawer when the keyboard
  is in it; in the message box, Esc still stops the engine.
- Claude conversations only: in a Codex conversation `/btw` remains Codex's `/side`.

## 0.8.1 (2026-11-17)

- A message waiting in the queue now shows the thumbnails of the screenshots it carries
  (as many as there are) instead of an image symbol with a count. Clicking a thumbnail
  opens it enlarged, as in a sent message.

## 0.8.0 (2026-11-17)

- **Rewind with files.** The ✎ on a message now opens a card under it with three choices:
  *Conversation only* (the default; Enter confirms), *Conversation and files* and *Files only*.
  For the files, Claude is asked first what would go back (how many files, how many lines; a
  file changed after Claude's last edit is flagged). Before anything is restored the app keeps
  a copy of the files as they are now in a new folder under
  `~/.local/share/orq-app/versoes/`, and only a real click on the red button restores them.
  What commands did (files created by scripts, databases, git commits) does not come back.
  `/rewind` opens the same card. Restore points can be turned off in Settings › Advanced
  (they apply to conversations opened after this version).
- **Codex permission cards.** A command or file change from Codex offers what Codex accepts:
  *Allow this time*, *Allow in this conversation*, *Always allow…* for commands that start the
  same way (a rule Codex writes to `~/.codex/rules/default.rules`; the app keeps the current
  version of the file first), *Deny* and *Deny and stop*. Docker, ssh, network, deletion and
  `git push` never get "in this conversation" or "always".
- **Codex asking for more access** (folders outside the conversation, the network) is now a
  card listing exactly what it asks for, granted for this turn or for the conversation. A
  request the app cannot show in full can only be denied.
- **An MCP server asking for information through Codex** uses the same card as with Claude.
- Fix: the permission card said "Always allowed" when the rule had not been written because
  the copy of the settings file failed. It now says it allowed this time only.
- Fix: picking "Opus plans, Sonnet executes" in the model menu jumped to "Sonnet 5.5". Claude
  reports the model in use at the moment (Sonnet outside plan mode) and the app took that as
  the choice. The choice now stays, on screen and in what is saved.
- Fix: a message sent while Claude was answering on its own (a scheduled reminder, a background
  task that finished) went right away and its balloon showed up in the middle of the answer.
  That turn now counts as "working": the message waits in the queue, goes when Claude
  finishes, and then gets its answer.

## 0.7.0 (2026-11-17)

- `@` in the message box also mentions a request, an agent message or an
  agent: `@demanda:`, `@recado:` and `@agente:` list the ones in the panels,
  next to files, notes and workflows. Free text after `@` finds a request by
  its title, a message by its text and an agent by its name.
- What you mention goes along with the message, after your text: the
  request's data, checklist and note; the message's sender, time and text
  (marked as third-party text, to be read as information); the agent's
  project, tmux session, state and task. The balloon shows only what you
  wrote.
- The hint under the box now reads "@ mention".

## 0.6.1 (2026-11-17)

- Conversation search (Ctrl+F): closing the bar right after a new message
  arrived could leave the marks on screen. Fixed.
- An MCP server asking you for information is now a card instead of an
  immediate refusal: it says which server asks and for what, with its form
  (fields that look like secrets are masked and never kept on screen) and
  Send, Decline and Cancel. When the server asks to open a page, the card
  shows the site first and opens the browser only on your click.
- Tests: two screen tests no longer depend on where the pointer is or on a
  rerun still pending when the search bar closes.

## 0.6.0 (2026-11-17)

- Permission card with three answers: allow this time, always allow (you
  pick the reach: this conversation only, which is the default and writes
  nothing, this project, or all your projects; the card shows the rule, the
  file and how to undo it) and deny, saying what to do instead. The reason
  Claude asks is shown. "Always" is offered only when Claude suggests a rule,
  and never for commands that run other programs, docker, tmux, ssh, network
  and deletion tools, `git push`, compound commands or wildcard rules.
- Plan card: when Claude finishes planning, the plan shows up formatted, with
  three answers (approve and continue in Auto, approve and ask before each
  change, keep planning) and "Edit the plan". Once answered it folds into one
  line with "See the plan".
- A request that Claude cancels now says so, instead of "Answered".
- Number keys answer the focused card (Settings > Shortcuts turns it off).
- Search the conversation with Ctrl+F: only that conversation's messages,
  Enter and Shift+Enter move between matches, Esc closes the bar without
  stopping the engine.
- A copy button on each reply copies it as Markdown, without the tool lines;
  `/copy` copies the same.
- `@` in the message box also suggests files from the conversation's folder
  (the ones Claude Code shows in the terminal), next to notes and workflows.
- `!command` in the message box can run a command of yours on your computer,
  in the conversation's folder, as in Claude Code's terminal. It is OFF by
  default (Settings > Advanced). When on, only a `!` you typed yourself and
  sent with Enter counts. See SECURITY.md.
- The contract checker also checks the file suggestions request (Claude) and
  the user shell command request (Codex).
- Tests: the known-version capability test no longer depends on the previous
  test's timing.

## 0.5.1 (2026-11-17)

- A command that only exists in the terminal: when Claude answers that a
  command "isn't available in this environment", its text stays and the app
  adds a notice in the user's language with an "Open in the terminal"
  button, which pastes Claude with a copy of the conversation and the command
  into the app's terminal. Nothing runs until Enter is pressed there.
- History on reopen: local commands (`/rename`, `/memory`…) and their output
  come back as they looked live. They used to vanish after reopening.
- Codex: if it refuses to open the conversation (for example, an organization
  that restricts the allowed approval policies), the app no longer stays
  stuck in "working". Nothing opens, the screen says why, the typed text goes
  back to the box, and the app never retries with a looser policy.
- Connected AIs: the Cursor CLI is found behind its `agent` shortcut too, and
  only when the real file is the one in Cursor's own install folder; an
  unrelated program named `agent` is never run.
- The contract checker (`scripts/contrato-cli.js`) now also checks how the
  installed Claude CLI answers a terminal-only command.
- Tests: the external terminal test no longer reads a file before it has
  content.

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
