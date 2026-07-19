> Status: draft | Audience: anyone designing or building the field-weather card | See also: [Audio.md](Audio.md), [Personas.md](Personas.md), [../development/TechStack.md](../development/TechStack.md), [../../README.md](../../README.md)

# Field Weather

This document covers the field-weather card: current conditions and a short forecast for the airfield being tracked, shown alongside the ATC audio streams.
It is written in product terms; where a mechanism is load-bearing it links to [../development/TechStack.md](../development/TechStack.md) rather than naming the machinery here.

## Intent

Air traffic at an airshow does not run at a steady pace — it runs at whatever pace the sky allows.
When ceiling or visibility drops below what a VFR arrival needs, inbound traffic simply stops, the frequencies the operator is listening to go quiet, and the airfield waits.
Someone watching the audio panel alone cannot tell *why* the radios went silent, or when they are likely to come back to life.

The field-weather card answers that question at a glance: what the field is doing right now, in the same plain VFR/MVFR/IFR/LIFR language pilots and controllers already use, and what it is forecast to do next.
"IFR now, expected to improve to VFR after 18Z" is the sentence this card exists to let the operator read in a couple of seconds, without leaving the app or decoding a raw report by hand.

## Features

- **Current conditions at the tracked airfield.**
  The card shows the field's most recent observation: how old it is, and a plain-language summary of wind, visibility, and ceiling.
  The raw report text is available too, for anyone who wants to read it directly, but reading it is never required to understand the current state.
- **Flight category as the primary visual signal.**
  Every observation and every forecast period carries one of the four standard flight categories — VFR, MVFR, IFR, LIFR — shown as a large, color-coded badge that is the card's dominant visual element.
  The category is what an operator glancing across the room needs to register first; everything else on the card supports that one judgment.
- **A short forecast timeline.**
  Alongside current conditions, the card shows the field's near-term forecast as a sequence of periods, each with its own time window and flight category.
  The period whose category first improves on current conditions is called out specifically — "VFR expected ~18Z" — so the operator does not have to scan the whole timeline to find the answer to "when do arrivals resume?"
- **A refresh cadence measured in minutes, not seconds.**
  Field conditions change on the order of minutes, not moment to moment, so the card refreshes on a similar cadence rather than polling continuously.
  The operator can also refresh on demand when they specifically want the latest read.
- **Graceful degradation when the data source is unreachable.**
  A weather source outage never blanks the card or breaks the app.
  The card keeps showing the last conditions it successfully retrieved, clearly marked as stale once they run well past due for a refresh, until a fresh read succeeds again.

## Risks and known limitations

- **Forecast periods are shown as reported, without extra interpretation of temporary versus sustained conditions.**
  A forecast period marked as a temporary or probabilistic condition is shown with its own category and time window like any other period, rather than being visually distinguished from a sustained ("becoming") change.
  This is a simplification, not a loss of information — the underlying report is always available — but a careful reading of the raw forecast text remains the authority for a temporary-condition nuance the category timeline does not call out on its own.
- **The category shown is always derived from ceiling and visibility, never taken as given.**
  This keeps the judgment consistent and independent of any one weather source's own labeling, but it also means the app's category can occasionally read a notch different from a human forecaster's own call in an edge case, the same way any two careful readers of the same raw report might.
- **One tracked airfield, not a regional picture.**
  The card reports conditions at the single airfield the app is configured for; it does not cover alternates or the surrounding area.
- **A single data source, not a redundant pair.**
  Today the card depends on one weather data source; a second, independent source to fail over to is a future improvement, not something the alpha provides (planned, not built).

## Expected outcomes

These are the observable acceptance criteria for the field-weather card:

- **The current flight category is readable at a glance,** from across the room, without reading any text.
- **"When do arrivals resume?" has a direct answer on screen** — the next forecast period that improves on current conditions, with its expected time.
- **A weather-source outage degrades gracefully:** the card keeps its last-known conditions visible and clearly marked stale, never goes blank, and recovers on its own once the source is reachable again.
- **The refresh cadence matches how fast field conditions actually change** — minutes, not a noisy real-time feed.
