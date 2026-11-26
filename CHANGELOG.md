# Changelog

Every version of the Amazon Luna add-on for Batocera and HippOS. Each version is a git tag; install one with `LUNA_REF=<tag>` (see the README).

## 1.0.9

- **" Amazon Luna Settings" in luna's game list**, right under " Amazon Luna": it opens the app's settings screen straight away, like the F1 > Applications shortcut. It's left out only when Launch Single Game opens the app the moment luna is picked (that needs a single entry, and the list isn't seen then).
- **Adding a game to "Games I pick" with the controller is now LT + RT (L2 + R2)**, held for a second on the game's Luna page (was LB + RB + LT + RT). It never fires while a game is streaming, so holding both triggers in a game is safe. F8 still works.

## 1.0.8

- **Fixes Luna's "Unsupported OS" when starting a game.** The user agent already said Chrome on Windows, but pages could still see Linux in `navigator.platform`, and `navigator.userAgentData` was missing altogether (no current Chrome lacks it). Every page, every frame from another site (sign-in, the game) and every background worker is now told it's Google Chrome on 64-bit Windows 11: user agent, `navigator.platform`, `navigator.userAgentData` and the `Sec-CH-UA` headers all agree.

## 1.0.7

- **3D game boxes are back** (Settings → EmulationStation game list → 3D game boxes). Each case is drawn from the game's own picture on Luna, with the round Luna logo and AMAZON LUNA on top and the game's name on the spine. Only pictures that fit a case get one (a tall cover that loses at most a fifth of its width or height); a game with a wide banner picture keeps its flat picture. Drawn by `gamebox3d.py` with Pillow, or by the app itself when Pillow isn't there.

## 1.0.7

- **3D game boxes are back** (Settings → EmulationStation game list → 3D game boxes). A game whose Luna picture fits a game case (a tall cover, losing at most a fifth of it) gets a black case with the Amazon Luna header, a purple line and its name on the spine; a game with a wide picture keeps its flat one. Drawn on the device from Luna's own pictures (with Pillow, or by the app when Pillow isn't there); nothing else is downloaded.

## 1.0.6

- **HippOS: themes added later get the carousel art.** EmulationStation runs `luna-theme-art.sh` when it starts (from `/userdata/system/configs/emulationstation/scripts/start/`). It only touches `/userdata/themes`, never replaces a file a theme already has, and stops at once when no theme has changed since the last time. HippOS's built-in themes ship the luna art themselves. The uninstaller removes what it added.

## 1.0.5

- **Pinned installs stay pinned.** Installed with `LUNA_REF=<tag>`, Settings → Updates follows that tag instead of main (saved in `update-ref`, like the Xbox Cloud Gaming app), and applying an update keeps the pin. Installing without `LUNA_REF` goes back to following main.
- **Shares an Electron that's already on the device** (Batocera and HippOS): another add-on's, or an app BUA installed unpacked, found in `/userdata/system/add-ons`. Its files are hard-linked, so nothing is downloaded and no extra space is used. Engine updates use it too when it's at least as new; otherwise they download as before. The installer only mentions it when a copy is really there. `LUNA_NO_SHARED_ELECTRON=1` turns this off.

## 1.0.4

- **HippOS: nothing goes into the system area any more.** No `sudo` copy of the carousel logo into HippOS's built-in theme (HippOS ships the luna art itself) and no `apt-get`; the start script earlier versions added is removed. If the browser engine lacks a library, the installer names the Debian packages to report instead.
- **Fixed versions:** every version is a git tag; `LUNA_REF=<tag>` installs exactly that one.
- **MIT license** added.

## 1.0.3

- **One-command install, straight from the repository.** `curl -fsSL https://raw.githubusercontent.com/rmach89/luna-batocera-hippos/main/install.sh | bash` works out whether it's on Batocera or HippOS, downloads the newest version of the repository's main branch, installs it and cleans up. No zips and no releases any more; the old `/userdata/Amazon Luna` folder is removed if it's there.
- **Updates come from the repository too:** Settings → Updates compares the app with the version on the main branch and downloads that.
- **HippOS:** the installer refuses anything that isn't Batocera or HippOS; files made when it's run as root are handed to HippOS's user (1000:100), so EmulationStation and the app can use them.

## 1.0.2

- **Signing in with a passkey account works.** The app's browser engine can't finish a passkey sign-in on Linux, so Amazon could leave you on a "use your passkey" or "scan this QR code" page with no way forward. The app now hides passkeys from Amazon's sign-in pages, so Amazon offers its password page (and its one-time code) instead. Your passkeys stay on your account for your other devices. To let Amazon offer them anyway: `"amazon_passkeys": true` in config.json.
- **The controller keeps working when the Luna window isn't focused** (for example just after an app screen or the on-screen keyboard closes): Luna keeps getting the controller, and the stream keeps running at full speed, as in Chrome.

## 1.0.1

- 4K upscaling is back (64-bit PCs): Luna sends at most 1080p, and the upscaler draws the game at your TV's full resolution and sharpens it on the graphics chip. Its size and sharpness are in Settings > Picture and in quick settings.
- Video clean-up is back: softens the blocks compression leaves in flat areas.
- Both are in quick settings during a game too, and safe mode and the low-power settings turn them off.

## 1.0.0

First version, built from the Xbox Cloud Gaming add-on (v1.2.8).

- A fullscreen Amazon Luna app of its own (no Chrome needed), controller-only from start to finish, with the on-screen keyboard for signing in to Amazon.
- Luna in every country it's offered (Settings > Region), and only Amazon's own sites.
- Luna's games in EmulationStation's list: All Luna games, or Games I pick (F8 or LB + RB + LT + RT on a game's page). Each with its name, description and picture from Luna. Picking one opens its page and presses Play.
- Picture options (sharpening, Clarity boost, contrast, saturation, brightness), stream stats, quick settings and screenshots in a game.
- Settings > Controller > Move around Luna with the app, in case Luna's pages don't follow the controller on your setup.
- Back up and restore, safe mode, low-power settings, updates from Settings, logs for help.
- Not carried over from the Xbox app (they relied on how Xbox's site works): resolution, region unlock, split screen, profiles, 3D game boxes, instant replay and the Xbox dashboard options.
