This release rolls up the intended `v0.3.6` and `v0.3.7` changes after the GitHub release workflow was fixed.

## Highlights

- Backfilled 6 missing heroes into the catalog: `Tiki - Everlasting Voice`, `Eirika - Spring Company`, `Thórr - Spring War God`, `Sothe - In the Breeze`, `Dorothea - Rosy Songstress`, and `Byleth - Of the Academy`.
- Hardened hero discovery and recovery by backfilling from the Fandom full hero catalog, adding `Category:Heroes` fallback coverage, and preventing the maintenance updater from truncating the existing index.
- Fixed recent-hero production mismatches by prioritizing the committed Fandom slug map, bundling recent hero unit data for hosted builds, and correcting recent portrait/headshot route resolution.
- Improved the hero detail experience on mobile with tighter spacing, wrapping action buttons, larger carousel tap targets, and less overflow in build sections.
- Stabilized launcher packaging and GitHub release automation on Linux CI with the required Wine/Xvfb setup and a safer Electron build command.

## Included Release Assets

- `FEH-Barracks-Launcher.exe`
- `feh-app-bundle.zip`
- `feh-assets-full-bundle.zip`
- `feh-node-runtime.zip`
- `feh-assets-bundle.zip`
- `feh-runtime-config.json`
