# Cenmax AI for OpenClaw

Sign in to Cenmax AI in OpenClaw with browser approval. Requests use the selected account's available allowance and models. No pay-as-you-go API key is required for subscription access.

## Status and requirements

This package implements OpenClaw's public provider registration, device authentication, refresh, and live catalogue interfaces. It was qualified against the published **OpenClaw 2026.11.8** release with Node.js **24.22.3** in a disposable Linux container on 24 November 2026. Live Cenmax AI OAuth sign-in, entitled-model discovery, a file-read tool round trip, conversation continuity, forced-expiry token rotation, and access revocation were exercised. See [qualification](./QUALIFICATION.md). Other releases need their own compatibility checks; no ClawHub publication compatibility claim is made.

The target OpenClaw release must implement the documented [durable OAuth refresh settlement semantics](https://docs.openclaw.ai/auth-credential-semantics): claim the credential generation before dispatch, persist a terminal failed marker after an uncertain exchange, and require a fresh sign-in instead of retrying the old token. Older hosts without that behavior are unsupported. This package deliberately provides no retry/recovery hint for refresh exceptions; a network error, malformed token response, or server error does not prove that a rotating grant is reusable.

Cenmax AI must register the public OAuth client `cenmax-openclaw` with device-code and refresh-token grants and the `profile chat` scopes before login can succeed. A client ID is public, not a secret. The package does not borrow another application's registration.

## Install and connect

From this directory:

```sh
npm test
npm pack
openclaw plugins install --force --accept-capabilities ./cenmax-ai-openclaw-0.1.0.tgz
openclaw models auth login --provider cenmax --method device
```

Follow the displayed Cenmax AI approval link and confirm the matching code. Choose your personal or company account on the approval page. OpenClaw manages OAuth credentials in its auth-profile store and renews them through the provider refresh hook. Protect that store as you would any account credential. Do not copy rotating refresh tokens across machines or agents.

The model picker loads only models available to the signed-in account. Choose the returned model reference, such as `cenmax/pro` (**Pro by Cenmax AI**) or `cenmax/worker` (**Worker by Cenmax AI**), only when listed for your account. Context and output limits come from model discovery. Cost fields are zero because this integration cannot calculate a monetary cost for subscription allowance; zero does not mean unlimited usage.

## Public service contract

OAuth device authorization, token refresh, and account discovery use `https://console.ai.cenmax.in`. Inference uses `https://console.ai.cenmax.in/app/v1` and the Chat Completions format. Origins are fixed, redirects are refused, and service error bodies are not printed. The `profile` scope binds refreshes to the originally selected account; `chat` grants model access. No history, workspace, or file access is requested.

If a rotating refresh request fails or has an uncertain result, sign in again rather than replaying the old refresh token. OpenClaw owns durable refresh serialization and persistence; the plugin additionally coalesces simultaneous refresh calls in one process.

## Development

```sh
npm test
npm pack --dry-run
```

Unit tests use synthetic Cenmax AI identities and mocked HTTP responses. They cover device polling, consent URL validation, token rotation/account binding, model entitlement mapping, response bounds, and redacted failures. The separately recorded live qualification supplements these tests; it is not rerun by `npm test`.

SDK references: [provider plugins](https://docs.openclaw.ai/plugins/sdk-provider-plugins), [OAuth](https://docs.openclaw.ai/concepts/oauth), and [auth credential semantics](https://docs.openclaw.ai/gateway/auth-credential-semantics).
