# Attribution

The HiveLab 合屋 source code is released under the [MIT License](LICENSE). The artwork, screenshots and clips are excluded; see below.

HiveLab 合屋 is developed from [tonyAmadeus/offAice](https://github.com/tonyAmadeus/offAice), used with the author's permission. Original Git history and machine-specific development notes are preserved separately in the local archive.

Included third-party software notices are in [public/third-party-licenses.txt](public/third-party-licenses.txt).

The built-in `desktop` tool runs the unmodified Windows x64 binary of [vercel-labs/agent-desktop](https://github.com/vercel-labs/agent-desktop) 1.2.0 (Apache-2.0) as a separate process. Its license and version notes are in `build/third-party/agent-desktop/`.

The workspace terminal uses xterm.js and Microsoft node-pty (MIT). PDF previews use Mozilla PDF.js (Apache-2.0). Their original license files are retained in the distributed production dependencies.

The liquid-glass refraction fragment is adapted from [xiaofangstudio/liquid-glass-web](https://github.com/xiaofangstudio/liquid-glass-web), based on [Shu Ding's liquid-glass](https://github.com/shuding/liquid-glass) (MIT, Copyright © 2025 Shu Ding). The corresponding notice is included in `public/third-party-licenses.txt`.

## Trademarks and vendor programs

Claude, Claude Code, Codex, ChatGPT, DeepSeek, Gemini, Antigravity, Kimi, GLM, Qwen, Qoder, Cursor, OpenCode and other product names belong to their owners. HiveLab 合屋 is an independent project and is not affiliated with, endorsed by or sponsored by them. It drives the official programs that users install and sign in to themselves. Vendor programs are downloaded from their official distributions on the user's machine and are not part of this repository or its releases. `@anthropic-ai/claude-code` appears only as a development dependency for testing; it is proprietary and must not be redistributed with HiveLab.

## Character artwork

The built-in artwork of the three default members (`src/renderer/assets/members/claudia.webp`, `gptia.webp` and `ds.webp`) and the studio backgrounds (`src/renderer/assets/rooms/`) are **not** covered by the code license. They are credited to ZipZipPipe ([original collection](https://www.pixiv.net/artworks/148186519), [author page](https://www.pixiv.net/users/18604994)); author credit and noncommercial use are required. The DeepSeek character is a derivative identified as CC BY-NC-SA 4.0. Keep the credit when redistributing, and do not use these images commercially. No other member artwork is included: users upload their own for every other executor.
