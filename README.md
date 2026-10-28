# EHL Christmas Light Quote

Phone web app for Extreme Home Lighting LLC. Paste a customer's address, get the Street View photo of the house, let the AI draw the three light packages, adjust them, and text the customer one quote with mock-up pictures.

Two kinds of quote, picked at the top of step 2:

- **Christmas lights**: three packages of C9 bulbs (roofline, + ridges and hips, + wrapped bushes and trees). The AI traces each bush's outline and counts the mini-light strands; tap a bush to move, reshape, resize it or change its strands.
- **Permanent lights**: an LED track under the gutters, priced per foot. Pick the light spacing and any of the color displays (holidays, game day, custom colors); each checked display gets its own mock-up picture.

**Follow up list**: every quote you text, share or copy goes on a list at the top of the app until you tap Won or Lost. After 3 days with no word it's marked due, and its Text button opens a ready-made check-in message. The list stays on the phone; "Copy this list for Claude" turns it into text to paste into Claude.

The mock-up pictures use a **Night look** (on by default, switch under the photo): the photo turns to dusk and the lights re-light the house around them. Every picture carries an Extreme Home Lighting LLC bar with the logo, phone and price, plus a small "Designed by" mark.

## How it's hosted

Plain static files (no build step), served by GitHub Pages from the `main` branch.

## Keys

The app needs two keys, entered once in the app's **Settings** on the phone. They are saved only in that phone's browser and are never stored in this repository.

- Google Maps key: Street View Static API, Geocoding API.
- Anthropic API key: AI drawing (Claude Opus 5.5).

## Files

- `index.html`: the whole app.
- `manifest.webmanifest`, `icon-*.png`: home-screen icon.
- `sample.jpg`: sample house for trying the app.
- `examples/`: Corbin's own hand-made mock-ups, sent to the AI with each drawing so it lights houses his way.
