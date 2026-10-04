// Receives signed consent PDFs from the Soutpans consent page.
// Saves each PDF to a Drive folder, logs it in a tracker sheet, and emails a copy.

const FOLDER_NAME = 'Soutpans Road Closure - Consent forms';
const TRACKER_NAME = 'Soutpans consent tracker';
const NOTIFY_EMAIL = 'mcgowanjustin1@gmail.com';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const blob = Utilities.newBlob(Utilities.base64Decode(body.pdf), 'application/pdf', body.filename);
    const folder = getOrCreateFolder_();
    const file = folder.createFile(blob);

    const sheet = getOrCreateTracker_(folder);
    sheet.appendRow([new Date(), body.house, body.address, body.names.join(', '), body.names.length, file.getUrl()]);

    GmailApp.sendEmail(NOTIFY_EMAIL, body.subject,
      `New consent form received.\n\nHouse: ${body.house}\nAddress: ${body.address}\nSigned by: ${body.names.join(', ')}\n\nSaved to Drive: ${file.getUrl()}`,
      { attachments: [blob] });

    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function getOrCreateFolder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function getOrCreateTracker_(folder) {
  const it = folder.getFilesByName(TRACKER_NAME);
  if (it.hasNext()) return SpreadsheetApp.open(it.next()).getSheets()[0];
  const ss = SpreadsheetApp.create(TRACKER_NAME);
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  const sheet = ss.getSheets()[0];
  sheet.appendRow(['Received', 'House', 'Address', 'Signed by', 'Signatures', 'PDF']);
  sheet.setFrozenRows(1);
  return sheet;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
