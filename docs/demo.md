# Turn a prompt into something that works

[![Pocket Pet browser demo](assets/pocket-pet-demo.png)](assets/pocket-pet-demo.png)

[Open the full-size card](assets/pocket-pet-demo.png) · [Build it yourself](../examples/pocket-pet) · [View the finished source](../examples/pocket-pet/finished)

## A new feature, then a new requirement

The starter is a small, predesigned browser pet that blinks and says hello. The first request asks Alran Code to add a Pomodoro timer. The follow-up changes pause to an 800 ms hold and adds a completion celebration. The finished example runs locally without hardware or frontend dependencies.

The card shows the finished example running in a browser. The interface includes subsequent maintainer design work; it is not a recording of the interactive TUI. See the [full prompts](../examples/pocket-pet) and try the same changes in your own copy.

## Recording and verification

- The card was captured on 2026-11-13 from the finished example served locally, with the same browser checks as the example.
- The first run added the timer and passed 6 tests. The follow-up added hold-to-pause and the celebration and passed all 13 tests. Both runs explicitly said browser behavior was unverified; the maintainer then checked it in Chrome.
- Browser checks cover start, short-click behavior, pointer hold/pause/resume, keyboard hold/repeat/release/resume, the default 25-minute setting, canceled holds, completion, reduced-motion behavior, and a 390 px viewport without horizontal overflow.
- `?demo=1` visibly labels a **10-second demonstration**. No 25-minute wait or physical hardware operation is implied. State is in memory and a page reload resets it.
- The visual starter was authored before the agent runs. The reference implementation retains the generated timer and hold logic. Subsequent maintainer work redesigned the HTML/CSS, added session-progress and short-tap feedback, made the mode links visible, avoided repeated live-region text writes, and canceled pending holds when the button loses focus. The card does not claim generation from an empty project.
- Only the example's own synthetic content appears. No private project, account page, session, or key was recorded. Raw captures and runtime logs remain local and are not committed as release assets.

To edit the starter, install and configure Alran with a Alran account with available credits or your own compatible model API. Calls may incur charges. Running the finished example requires only Node.js and a browser.

---

## A small code repair

![Real Alran Code terminal replay: request, failing tests, a code fix, and passing tests](assets/tui-demo.gif)

[Play or download the MP4](assets/tui-demo.mp4) · [View the full-size still](assets/tui-demo.png) · [Example source](../examples/clamp)

## What was recorded

The interactive TUI built from this repository ran in a temporary directory containing only `clamp.mjs` and `clamp.test.mjs`. The runtime really executed the `read` and `edit` tools and ran `node --test` twice; the test file was unchanged. The assistant turns came from a scripted local OpenAI-compatible provider, so no model provider, account, or credit was used and no model output was invented: the transcript is the editor's script, the tool calls and their results are real.

The recorded task:

> Fix clamp.mjs to pass tests.

Full access was used only for this isolated synthetic project. Use `/permission` to choose an appropriate mode for your own work.

## Recording and editing

- Recorded on 2026-11-13 from this working tree, TUI version 0.2.0, at 110 columns × 40 rows.
- Actual ANSI output was captured through a PTY. Application text, colors, and layout are retained; the outer window title and provenance caption are recording decoration.
- The still shows the finished session with the request, the tool calls, and the passing tests.
- The 17-second edit keeps task order and holds on the final answer. **It is not real-time playback or a performance benchmark.**
- `@xterm/headless` interpreted terminal cells, which were rendered as PNG. FFmpeg encoded the GIF and silent H.264 MP4. A border keeps the dark terminal frame visible on both light and dark GitHub backgrounds.
- No private project, account page, session, or key was recorded, and no user test image was used. Raw recordings and runtime logs remain local and are not committed as release assets.

This demonstrates one small code repair, not acceptance of every project, provider, or tool. See the [verification records](verification.md) for broader evidence.

## Brand assets

The README's light and dark wordmarks use the existing TUI welcome logo, with blue and cyan from its theme. `assets/social-preview.png` is a local 1280 × 640 sharing card for maintainers to configure as the GitHub Social Preview at release time. Creating these assets does not publish the repository; nothing was uploaded to a third-party media host.
