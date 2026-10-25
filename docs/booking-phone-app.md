# art.pill booking app

The owner app at `/studio/bookings/` uses the existing Studio token. It shows
active, unread, and historical requests, previews private reference files,
and links directly to the matching request in Studio for approval, decline,
and booking-link preparation. Existing email notifications remain enabled.
It also receives owner alerts for new SNY00 RSVPs and opens a private guest list
inside the same installed app.

## iPhone setup

After this commit is deployed through the website's existing Git-connected Worker:

1. Open `https://thesixwellconstruct.com/studio/bookings/` in Safari on iPhone.
2. Tap Share, choose **Add to Home Screen**, leave **Open as Web App** switched
   on if shown, and tap **Add**.
3. Open the **art.pill** icon from the Home Screen.
4. Unlock it with your existing Studio access token. Never send this token in chat.
5. Expand **Phone alerts**, tap **Enable notifications**, and choose **Allow**.
6. Tap **Send test alert**. Close the app, check the notification, and tap it
   to return to the inbox. A real inquiry should also send the existing email.

To preview every message, use **Send all sample alerts** under Phone alerts. The
sample name is prefilled as Sai Solehman and can be changed. This sends 16 samples
to the current device, one at a time, covering every inquiry type and single/group
confirmations, reschedules, cancellations, and an SNY00 RSVP. The RSVP sample shows
an illustrative party size and opens the actual private guest list. Every sample body begins with
**TEST** and has its own notification tag so the samples do not replace one another.
No client, inquiry, appointment, or payment records are created or changed.

First activation creates only this feature's tables and a stable P-256 VAPID
key pair, using the existing D1 binding and authenticated owner session. No
Cloudflare login, API token, migration command, or secret entry is needed on
the phone. Adding another phone reuses the same keys.

Notification permission must be granted by the phone's owner. Delivery respects
the phone's notification and Focus settings. If notifications were previously
blocked, allow them in iPhone Settings before trying again.

**Turn off alerts** removes just the current device. **Lock** clears the
Studio token and client details from view while leaving owner-device alerts on.

## Deployment and administration

- The production branch is `main`; the existing Cloudflare Git connection deploys
  the Worker and static assets. Verify the app URL after the build finishes.
- Migration `0243_booking_push_notifications.sql` records the same additive
  schema installed by owner activation. It can be applied later using the normal
  migration process; it does not modify existing booking or client records.
- VAPID credentials stay server-side in the private D1 settings table. Public-key
  config responses never include the private key. The provider encrypts D1 at rest.
- An explicit `BOOKING_PUSH_ENABLED=false` Worker environment value pauses
  delivery and prevents in-app activation. Remove that override to resume owner setup.
- Existing environment-based VAPID keys remain supported and take precedence
  when `BOOKING_PUSH_ENABLED=true`. Do not rotate keys when adding a phone.

## Delivery and privacy

- Only bearer-authenticated Studio requests can activate alerts, register/remove
  devices, or send a test. Admin tokens never appear in URLs.
- Push HTTPS endpoints are restricted to Apple, Google, Mozilla, and Windows
  services; redirects are rejected. Payloads use RFC 8291 `aes128gcm` encryption
  and RFC 8292 VAPID authentication.
- The phone identifies the app as **art.pill Bookings**. Alert titles state the
  event: **New Custom Inquiry**, **Appointment Booked**, **Appointment Rescheduled**,
  or **Appointment Canceled**, with every word capitalized for other request types too.
  The client name appears underneath, with the Atlanta appointment date and time
  for appointment updates. Group checkouts send one **Appointments Booked** alert
  with the number of appointments and first appointment time.
- At the owner's request, names and appointment times can appear on the lock
  screen. Email addresses, phone numbers, project notes, and access tokens are
  excluded. Tapping opens the matching private request after unlocking when one
  is linked; manually created appointments without a request open the inbox.
- The service worker has no fetch handler or CacheStorage. Client requests use
  `cache: no-store`; private app assets carry `no-store` and `noindex` headers.
- Unique request, appointment-event, and device keys prevent duplicate delivery,
  including repeat payment confirmations and email resends. Each saved reschedule
  has its own event key. Pending deposits do not send booking confirmations. The existing
  five-minute Worker cron retries network errors, rate limits, and temporary server
  failures up to five times. HTTP 404/410 removes expired devices. Other failures stop.
- Sent/failed delivery records expire after 30 days. Push errors do not block email.

## SNY00 RSVP alerts

- A newly saved SNY00 RSVP sends **New RSVP · SNY00** to the existing registered
  owner devices, with the party size. Guest names, emails, and other private
  details are excluded from the alert. Existing keys and subscriptions are reused;
  no reinstall or additional notification permission is needed for a device already enabled.
- Tapping opens `/studio/bookings/?event=sny-00`. If locked, unlock with the
  existing Studio token and the guest list opens automatically. **SNY00 guest list**
  in the inbox also opens it. The list shows confirmed planned headcount and marks
  canceled RSVPs separately; it does not treat an RSVP as actual attendance.
- **Phone alerts → Send RSVP test alert** sends just this sample to the current
  device. It is marked **TEST**, uses an illustrative party size, and creates no RSVP.
- Duplicate form submissions do not trigger another alert. Temporary push-service
  failures use the existing delivery queue and five-minute retry job. Guest
  confirmation email runs independently, so a failure in either channel does not
  prevent the other. Existing RSVPs are not replayed as new alerts.
- Guest-list requests use the existing owner-authenticated event endpoint with
  `no-store`. Locking clears the list from view, including expanded guest contacts.
- This is limited to the SNY00 edition. It does not add alerts to the parent
  Solehman's New Year series or other events, change booking alerts, or add guests
  to the booking inbox or marketing lists.

## Verification

Run `node --test tests/booking-phone-app.test.mjs tests/booking-link-contract.test.mjs`.
Tests exercise real SQLite migrations, owner-only activation on an existing
database, stable key reuse, protected endpoints, pagination, encrypted delivery,
idempotency, retries, expired devices, and service-worker navigation. Run the
normal Wrangler dry build before deployment. Real iPhone delivery requires the
owner's installed app and permission.
