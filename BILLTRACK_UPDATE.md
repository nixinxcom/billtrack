# BillTrack payment-cycle update

This version adds monthly/one-time commitments, per-cycle payment tracking, overdue status, actual paid date/amount, 12-cycle display, editable profile categories, and monthly expected/paid/overdue summaries.

## Required Firestore rules deployment
The new `occurrences` and `categories` subcollections require the included `firestore.rules`.

Run after deploying the app:

```powershell
firebase deploy --only firestore:rules
```

## Existing commitments
Existing commitments remain readable. When opened under this version, BillTrack creates their occurrence documents using the legacy monthly due-day behavior.

## Push notifications
Reminder preferences are still stored, but FCM/Web Push delivery is not implemented in this update.
