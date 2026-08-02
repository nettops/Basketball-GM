# Team Logos

Drop team logo image files in this folder to have them appear throughout the UI.

## Naming convention

Each file must be named `{TEAM_ID}.png`, where `TEAM_ID` matches a team's `id` field in
`teams.js` (e.g. `BOS.png` for the Boston Celtics, `LAL.png` for the Lakers).

Recommended: square PNG, transparent background, at least 200x200px.

## Behavior

- No logo files ship with this repo.
- If a file is missing for a given team, the UI falls back to the existing colored
  circle badge (team primary/secondary colors) — no broken-image icons.
- Source your own logo files; this project does not fetch or bundle any.
