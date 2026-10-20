# Apps Script backend: setup notes

`Code.gs` runs as a Google Apps Script web app (project "Soutpans consent", mcgowanjustin1@gmail.com).
It serves both pages:

- `index.html` (consent form) posts a signed PDF. Unchanged behaviour.
- `contribute.html` (contributions) asks the script to build and sign a PayFast form, then the browser posts that form to PayFast. PayFast's ITN notifications also come back to the same script URL.

Secrets live in Script Properties, never in the repo or the page.

## 1. Paste the code

Open the script project, replace the contents of `Code.gs` with this repo's `apps-script/Code.gs`, save.

## 2. Script Properties (Project Settings, gear icon, "Script Properties")

Start with the PayFast sandbox. Use **your own sandbox credentials**, not the shared test merchant
10000100 printed in PayFast's docs: as of 2026-10-20 the sandbox rejects PayFast's own documented example
with those credentials ("Generated signature does not match"), so they are stale.

1. Go to https://sandbox.payfast.co.za and log in with the email of your PayFast Individual account
   (it creates a sandbox merchant for you).
2. Settings, Integration: copy the sandbox Merchant ID and Merchant Key and set a Security Passphrase.
3. Script Properties:

| Property | Sandbox value |
|---|---|
| `PF_MERCHANT_ID` | sandbox merchant ID |
| `PF_MERCHANT_KEY` | sandbox merchant key |
| `PF_PASSPHRASE` | the sandbox passphrase you set |
| `PF_SANDBOX` | `true` |

If the sandbox login gives trouble, skip it: the signing code is verified byte-for-byte against PayFast's
documented example, so go straight to live (section 5) and do the R20 self-test there.

## 3. Deploy a new version

Deploy, Manage deployments, pencil icon on the existing deployment, Version: New version, Deploy.
The `/exec` URL stays the same, so both pages keep working. (A new deployment instead of a new version would change the URL.)

The first run that touches Drive/Gmail/UrlFetch may ask you to re-authorise the script.

## 4. Sandbox test

1. Open https://justin-mcgowan-servaro.github.io/soutpans-consent/contribute.html
2. Monthly, R150, pick a day a few days from now, your own email. Continue.
3. On the PayFast sandbox page pay with the sandbox buyer wallet or test card it offers.
4. Expect: redirect back to the thank-you page; a row in the Drive sheet "Soutpans contributions" ("Started", then "COMPLETE" with Check = verified); an email to you.
5. Also run a once-off and a cancel (cancel button on the PayFast page lands on the "Payment cancelled" screen).

If the "COMPLETE" row never appears but the payment shows in the sandbox dashboard, the ITN did not reach the script (Apps Script answers with a redirect, which PayFast's notifier may not follow). The subscription still works; only the automatic tracker row is missing. Fallback: PayFast dashboard, Recurring billing, export.

## 5. Go live

In the PayFast dashboard (Individual account, Justin McGowan): Settings, Integration.
Copy Merchant ID and Merchant Key, set a Security Passphrase (required for subscriptions), save.

Update Script Properties:

| Property | Live value |
|---|---|
| `PF_MERCHANT_ID` | from dashboard |
| `PF_MERCHANT_KEY` | from dashboard |
| `PF_PASSPHRASE` | the passphrase you set |
| `PF_SANDBOX` | `false` |

No redeploy is needed for a property change. Do one real R20 monthly test on your own card, then cancel it under Recurring billing.

## How a monthly contribution is set up

- Initial `amount` is `0.00` so nothing is charged at sign-up; PayFast tokenises the card.
- `billing_date` is the next occurrence of the chosen day (1 to 28). If the chosen day is today, today is charged and billing continues next month.
- `recurring_amount` is the chosen amount, `frequency=3` (monthly), `cycles=0` (until cancelled).
- Cancel or pause from the PayFast dashboard, Recurring billing; the payer gets an email.

Tracker columns ("Soutpans contributions" sheet, same Drive folder as the consent forms): When, Event (Started / COMPLETE / CANCELLED), Type, House, Name, Email, Cell, Amount, Debit day, Billing date, Fee, Net, Token, Reference, PayFast ID, Check.
