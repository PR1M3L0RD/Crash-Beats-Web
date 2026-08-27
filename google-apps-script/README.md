# Crash Weekly Google Sheet webhook

This owner-authorized Apps Script lets the Worker read the featured schedule from a restricted sheet and write website submissions into `Sheet1!I:K`.

1. Restrict the spreadsheet so anonymous visitors cannot edit it.
2. While signed into `ewoodthomas@gmail.com`, open the spreadsheet and choose **Extensions → Apps Script**.
3. Replace the editor contents with `Code.gs` from this directory.
4. In **Project Settings → Script properties**, add `SUBMISSION_SECRET` with a long random value.
5. Choose **Deploy → New deployment → Web app**. Execute as **Me** and allow access to **Anyone**.
6. Copy the `/exec` deployment URL.
7. Set the two encrypted Worker secrets (use the same random value for the second prompt):

   ```powershell
   npx wrangler secret put GOOGLE_SHEETS_WEBHOOK_URL
   npx wrangler secret put GOOGLE_SHEETS_WEBHOOK_SECRET
   ```

Once both secrets are present, the Worker treats this owner-authorized schedule as trusted. The anonymous CSV fallback remains disabled.

The handler returns only the public-facing featured schedule from columns A–C. For submissions, it uses a script lock, appends only the artist name, Instagram URL, and Spotify URL to columns I–K, and keeps the submission ID/song filenames in the artist cell note for safe retries and deduplication.

To feature a website submission, copy its full `I:K` row into the next `A:C` Featured row so the artist-cell note is copied too. That owner-selected submission ID is what authorizes its uploaded tracks for playback; matching public social links alone can never publish a submission.
