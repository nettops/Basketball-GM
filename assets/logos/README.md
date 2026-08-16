# Team Logos

Drop team logo image files in this folder to have them appear throughout the UI.

## Naming convention

Each file must be named `{TEAM_ID}.png`, where `TEAM_ID` matches a team's `id` field in
`teams.js` (e.g. `BOS.png` for the Boston Harbormen, `LAL.png` for the Los Angeles
Monarchs).

Recommended: square PNG, transparent background, at least 200x200px.

## Behavior

- No logo files ship with this repo.
- If a file is missing for a given team, the UI falls back to the existing colored
  circle badge (team primary/secondary colors) — no broken-image icons.
- Source your own logo files; this project does not fetch or bundle any.

## Why this folder is empty

It was not always. Thirty NBA team logos were committed here, directly beneath a
README that already claimed no logo files shipped — the note was aspirational and
the folder disagreed with it. They have been deleted, along with the NBA team
names they went with: the teams in `teams.js` are invented now, keeping the real
city so market size and prestige still mean something.

Those logos are club trademarks, and the image files are their owners'
copyrighted artwork besides. Nothing about the fallback changed, because it was
built for exactly this case from the start — the colored badge is now simply what
everyone sees unless they bring their own art.
