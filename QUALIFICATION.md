# OpenClaw qualification

Tested on 24 November 2026 against the published `openclaw@2026.11.8` package, Node.js 24.22.3, in a disposable Linux container. No modified harness or substitute inference service was used.

| Check | Result |
| --- | --- |
| Install package and accept declared capabilities | Passed |
| Load plugin through the host registry | Loaded; `cenmax` provider registered; no plugin diagnostics |
| Native device OAuth approval and credential persistence | Passed |
| Discover account-entitled public Cenmax AI models | Passed |
| Real agent read-tool call against a synthetic workspace file | Passed; one successful `read` call; expected file content returned |
| Follow-up in the same conversation | Passed |
| Force temporary credential expiry through host SDK, then run another turn | Passed; refresh token rotated and expiry renewed |
| Revoke the test authorization | Passed; model-list request with the revoked access token returned HTTP 401 |

The temporary authorization was revoked and the test container removed after testing. No account credentials, account identifiers, or raw session exports are included here.

This is point-in-time qualification of one released harness version. Repeat it before advertising compatibility with another version. Unit tests run independently and do not require account credentials.
