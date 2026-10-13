# VA Tracker

A static dashboard (GitHub Pages) for the VA findings that admins upload in **OnePopHealth → Admin Dashboard → VA**.

It reads `https://pophealth-odc.github.io/onepophealth/data/va.json` live, so a new upload shows here after GitHub Pages updates (usually a few minutes). Click **Refresh** to reload.

## What it shows

- **SLA Status:** findings not yet breached, grouped by days left until the **SLA Deadline**: `< 15`, `< 30`, `< 45`, `< 60` and `> 61` days.
- **SLA Status = Breach:** findings whose SLA deadline has passed.
- **No Remediation Strategy:** findings with a blank **Remediation Strategy**.
- **By ODC Primary:** the same counts per person.
- **Filters:** ODC Primary and System ID (the System ID list narrows to the selected ODC Primary). Both are kept in the URL (`#odc=…&sys=…`), so you can share a filtered link.
- **Colour coding:** Breach is red, `< 15` orange, `< 30` amber, `< 45` cyan, `< 60` blue, `> 61` green and No strategy purple.
- **Dark mode:** use the 🌙 / ☀️ button. The choice is remembered per browser and starts from the system setting.
- **Click any number** to open the full rows. You can search them and click a column header to sort.

Days left are **recalculated from the SLA Deadline against today's date**, so the numbers stay current between uploads. The exported "Days to SLA Breach" column is only used if a deadline can't be read.

## Setup

Go to **Settings → Pages → Deploy from a branch → `main` / `(root)`**. The site is then at `https://kailknight.github.io/VATracker/`.

If the data moves, change `DATA_URL` at the top of `js/app.js`. If the Excel column names change, update `COL` there.
