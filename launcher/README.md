# FEH Barracks Launcher (Windows EXE)

This launcher installs/updates a local runnable copy of FEH Barracks Manager from GitHub Releases, including optional heavy asset bundle.

## What it does

- Creates install folder at: `C:\Users\<you>\FEH-Barracks-Manager`
- Downloads latest release bundles from:
  - `feh-app-bundle.zip` (required)
  - `feh-assets-bundle.zip` (optional, for heavy local assets)
- Extracts bundles into install folder
- Runs `npm ci` inside installed `app/`
- Lets user launch local app (`npm run dev`)

## Expected GitHub Release Assets

Each release should include:

1. `feh-app-bundle.zip`
   - Must contain `app/` folder (with `package.json`)
2. `feh-assets-bundle.zip` (optional but recommended for full local art)
   - Should contain relevant `db/` asset folders/manifests needed by API routes

If assets zip is missing, launcher keeps existing local assets.

## Build EXE (dev machine)

From repo root:

```powershell
npm --prefix launcher install
npm --prefix launcher run build
```

Output:

- `dist/FEH-Barracks-Launcher.exe`

## User Flow

1. Run `FEH-Barracks-Launcher.exe`
2. Choose `1) Install / Update from GitHub Release`
3. Choose `2) Launch app locally`
4. Open `http://localhost:3000`

On first launch, if `.env.local` is missing, launcher copies from `.env.example` and asks user to fill Supabase values.

## Notes

- This is Windows-first v1 launcher.
- Update source is GitHub Releases of this repository.
- For production web-only usage (without local asset package), Vercel remains available but may not include full heavy local art.
