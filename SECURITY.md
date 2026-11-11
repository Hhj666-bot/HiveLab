# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's **private vulnerability reporting** (the repository's Security tab → Report a vulnerability) and include the steps to reproduce, the affected version and what an attacker could do.

You will get a first reply within a few days. Fixes are released as soon as they are verified, and reporters are credited unless they prefer not to be.

请不要为安全问题创建公开 Issue。请使用仓库 Security 页的 “Report a vulnerability” 私下提交，写明复现步骤、受影响版本和可能造成的后果。

## What is in scope

- Escaping the renderer sandbox, the method allow-list or the file-preview and wallpaper sandboxes.
- Writing outside an authorised folder (symlink or junction tricks, path validation).
- Leaking secrets into the database, logs, diagnostics or the interface snapshot.
- Starting member programs with a wrong permission mode or environment.

## What is not

- Behaviour of the vendor programs themselves (Claude Code, Codex and others). Report it to their vendors.
- The documented limits: working copies are not operating-system isolation, and members in full-access mode can touch files outside their copy.

## Handling secrets while testing

Tests run on temporary, signed-out profiles and never call a real model. Never commit API keys, tokens or real chat data; use the guarded scripts in `scripts/real-account/` only with your own accounts.
