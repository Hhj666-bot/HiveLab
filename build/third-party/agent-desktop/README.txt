HiveLab includes the unmodified Windows x64 binary of agent-desktop 1.2.0
(npm package agent-desktop@1.2.0, file bin/agent-desktop-win32-x64.exe),
renamed to agent-desktop.exe. HiveLab runs it as a separate process for the
built-in "desktop" tool (hivelab-desktop plugin) and checks its SHA-256 before
every first use:

  d274667031322e50b9c2b1ab81c2ca46835d52cc932769a5c34bd4d481fd94c3

Copyright Vercel, Inc. and agent-desktop contributors.
License: Apache License 2.0, full text in LICENSE.txt.
Source: https://github.com/vercel-labs/agent-desktop
        (release commit 2b0a7334fc111730454b726e6800aa41cdafc093)
The binary is not code-signed by its authors.
