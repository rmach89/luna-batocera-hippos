AMAZON LUNA for Batocera & HippOS
=================================
Version 1.0.4 (November 2026)
Home page and new versions: https://github.com/rmach89/luna-batocera-hippos

An unofficial, fan-made app, used at your own risk. It is not made,
endorsed or sponsored by Amazon. It opens Amazon's own Luna website
(luna.amazon.com) in a fullscreen window made for controllers; you sign in
with your own Amazon account. Amazon, Amazon Luna, Luna and Prime are
trademarks of Amazon.com, Inc. or its affiliates.

Built from the Xbox Cloud Gaming add-on for Batocera & HippOS
(https://github.com/rmach89/xcloud-batocera-hippos).


Contents
--------
  What you get / What you need / Install and update / Using it /
  Settings / EmulationStation game list / Controllers /
  Uninstall / Troubleshooting / Files


What you get
------------
- An "Amazon Luna" system in the EmulationStation carousel. Picking it
  opens a fullscreen Luna app of its own (no Chrome install needed).
- Controller-only from start to finish: an on-screen keyboard for signing
  in, and a number pad for codes.
- Only Amazon's own sites open: Luna in every country it's offered, and
  Amazon's sign-in and account pages. Other links, popups and downloads
  are blocked.
- Optional: Luna's games in EmulationStation's list, with their pictures
  and descriptions.
- Shortcuts in F1 > Applications: Amazon Luna, Amazon Luna Settings and
  Amazon Luna Uninstaller.


What you need
-------------
- Batocera or HippOS on a 64-bit PC, a Steam Deck or a 64-bit ARM device.
- Internet: 10 Mbps or faster. Wired or 5 GHz Wi-Fi is best.
- An Amazon account with a plan that includes Luna's cloud games (Prime
  or Luna Premium), in a country where they're offered: the US, Canada,
  the UK, Germany, Austria, France, Italy, Spain, the Netherlands, Poland,
  Belgium, Luxembourg, Portugal or Sweden.
- About 400 MB free in /userdata (the browser engine, Electron).
- A controller (Xbox, PlayStation or Luna), or a keyboard and mouse.


Install and update
------------------
Open a terminal (F1 > Applications > xterm on Batocera, the desktop's
terminal on HippOS, or SSH) and run:

    curl -fsSL https://raw.githubusercontent.com/rmach89/luna-batocera-hippos/main/install.sh | bash

Then restart EmulationStation (Main Menu > Quit > Restart EmulationStation).

The installer does everything by itself: it works out whether this is
Batocera or HippOS and which processor the device has, downloads the
newest version straight from the GitHub repository (no zips or releases)
and installs it in /userdata/system/add-ons/luna. On Batocera it asks
whether to install Launch Single Game: with it, picking Amazon Luna in
the carousel opens the app straight away, and closing the app takes you
back to the carousel. On HippOS it asks nothing and never writes to
HippOS's system area (no sudo, no apt-get); HippOS's built-in themes get
the luna carousel art from HippOS itself.

To update later: Settings > Help and maintenance > Updates, or run the
same command again. Your sign-in, settings and picked games are kept.

Options, set before "bash" (for example ... | LUNA_SINGLE_LAUNCH=yes bash):
  LUNA_SINGLE_LAUNCH=yes / no   answer the Launch Single Game question
  LUNA_BRANCH=name              install another branch of the repository
  LUNA_REF=v1.0.4               install exactly that version (a git tag)


Using it
--------
Exit back to EmulationStation: hold View + Menu (Select + Start,
Share/Create + Options) for 2 seconds. On a keyboard: hold Esc.

Welcome screen and Settings: hold Menu (Options / Start) for 1 second,
or hold S on a keyboard. Backspace on Luna's pages opens Settings.

Signing in: the first time, Luna asks you to sign in with your Amazon
account. The sign-in box is selected for you and the on-screen keyboard
comes up by itself: D-pad moves, A types, X deletes, Y capitals, B hides
the keyboard, Menu is Done. You only sign in once.

Passkeys: the app's browser engine can't finish a passkey sign-in on
Linux, so the app has Amazon show its password page instead. Sign in with
your password and Amazon's one-time code (by text or authenticator app).
Your passkeys stay on your account for your other devices. To let Amazon
offer passkeys anyway, set "amazon_passkeys": true in config.json.

On Luna itself, the controller works the way Luna makes it work. If
Luna's pages don't react to the controller on your setup, turn on
Settings > Controller > Move around Luna with the app: the D-pad then
moves between the page's buttons, A selects and B goes back.

Other Amazon pages (sign-in, Prime sign-up, your account): a "Back to
Amazon Luna" bar sits at the top. Press View / Select, or the Home key.

Quick settings in a game: hold LB + RB + View for a second (F9 on a
keyboard). Volume, stream stats, the picture options, 4K upscaling and
video clean-up, over the game.
Its first row takes a screenshot (also PrintScreen on a keyboard), saved
in /userdata/screenshots.

Intro: plays while Luna loads behind it. A, B, Menu, Enter or Space skip
it. Settings > Intro video: every time, once a day, or off.


Settings
--------
Up / down to move, left / right to change, A to select, Menu to save,
B to cancel. LB / RB jump between sections; Y twice resets the section
you're in (Save keeps it, Cancel undoes it).

Account
  Sign out of Amazon (press twice), Sign out when closing.
General
  Region: which country's Luna site opens (its games, plans and prices).
    Austria and Luxembourg use Germany's.
  Language of the app's own screens (Same as Batocera by default).
  Volume, Light up keys when typing, Intro video and its sound,
  Low-power settings (sharpening, Clarity boost, stream stats, 4K
  upscaling and video clean-up off).
Stream
  GPU acceleration (applies the next time the app opens; turn it off if
    the screen flickers or goes black), Stream stats.
Picture
  Sharpening.
  4K upscaling (64-bit PCs): Luna sends at most 1080p; this draws the game
    at your screen's full resolution and sharpens it on the graphics chip.
    Upscaling size (screen, 1080p, 1440p or 4K) and Upscaling sharpness
    show once it's on.
  Video clean-up: softens compression blocks in flat areas.
  Clarity boost, Contrast, Colour saturation, Brightness.
Controller
  Controls (every button and key), Move around Luna with the app,
  Controller battery.
EmulationStation
  EmulationStation game list (see below).
Help and maintenance
  Reload dashboard, Clear cache (you stay signed in), Save logs for help,
  Back up settings / Restore settings (one file in the share folder; the
  sign-in isn't in it), Updates.

Everything is saved in /userdata/system/add-ons/luna/config.json, which
can also be edited by hand.


EmulationStation game list
--------------------------
Settings > EmulationStation game list puts Luna's games in
EmulationStation's Luna list, each with its name, description and picture
from its page on Luna. Amazon Luna itself stays at the top of the list.

  Off             just the app's own entry
  All Luna games  every game on Luna's own list of its games (its public
                  site map, the list it gives search engines)
  Games I pick    only the games you add: open a game's page on Luna,
                  then press F8, or hold LB + RB + LT + RT for a second.
                  The same again takes it out.

Picking a game in EmulationStation opens the app on that game's page and
presses its Play button for you. If the game isn't in your plan, or Luna
words the button differently, the page is left as it is.

The list updates itself every few days (Luna's games change every month).
A progress bar shows in the bottom-left corner while it updates, and it
carries on in the background if you close the app. Games played from
inside the app count in EmulationStation's play count and play time.

The files: one small file per game in /userdata/roms/luna (it holds the
game's Luna ID), pictures in /userdata/roms/luna/images. Only files the
app made are ever removed; your play counts and favourites are kept.


Controllers
-----------
- Xbox, PlayStation and Luna controllers go to Luna as they are.
- Steam controllers (Steam Deck controls, Steam Controller) are shown to
  Luna as an Xbox controller, with the buttons in Xbox's layout.
- Other controllers the browser doesn't recognise are put into the Xbox
  layout, so the sticks, triggers and D-pad work.
- A message shows when a wireless controller's battery gets low.


Uninstall
---------
F1 > Applications > Amazon Luna Uninstaller, or:
    bash /userdata/system/add-ons/luna/uninstall.sh
It asks before removing anything, and can keep your sign-in and settings
for a reinstall. Add --all to remove everything without questions.


Troubleshooting
---------------
Black, flickering or broken picture: hold LB + RB for two seconds while
the app opens (safe mode). GPU acceleration, 4K upscaling, video
clean-up, sharpening and the picture adjustments turn off. Or run: bash /userdata/system/add-ons/luna/Run-App.sh --safe

"Browser not supported" on Luna: the app tells Luna it's Chrome on
Windows. If Luna still says so, Settings > Help and maintenance >
Updates gets the newest browser engine.

The controller does nothing on Luna's pages: Settings > Controller >
Move around Luna with the app.

Stutter: wired or 5 GHz Wi-Fi helps the most. On ARM devices, try
Low-power settings and GPU acceleration.

A game picked in EmulationStation doesn't start: press Play on its page
yourself. luna-app.log says what the app found.

Logs, in /userdata/system/logs:
  luna-install.log   install and uninstall
  luna.log           each launch
  luna-app.log       what happens inside the app
  luna-update.log    updates installed from Settings
Settings > Save logs for help puts them, with your settings, in one zip
in the share folder (nothing about the sign-in is included).
Problems and suggestions: https://github.com/rmach89/luna-batocera-hippos/issues


Files
-----
/userdata/system/add-ons/luna          the app, its settings and sign-in
/userdata/roms/luna                    the carousel entry (and the games)
/userdata/system/configs/emulationstation/es_systems_luna.cfg
/userdata/system/logs/luna-*.log       logs
