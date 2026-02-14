# FEH Barracks Launcher (Windows EXE)

This launcher installs/updates a local runnable copy of FEH Barracks Manager from GitHub Releases, including optional heavy asset bundle.

## What it does

- Creates install folder **next to the launcher EXE**:
  - `<folder-containing-exe>/FEH-Barracks-Manager`
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

## User Flow (Default)

1. Run `FEH-Barracks-Launcher.exe`
2. Launcher automatically:
   - checks latest GitHub release,
   - installs/updates if needed,
   - launches app locally.
3. Open `http://localhost:3000`

If `.env.local` is missing, launcher copies from `.env.example` and asks user to fill Supabase values first.

## Advanced Menu (Optional)

For manual control / troubleshooting, run launcher with:

```powershell
FEH-Barracks-Launcher.exe --advanced
```

or

```powershell
FEH-Barracks-Launcher.exe --menu
```

This opens the old interactive menu (Install/Update, Launch, Status, Exit).

## Default Update Source (Simple Mode)

Launcher now defaults to this repo's releases:
- owner: `Gogo-Fogo`
- repo: `FEH-barracks-manager`

That means no extra distro-repo setup is required.

To publish a new launcher/app bundle release, just push a tag (`v*`) and the workflow uploads assets.

Optional override source (advanced only):

```powershell
$env:FEH_RELEASE_OWNER = "your-owner"
$env:FEH_RELEASE_REPO = "your-repo"
```

## Notes

- This is Windows-first v1 launcher.
- Update source is GitHub Releases of this repository.
- For production web-only usage (without local asset package), Vercel remains available but may not include full heavy local art.
