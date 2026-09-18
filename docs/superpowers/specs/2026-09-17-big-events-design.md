# Big Events — design

Written 2026-09-17.

## The problem

NearMe's feed is deliberately local: the default radius is 5 miles. That means a
subscriber in Boca Raton never sees a Heat game, a Panthers playoff night, a
Dolphins home game, or Bad Bunny at Kaseya Center — all of which are inside an
hour's drive and are exactly the kind of thing someone browsing "what's going
on" wants to know about.

## What we're building

A "Big Events" section: major sports and major concerts within about 75 miles,
over the next 14 days. It appears twice — as a row on Discover and as its own
tab.

### Reach: 75 miles

A 1 to 1.5 hour drive. From Boca that covers Miami (Kaseya Center, Hard Rock
Stadium, loanDepot Park), Sunrise (Amerant Bank Arena) and West Palm Beach, and
stops short of Orlando and Tampa.

### Window: 14 days

The app is about what's happening now, not a ticket marketplace. Anything past
two weeks is somebody else's product.

### What counts as "big"

**Sports — a fixed league list, no guessing.** NFL, NBA, NHL, MLB, MLS and
international soccer, NCAA FBS football and D1 basketball, UFC, boxing, WWE and
AEW, F1 and NASCAR, ATP/WTA tennis, PGA golf. Ticketmaster reports these in the
`genre` and `subGenre` of an event's classification, so the check is a lookup.

**Music, comedy and shows — touring act at a large venue.** Ticketmaster has no
popularity score, but it does report how many upcoming dates each attraction
has. An act with 15 or more upcoming dates is on a real tour. Combined with a
venue that reads as an arena, stadium, amphitheater or large theater, that
separates a national tour from a local band whose bar gig happens to be
ticketed. Festivals (Rolling Loud, Ultra) qualify on the festival signal alone.

The threshold is a constant, tunable in one place.

## How the data gets in

The existing `sync-location` function makes one extra Ticketmaster call per
sync: 75-mile radius, 14-day window, restricted to the big classifications.
Results run through the same adult filter, tag generator and dedupe as every
other source and are written to the `events` table with a `big_event` tag.

This means the event detail screen, saving, reminders and the tickets link all
work with no new code, because they read from that table.

Cost: 1–3 extra Ticketmaster calls per sync against a 5,000/day quota.

**Rejected: a live `big-events` function the app calls directly.** Fresher, but
the events wouldn't live in the table, so opening, saving or setting a reminder
on one would each need a parallel implementation. More code, worse result.

**Rejected for v1: ESPN pro-league schedules.** ESPN's scoreboard endpoint has
no working date-range parameter (verified 2026-09-17: `?dates=A-B` returns zero
events for NBA, NHL, NFL, MLB and MLS), so covering 14 days would cost 70
requests per sync. Ticketmaster already lists pro games, since that's where the
tickets are sold. If deployed logs show real gaps, revisit with per-team
schedule endpoints.

## The screens

**Tab.** A fifth tab, "Big", between Map and Saved, ticket icon. Chips for All /
Sports / Concerts / Shows. Full-width cards grouped by Today, Tomorrow, This
week, Next week. Each card shows artwork, a league or tour badge, venue with
city and distance, day and time, and starting price when available.

**Row on Discover.** "Big Events" horizontal row after the first rows, up to 10
soonest, "See all ›" in the header opens the tab.

**Keeping it full.** Under 5 results at 75 miles widens to 150 before any empty
state appears. The row hides itself rather than rendering empty. Consistent with
the existing pack-the-feed rule.

Big events near the user (a Heat game when you're in Miami) also appear in the
normal feed. That's intended: the section means "the big stuff", not "the far
stuff".

## Testing

Unit tests for the classifier: an NBA game qualifies; a local band at a bar does
not; a 30-date arena tour does; a festival does; an event missing attraction
data falls back to the venue signal rather than crashing. Unit tests for the
grouping helper and the widening fallback.
