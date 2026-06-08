# Brand / Medium Hierarchy Plan

## Summary
- Keep medium heroes loud, but let owned brands carry authority through a separate brand layer.
- Merch default state becomes brand-first: hero reads `SIX.WELL.` while still showing all merch products.
- Source filters make the commerce pathway explicit: all non-six.well filters change the hero to `MERCH.` in that source color.
- Tattoo keeps `TATTOOS.` as the hero and gains a dedicated `Art.Pill Tattoo House` brand band below the hero.

## Key Changes
- Update merch hero state logic in the catalog script:
  - Initial/all state: hero word `SIX.WELL`, orange merch/six.well color, all products visible, default descriptor remains `everything sellable from the construct`.
  - `six.well clothing` filter: hero word stays `SIX.WELL`, grid filters to six.well items, descriptor uses the six.well source statement.
  - Other source filters: hero word becomes `MERCH`, color uses selected source color, descriptor uses selected source statement.
  - Clicking `all` returns to the default `SIX.WELL` state.
- Add a six.well placeholder product in storefront config:
  - Title: `SIX.WELL CLOTHING`
  - Source: `six.well`
  - Type: `apparel`
  - State: coming soon / unavailable
  - Purpose: makes the `six.well clothing` filter visible now, before live Shopify products exist.
- Add a Tattoo brand band below the hero:
  - Keep hero label + `TATTOOS.` unchanged.
  - Move/refit the current `Art.Pill Tattoo House` studio paragraph into the band.
  - Use the band to emphasize brand identity: studio, artist, location, skin-tone/color-work focus, ritual tone.
  - Leave the rest of the collaboration/pathway sections intact.

## Implementation Notes
- Touch only the merch index behavior/config and tattoo index presentation.
- Reuse existing filter/rendering patterns; do not introduce a new routing model or data schema.
- Preserve current source color behavior for cards, chips, cart rows, and product metadata.
- Keep the `six.well clothing` source as a source filter, not a separate product type filter.

## Test Plan
- Load `/merch/`:
  - Hero reads `SIX.WELL.`
  - All products are visible, including the six.well placeholder.
  - `six.well clothing` filter appears.
- Click filters:
  - `six.well clothing` keeps hero as `SIX.WELL.`
  - `thoughtpuppet` changes hero to `MERCH.` in art/source blue.
  - `art.pill Tattoo Supply` changes hero to `MERCH.` in tattoo/source red.
  - `all` returns hero to `SIX.WELL.` and shows all products.
- Load `/tattoos/`:
  - Hero still reads `TATTOOS.`
  - `Art.Pill Tattoo House` has a dedicated brand band below the hero.
  - Mobile layout does not overlap or crush the band/hero.

## Assumptions
- `SIX.WELL.` should keep the same display scale as the current `MERCH.` hero.
- The dot punctuation remains part of the hero word treatment.
- The six.well placeholder can be removed or replaced once real Shopify products arrive with `source:six.well` or `venture:six.well`.
