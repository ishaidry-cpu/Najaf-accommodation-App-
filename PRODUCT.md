# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Reception and accommodation staff of Faiz-e-Husaini in Najaf. They work at a desk through the day and on a
phone while walking the buildings. Two access levels on a device: Admin (can edit) and Receptionist (view
only), switched with a PIN. Their job: give every arriving zair a room, keep the rooms in step with NKERP, and
hand tour operators and zaereen the right information.

## Product Purpose

One place to run zaereen accommodation in Najaf: who is arriving and leaving, which of the 125 rooms in
Burhani, Saifee, Badri and Mohammedi are free, which family goes where, and what has been sent to NKERP. It
replaces a shared spreadsheet. Success is every zair roomed before arrival, families kept together, no room
double-booked, and NKERP matching what reception decided.

## Positioning

It works family by family and tour by tour against NKERP's live data, with an AI planner that proposes rooms
from the office's own allocation habits and standing rules, and it never writes to NKERP until staff press
Sync.

## Operating Context

- NKERP is the upstream system. The app pulls applicants, stays and room allocations every minute and on
  demand, and pushes allocations only through **Sync to NKERP** (preview first, then apply).
- Screens: Overview, Zaereen, Rooms, AI Planner, Approvals (Najaf and Karbala tour approvals), B→A shifts
  (category upgrades and accounts slips), NKERP sync, Najaf emails.
- Printed and PDF documents: arrival slip, departure list, tour manifest, B→A and A→B accounts slips.
- Hosted as the Cloudflare Worker `najaf-accommodation`; opens without a sign-in.

## Capabilities and Constraints

- Terminology staff use and the interface keeps: zair / zaereen, Tour ID, family (F-1, F-2 …), ITS, office,
  Category A / B, B→A shift, allot, switch room, portal upload, Nizam, Faiz.
- Everyone in these four buildings is Category A. Only one family shares a room unless staff choose otherwise.
- Receptionist access is view only and limited to Overview, Rooms, Print slips (arrival and departure) and Tour
  manifest; every other screen and control is hidden.
- Najaf stays default to a 10:00 AM arrival and an 8:00 AM departure unless changed in the app.
- Printed slips must keep fitting A4.

## Brand Commitments

- Name: Faiz-e-Husaini (فيض حسيني). The round emerald-and-gold crest (`public/crest-192.jpg`, master in
  `src/assets/images/`) is the identity and stays.
- Emerald and gold, taken from the crest.

## Evidence on Hand

Live data from NKERP. No marketing claims, testimonials or pricing exist and none should be invented.

## Product Principles

1. The room decision is the work: show who needs a room and what is free before anything else.
2. Nothing reaches NKERP by surprise: previews, confirmations and a visible history.
3. Families and tours are the unit, not single rows.
4. Colour means state. If it does not mean anything, it is neutral.
5. Usable on a phone in a corridor.

## Accessibility & Inclusion

WCAG 2.1 AA is the target: 4.5:1 text contrast, visible keyboard focus, 12px minimum text on screen, touch
targets of 40px or more on phones, motion off under `prefers-reduced-motion`.
