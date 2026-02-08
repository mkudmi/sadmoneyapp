# sadmoneyapp

Personal finance / budgeting app built with Tauri + React + TypeScript.

## Auto update via GitHub Releases

1. Generate signing key pair once:
   - `npm run tauri signer generate -w ~/.tauri/sadmoneyapp.key`
2. Put private key to GitHub repository secrets:
   - `TAURI_SIGNING_PRIVATE_KEY`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
3. Put generated public key into `src-tauri/tauri.conf.json`:
   - `plugins.updater.pubkey`
4. Create release tag to trigger workflow:
   - `git tag v0.1.1 && git push origin v0.1.1`

Updater endpoint is configured to:
`https://github.com/mkudmi/sadmoneyapp/releases/latest/download/latest.json`
