const SPREADSHEET_ID = '13jYGupkTRKLsz1V7Q4mQ-Wufgwot2EJwfsQC7U_6GZM';
const SHEET_NAME = 'Sheet1';
const FIRST_ENTRY_ROW = 3;
const ARTIST_COLUMN = 9;
const FEATURED_ARTIST_COLUMN = 1;
const EMAIL_RECIPIENT = 'crashbeats08@gmail.com';

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Missing sheet: ${SHEET_NAME}`);
  return sheet;
}

function safeCellValue(value) {
  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function submissionIdFromNote(note) {
  const match = String(note || '').match(/Crash Beats submission:\s*([0-9a-f-]{36})/i);
  return match ? match[1].toLowerCase() : '';
}

function doGet() {
  try {
    const sheet = getSheet();
    const rowCount = Math.max(0, sheet.getLastRow() - FIRST_ENTRY_ROW + 1);
    const featuredRange = rowCount
      ? sheet.getRange(FIRST_ENTRY_ROW, FEATURED_ARTIST_COLUMN, rowCount, 5)
      : null;
    const notes = featuredRange ? featuredRange.getNotes() : [];
    const artists = featuredRange
      ? featuredRange
          .getDisplayValues()
          .map((row, index) => ({
            name: row[0].trim(),
            socialHref: row[1].trim(),
            musicHref: row[2].trim(),
            appleMusicHref: row[3].trim(),
            soundcloudHref: row[4].trim(),
            submissionId: submissionIdFromNote(notes[index][0]),
          }))
          .filter((artist) => artist.name)
      : [];
    return jsonResponse({ ok: true, artists });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error.message || error) });
  }
}

function doPost(event) {
  const lock = LockService.getScriptLock();

  try {
    const payload = JSON.parse(event.postData.contents || '{}');
    const expectedSecret = PropertiesService.getScriptProperties().getProperty('SUBMISSION_SECRET');
    if (!expectedSecret || payload.secret !== expectedSecret) {
      return jsonResponse({ ok: false, error: 'Unauthorized' });
    }
    if (!payload.submissionId || !payload.artistName ||
        ![payload.instagramUrl, payload.spotifyUrl, payload.appleMusicUrl, payload.soundcloudUrl]
          .some((value) => String(value || '').trim())) {
      return jsonResponse({ ok: false, error: 'Missing submission fields' });
    }

    lock.waitLock(10000);
    const sheet = getSheet();

    const finalRow = Math.max(sheet.getLastRow(), FIRST_ENTRY_ROW);
    const idMarker = `Crash Beats submission: ${payload.submissionId}`;
    const existingNotes = sheet
      .getRange(FIRST_ENTRY_ROW, ARTIST_COLUMN, finalRow - FIRST_ENTRY_ROW + 1, 1)
      .getNotes();
    const existingIndex = existingNotes.findIndex((row) => row[0].includes(idMarker));
    if (existingIndex >= 0) {
      return jsonResponse({ ok: true, duplicate: true, row: FIRST_ENTRY_ROW + existingIndex });
    }

    const existingValues = sheet
      .getRange(FIRST_ENTRY_ROW, ARTIST_COLUMN, finalRow - FIRST_ENTRY_ROW + 1, 5)
      .getDisplayValues();
    const emptyIndex = existingValues.findIndex((row) => row.every((value) => !value.trim()));
    const targetRow = emptyIndex >= 0 ? FIRST_ENTRY_ROW + emptyIndex : finalRow + 1;
    const target = sheet.getRange(targetRow, ARTIST_COLUMN, 1, 5);
    sendSubmissionEmail(payload);
    target.setValues([[
      safeCellValue(payload.artistName),
      safeCellValue(payload.instagramUrl || ''),
      safeCellValue(payload.spotifyUrl || ''),
      safeCellValue(payload.appleMusicUrl || ''),
      safeCellValue(payload.soundcloudUrl || ''),
    ]]);

    const songs = Array.isArray(payload.songs)
      ? payload.songs.map((song) => `${song.title} (${song.original_filename})`).join('\n')
      : '';
    target.getCell(1, 1).setNote([
      idMarker,
      `Submitted: ${payload.submittedAt || new Date().toISOString()}`,
      songs ? `Songs:\n${songs}` : '',
    ].filter(Boolean).join('\n'));

    return jsonResponse({ ok: true, row: targetRow });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error.message || error) });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function sendSubmissionEmail(payload = {}) {
  (Array.isArray(payload.songs) ? payload.songs : []).forEach((song) => {
    if (!song.mediaUrl) return;
    const response = UrlFetchApp.fetch(song.mediaUrl, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      throw new Error(`Could not fetch ${song.original_filename}`);
    }
    MailApp.sendEmail({
      to: EMAIL_RECIPIENT,
      subject: `Crash Weekly submission: ${payload.artistName} (${payload.submissionId}) - ${song.original_filename}`,
      body: [
        `Artist: ${payload.artistName}`,
        `Submission ID: ${payload.submissionId}`,
        `Track: ${song.original_filename}`,
        `Instagram: ${payload.instagramUrl || '(blank)'}`,
        `Spotify: ${payload.spotifyUrl || '(blank)'}`,
        `Apple Music: ${payload.appleMusicUrl || '(blank)'}`,
        `SoundCloud: ${payload.soundcloudUrl || '(blank)'}`,
      ].join('\n'),
      attachments: [response.getBlob().setName(song.original_filename || `${song.title}.mp3`)],
    });
  });
}

function authorizeServices() {
  SpreadsheetApp.openById(SPREADSHEET_ID).getName();
  UrlFetchApp.getRequest('https://crash-beats.com/api/health');
  MailApp.getRemainingDailyQuota();
}
