# Changelog

Every version of the Amazon Luna add-on for Batocera and HippOS. Download them from [Releases](https://github.com/rmach89/luna-batocera-hippos/releases).

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
