# Claim receipt theme check — iOS Development Simulator

On 2026-11-26, the existing Development iPhone 17 Pro client (`co.drapeon.app.dev`, runtime 1.0.4) loaded the branch through Metro against `pqptfuqogvrajozfsqzi`. I opened an existing completed Development receipt by ID, with no claim token or new claim link.

- [Light appearance](claim-receipt-light-2026-11-26.png): completed receipt and payout hand-off rendered with the light palette.
- [Dark appearance](claim-receipt-dark-2026-11-26.png): receipt shell, title, and payout hand-off rendered with the dark palette; the hidden-route tab bar stayed hidden. The receipt lookup was still showing its loading indicator at capture time, so this image proves the appearance change rather than a second receipt fetch.

The route now applies the system appearance only while focused and restores the app's light-first setting on blur. The contract test checks this focus lifecycle, palette use, and hidden receipt tab bar. No Production action was taken.
