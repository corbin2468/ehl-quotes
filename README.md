# EHL Christmas Light Quote

Phone web app for Extreme Home Lighting LLC. Paste a customer's address, get the Street View photo of the house, let the AI draw the three light packages, adjust them, and text the customer one quote with mock-up pictures.

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
