// Backend for the Soutpans / Quellerina road-closure pages (Google Apps Script web app).
//
// 1. Consent page (index.html) POSTs a JSON body with a signed PDF  -> saved to Drive, logged, emailed.
// 2. Contribution page (contribute.html) POSTs JSON {kind:'contribution', ...}
//    -> we build + sign the PayFast form server-side so the passphrase never reaches the browser.
// 3. PayFast ITN (notify_url) POSTs form-encoded payment notifications -> verified, logged, emailed.
//
// Script Properties required for PayFast (Project Settings -> Script Properties):
//   PF_MERCHANT_ID   e.g. 10000100 (sandbox) or your live merchant ID
//   PF_MERCHANT_KEY  e.g. 46f0cd694581a (sandbox) or your live merchant key
//   PF_PASSPHRASE    sandbox: jt7NOE43FZPn   live: the passphrase you set under Settings -> Integration
//   PF_SANDBOX       'true' while testing, 'false' when live

const FOLDER_NAME = 'Soutpans Road Closure - Consent forms';
const TRACKER_NAME = 'Soutpans consent tracker';
const CONTRIB_NAME = 'Soutpans contributions';
const NOTIFY_EMAIL = 'mcgowanjustin1@gmail.com';
const SITE_URL = 'https://justin-mcgowan-servaro.github.io/soutpans-consent/';
const TZ = 'Africa/Johannesburg';
const MIN_AMOUNT = 20, MAX_AMOUNT = 5000;

function doPost(e) {
  const raw = (e && e.postData && e.postData.contents) || '';
  if (!raw.trim().startsWith('{')) return handleItn_(raw);          // PayFast ITN is form-encoded
  let body;
  try { body = JSON.parse(raw); } catch (err) { return json_({ ok: false, error: 'Bad JSON' }); }
  try {
    if (body.kind === 'contribution') return json_(signContribution_(body));
    return handleConsent_(body);
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// Lets PayFast (or a browser) hit the notify_url with GET without an error page.
function doGet() { return ContentService.createTextOutput('OK'); }

// ---------------------------------------------------------------- consent ---
function handleConsent_(body) {
  const blob = Utilities.newBlob(Utilities.base64Decode(body.pdf), 'application/pdf', body.filename);
  const folder = getOrCreateFolder_();
  const file = folder.createFile(blob);

  const sheet = getOrCreateTracker_(folder);
  sheet.appendRow([new Date(), body.house, body.address, body.names.join(', '), body.names.length, file.getUrl()]);

  GmailApp.sendEmail(NOTIFY_EMAIL, body.subject,
    'New consent form received.\n\nHouse: ' + body.house + '\nAddress: ' + body.address +
    '\nSigned by: ' + body.names.join(', ') + '\n\nSaved to Drive: ' + file.getUrl(),
    { attachments: [blob] });
  return json_({ ok: true });
}

// ---------------------------------------------------- contribution: sign ---
function pfConfig_() {
  const p = PropertiesService.getScriptProperties();
  const cfg = {
    merchantId: p.getProperty('PF_MERCHANT_ID'), merchantKey: p.getProperty('PF_MERCHANT_KEY'),
    passphrase: p.getProperty('PF_PASSPHRASE') || '', sandbox: p.getProperty('PF_SANDBOX') !== 'false',
  };
  if (!cfg.merchantId || !cfg.merchantKey) throw new Error('PayFast is not configured yet (Script Properties).');
  cfg.host = cfg.sandbox ? 'https://sandbox.payfast.co.za' : 'https://www.payfast.co.za';
  return cfg;
}

function signContribution_(b) {
  const cfg = pfConfig_();
  const first = clean_(b.firstName, 100), last = clean_(b.lastName, 100), email = clean_(b.email, 100);
  const cell = clean_(b.cell, 20).replace(/\s+/g, '');
  const house = clean_(b.house, 100);                                   // e.g. "13 Soutpans"
  const monthly = b.type === 'monthly';
  const amount = Math.round(Number(b.amount));
  const day = Number(b.day);
  if (!first || !last) throw new Error('Name is required.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('A valid email is required.');
  if (!house) throw new Error('House is required.');
  if (!(amount >= MIN_AMOUNT && amount <= MAX_AMOUNT)) throw new Error('Amount must be between R' + MIN_AMOUNT + ' and R' + MAX_AMOUNT + '.');
  if (monthly && !(day >= 1 && day <= 28)) throw new Error('Debit day must be between 1 and 28.');

  const now = new Date();
  const ref = 'SP-' + Utilities.formatDate(now, TZ, 'yyyyMMdd-HHmmss') + '-' + Math.floor(1000 + Math.random() * 9000);
  const amt = amount.toFixed(2);
  let fields = [
    ['merchant_id', cfg.merchantId], ['merchant_key', cfg.merchantKey],
    ['return_url', SITE_URL + 'contribute.html?done=' + (monthly ? 'monthly' : 'once')],
    ['cancel_url', SITE_URL + 'contribute.html?cancelled=1'],
    ['notify_url', ScriptApp.getService().getUrl()],
    ['name_first', first], ['name_last', last], ['email_address', email], ['cell_number', cell],
    ['m_payment_id', ref],
  ];
  let desc, firstDebit = null;
  if (monthly) {
    // Charge nothing today; PayFast tokenises the card and takes the first debit on the chosen day.
    // If the chosen day is today, charge today and set the next debit one month on.
    const today = Number(Utilities.formatDate(now, TZ, 'd'));
    const y = Number(Utilities.formatDate(now, TZ, 'yyyy')), m = Number(Utilities.formatDate(now, TZ, 'M'));
    let initial = '0.00';
    let bd;
    if (day === today) { initial = amt; bd = new Date(y, m, day); }            // next month
    else if (day > today) bd = new Date(y, m - 1, day);                         // later this month
    else bd = new Date(y, m, day);                                              // next month
    firstDebit = Utilities.formatDate(bd, TZ, 'yyyy-MM-dd');
    desc = house + ': R' + amount + ' monthly on day ' + day;
    fields.push(['amount', initial], ['item_name', 'Road closure contribution (monthly)'], ['item_description', desc],
      ['custom_str1', house], ['custom_str2', 'monthly'], ['custom_str3', String(day)],
      ['subscription_type', '1'], ['billing_date', firstDebit], ['recurring_amount', amt], ['frequency', '3'], ['cycles', '0']);
  } else {
    desc = house + ': once-off R' + amount;
    fields.push(['amount', amt], ['item_name', 'Road closure contribution (once-off)'], ['item_description', desc],
      ['custom_str1', house], ['custom_str2', 'once'], ['custom_str3', '']);
  }
  fields = fields.filter(function (f) { return f[1] !== '' && f[1] != null; });   // PayFast: omit blank variables
  const sig = md5_(paramString_(fields) + (cfg.passphrase ? '&passphrase=' + pfEncode_(cfg.passphrase) : ''));
  fields.push(['signature', sig]);

  contribSheet_().appendRow([now, 'Started', monthly ? 'monthly' : 'once', house, first + ' ' + last, email, cell,
    amount, monthly ? day : '', firstDebit || '', '', '', '', ref, '', cfg.sandbox ? 'sandbox' : 'live']);

  return { ok: true, action: cfg.host + '/eng/process', fields: fields, firstDebit: firstDebit, ref: ref };
}

// ------------------------------------------------------ contribution: ITN ---
function handleItn_(raw) {
  const out = ContentService.createTextOutput('OK');
  try {
    const cfg = pfConfig_();
    const pairs = raw.split('&').filter(Boolean).map(function (kv) {
      const i = kv.indexOf('=');
      const k = decodeURIComponent(kv.slice(0, i < 0 ? kv.length : i).replace(/\+/g, ' '));
      const v = decodeURIComponent((i < 0 ? '' : kv.slice(i + 1)).replace(/\+/g, ' '));
      return [k, v];
    });
    const d = {};
    pairs.forEach(function (p) { d[p[0]] = p[1]; });
    const noSig = pairs.filter(function (p) { return p[0] !== 'signature'; }).map(function (p) { return [p[0], p[1].trim()]; });
    const str = paramString_(noSig);
    const expected = md5_(str + (cfg.passphrase ? '&passphrase=' + pfEncode_(cfg.passphrase) : ''));
    const sigOk = expected === (d.signature || '').toLowerCase();
    let serverOk = false;
    try {
      const res = UrlFetchApp.fetch(cfg.host + '/eng/query/validate',
        { method: 'post', payload: str, contentType: 'application/x-www-form-urlencoded', muteHttpExceptions: true });
      serverOk = res.getContentText().trim() === 'VALID';
    } catch (e) { serverOk = false; }
    const merchantOk = String(d.merchant_id) === String(cfg.merchantId);
    const verdict = (sigOk && serverOk && merchantOk) ? 'verified'
      : 'UNVERIFIED (sig ' + sigOk + ', server ' + serverOk + ', merchant ' + merchantOk + ')';

    const name = ((d.name_first || '') + ' ' + (d.name_last || '')).trim();
    contribSheet_().appendRow([new Date(), d.payment_status || '?', d.custom_str2 || '', d.custom_str1 || '', name, d.email_address || '', '',
      Number(d.amount_gross || 0), d.custom_str3 || '', d.billing_date || '', Number(d.amount_fee || 0), Number(d.amount_net || 0),
      d.token || '', d.m_payment_id || '', d.pf_payment_id || '', verdict]);

    const subject = 'Road closure contribution: ' + (d.payment_status || '?') + ' R' + (d.amount_gross || '0') + ' from ' + (d.custom_str1 || name);
    GmailApp.sendEmail(NOTIFY_EMAIL, subject,
      'PayFast notification (' + verdict + ').\n\n' +
      'House: ' + d.custom_str1 + '\nName: ' + name + '\nEmail: ' + d.email_address +
      '\nType: ' + d.custom_str2 + (d.custom_str3 ? ' on day ' + d.custom_str3 : '') + '\n' +
      'Status: ' + d.payment_status + '\nGross: R' + d.amount_gross + '  Fee: R' + d.amount_fee + '  Net: R' + d.amount_net + '\n' +
      'Subscription token: ' + (d.token || '-') + '\nNext billing date: ' + (d.billing_date || '-') +
      '\nReference: ' + d.m_payment_id + ' / PayFast ' + d.pf_payment_id);
  } catch (err) {
    try { GmailApp.sendEmail(NOTIFY_EMAIL, 'Road closure contribution: ITN error', String(err) + '\n\n' + raw); } catch (e2) {}
  }
  return out;
}

// --------------------------------------------------------------- helpers ---
// PHP urlencode() style: spaces as '+', upper-case hex, and !'()* encoded.
function pfEncode_(v) {
  return encodeURIComponent(String(v)).replace(/%20/g, '+')
    .replace(/[!'()*]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); });
}
function paramString_(pairs) {
  return pairs.map(function (p) { return p[0] + '=' + pfEncode_(String(p[1]).trim()); }).join('&');
}
function md5_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function clean_(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max); }

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

function contribSheet_() {
  const folder = getOrCreateFolder_();
  const it = folder.getFilesByName(CONTRIB_NAME);
  if (it.hasNext()) return SpreadsheetApp.open(it.next()).getSheets()[0];
  const ss = SpreadsheetApp.create(CONTRIB_NAME);
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  const sheet = ss.getSheets()[0];
  sheet.appendRow(['When', 'Event', 'Type', 'House', 'Name', 'Email', 'Cell', 'Amount', 'Debit day', 'Billing date',
    'Fee', 'Net', 'Token', 'Reference', 'PayFast ID', 'Check']);
  sheet.setFrozenRows(1);
  return sheet;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Run once from the editor to eyeball the signature string format (spaces as +, upper-case hex).
function testSignature_() {
  const s = paramString_([['name_first', 'John'], ['name_last', 'Doe'], ['email_address', 'john@example.com'],
    ['amount', '100.00'], ['item_name', 'Test Product & co']]);
  Logger.log(s);
  Logger.log(md5_(s + '&passphrase=' + pfEncode_('jt7NOE43FZPn')));
}
