# Security

These integrations authenticate users to Cenmax AI and let the host application make model requests. OAuth credentials are secrets. A public client ID is not a secret and does not authenticate an installation by itself.

## Trust boundary

The user trusts the machine and the host application running a plugin or adapter. Host administrators and other code running as the same operating-system user may be able to access that user's credentials. File permissions and temporary local capabilities do not isolate hostile code running as the same user.

Only approve a device code after starting sign-in yourself. Check the code and account on the Cenmax AI approval page. Do not paste access or refresh tokens into prompts, tickets, screenshots, or configuration shared with agents.

The integrations use the fixed public HTTPS service origin. Redirects must not carry credentials to a different destination. Model discovery must use the authenticated account catalogue. Host tool and command permissions remain separate from OAuth model access.

## Reporting

Report suspected credential disclosure privately through the security contact offered by the Cenmax AI service. Do not include live tokens or personal conversation content in a public issue. If credentials may have been disclosed, revoke the affected authorization and sign in again on a trusted machine.

## Release checks

Run the package's tests and inspect the exact distributable before release. Exclude local credentials, environment files, logs, dependency directories, caches, and machine-specific paths. Keep dependency and host compatibility versions explicit. Live sign-in and an agent tool round trip must be qualified on supported host versions before advertising a release as verified.
