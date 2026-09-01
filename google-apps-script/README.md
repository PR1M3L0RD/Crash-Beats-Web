# Crash Weekly Google Sheet webhook

This owner-authorized Apps Script lets the Worker read the featured schedule from a restricted sheet and write website submissions into `Sheet1!I:M`.

1. Restrict the spreadsheet so anonymous visitors cannot edit it.
2. While signed into `ewoodthomas@gmail.com`, open the spreadsheet and choose **Extensions → Apps Script**.
3. Replace the editor contents with `Code.gs` from this directory.
4. In **Project Settings**, enable **Show `appsscript.json` manifest file in editor**,
   then replace that file with `appsscript.json` from this directory.
5. In **Project Settings → Script properties**, add `SUBMISSION_SECRET` with a long random value.
6. Select `authorizeServices` in the function dropdown, choose **Run**, and approve
   the requested Sheets, external-request, and send-mail permissions.
7. Choose **Deploy → New deployment → Web app**. Execute as **Me** and allow access to **Anyone**.
8. Copy the `/exec` deployment URL.
9. Set the two encrypted Worker secrets (use the same random value for the second prompt):

   ```powershell
   npx wrangler secret put GOOGLE_SHEETS_WEBHOOK_URL
   npx wrangler secret put GOOGLE_SHEETS_WEBHOOK_SECRET
   ```

Saving `Code.gs` does not update an existing web-app deployment. After every
change to this file, choose **Deploy → Manage deployments**, edit the active web
app, select **New version**, and deploy it. Keep the existing `/exec` URL so the
Worker secret does not need to change.

Once both secrets are present, the Worker authenticates schedule reads and treats this owner-authorized schedule as trusted. Direct requests to the Apps Script URL without the shared secret are rejected. The anonymous CSV fallback remains disabled.

The authenticated handler returns the featured schedule from columns A–E plus the private submission marker stored in each artist-cell note. The Worker uses that marker to authorize tracks, then exposes only the current artist's public links and a name-only schedule to browsers. For submissions, the script uses a lock, appends the artist name and all four optional links to columns I–M, keeps the submission ID/song filenames in the artist cell note, and forwards the MP3 attachments to `crashbeats08@gmail.com` with the artist name and submission ID.

To feature a website submission, copy its full `I:M` row into the next `A:E` Featured row so the artist-cell note is copied too. That owner-selected submission ID is what authorizes its uploaded tracks for playback; matching public social links alone can never publish a submission.
