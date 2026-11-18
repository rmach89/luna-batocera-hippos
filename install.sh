#!/bin/bash
# One-step installer for Amazon Luna on Batocera (and HippOS).
# Run it in a terminal (F1 > Applications > xterm, or SSH). It works out
# whether this is Batocera or HippOS, downloads the newest version straight
# from the GitHub repository (no zips, no releases) and installs it:
#     curl -fsSL https://raw.githubusercontent.com/rmach89/luna-batocera-hippos/main/install.sh | bash
# Running it again updates to the newest version; your settings and
# sign-ins are kept.
# It copies the files into place and installs everything: the luna
# system, the Amazon Luna app (downloading the Electron browser
# engine), Launch Single Game if you want it (it asks), and the shortcuts in
# F1 > Applications.
# Nothing goes in the Ports menu.
# The package folder is the one this script is in. Piped in (curl ... | bash)
# it isn't in any folder, so it downloads the package (below).
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
    ROOT=/nonexistent
fi
USERDATA=/userdata
FILES=$USERDATA/system/add-ons/luna
LOGDIR=$USERDATA/system/logs

say()  { echo "[Amazon Luna] $*"; }
fail() { echo "[Amazon Luna] ERROR: $*" >&2; exit 1; }

[ -d "$USERDATA/system" ] || fail "This must be run on Batocera or HippOS ($USERDATA/system not found)."
# Which system is this? HippOS has /usr/share/hippos/version, Batocera
# /usr/share/batocera/batocera.version (LUNA_OS=batocera|hippos overrides).
OS="${LUNA_OS:-}"
if [ -z "$OS" ]; then
    if [ -f "${LUNA_HIPPOS_VERSION:-/usr/share/hippos/version}" ]; then OS=hippos
    elif [ -f /usr/share/batocera/batocera.version ] || command -v batocera-version >/dev/null 2>&1; then OS=batocera
    else fail "This doesn't look like Batocera or HippOS, the only systems Amazon Luna installs on. Nothing was installed."
    fi
fi
case "$OS" in batocera|hippos) ;; *) fail "LUNA_OS must be batocera or hippos." ;; esac
# On HippOS the installer asks nothing: Launch Single Game is left off.
ASK=1
[ "$OS" = hippos ] && ASK=''
can_ask() { [ -n "$ASK" ] && [ -t 0 ]; }
# Run from BUA (Batocera Unofficial Add-ons): BUA puts in its own "dialog"
# that shows the question on its screen and hands back the answer. Plain
# terminal prompts would wait unseen there, so questions go through dialog.
BUA=
[ "$(type -t dialog 2>/dev/null)" = function ] && BUA=1
ask_bua() {   # ask_bua <title> <text>: yes / no on BUA's screen (0 = yes)
    dialog --title "$1" --yesno "$2" 0 0
}
# the Debian package that holds a library Electron needs (named in the
# warning on HippOS; nothing is installed into the system)
debian_package() {
    case "$1" in
        libnss3.so|libnssutil3.so|libsmime3.so) echo libnss3 ;;
        libnspr4.so|libplc4.so|libplds4.so) echo libnspr4 ;;
        libatk-1.0.so.0) echo libatk1.0-0t64 ;;
        libatk-bridge-2.0.so.0) echo libatk-bridge2.0-0t64 ;;
        libatspi.so.0) echo libatspi2.0-0t64 ;;
        libcups.so.2) echo libcups2t64 ;;
        libgtk-3.so.0|libgdk-3.so.0) echo libgtk-3-0t64 ;;
        libpango-1.0.so.0) echo libpango-1.0-0 ;;
        libcairo.so.2) echo libcairo2 ;;
        libgio-2.0.so.0|libglib-2.0.so.0|libgobject-2.0.so.0|libgmodule-2.0.so.0) echo libglib2.0-0t64 ;;
        libdbus-1.so.3) echo libdbus-1-3 ;;
        libexpat.so.1) echo libexpat1 ;;
        libxkbcommon.so.0) echo libxkbcommon0 ;;
        libX11.so.6) echo libx11-6 ;;
        libxcb.so.1) echo libxcb1 ;;
        libXcomposite.so.1) echo libxcomposite1 ;;
        libXdamage.so.1) echo libxdamage1 ;;
        libXext.so.6) echo libxext6 ;;
        libXfixes.so.3) echo libxfixes3 ;;
        libXrandr.so.2) echo libxrandr2 ;;
        libgbm.so.1) echo libgbm1 ;;
        libdrm.so.2) echo libdrm2 ;;
        libasound.so.2) echo libasound2t64 ;;
        libudev.so.1) echo libudev1 ;;
    esac
}
# not in a full copy of the repository: the files come from GitHub, below
STANDALONE=
[ -f "$ROOT/system/add-ons/luna/app.asar" ] || STANDALONE=1
OS_NAME=Batocera; [ "$OS" = hippos ] && OS_NAME=HippOS
command -v python3 >/dev/null 2>&1 || fail "Python 3 is needed and wasn't found."

# Can this device run it? The browser engine (Electron) exists for 64-bit
# PCs, 64-bit ARM and 32-bit ARM (ARMv7). See "Compatibility" in README.txt.
case "$(uname -m)" in
    x86_64|amd64)   ARCH=x64 ;;
    aarch64|arm64)  ARCH=arm64 ;;
    armv7*|armv8l)  ARCH=armv7l ;;
    armv6*)  fail "This device (ARMv6: Raspberry Pi 1 / Zero / Zero W) can't run Amazon Luna: there is no browser engine for it. Nothing was installed." ;;
    i?86)    fail "This device runs 32-bit x86, which can't run Amazon Luna: there is no browser engine for it. Nothing was installed." ;;
    *)       fail "This device's processor ($(uname -m)) isn't supported: there is no browser engine for it. Nothing was installed." ;;
esac
mem_mb="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null)"
[ -z "$LUNA_FROM_GITHUB" ] && say "Detected $OS_NAME on $(uname -m), ${mem_mb:-?} MB memory."
if [ -z "$LUNA_FROM_GITHUB" ] && [ -n "$mem_mb" ] && [ "$mem_mb" -lt 1800 ]; then
    say "Warning: this device has less than 2 GB of memory. The app may be very slow or close by itself."
    say "It installs anyway; see Compatibility in README.txt."
fi

# --- the files come straight from GitHub ---
# No zips or releases: the installer gets the newest version of the
# repository (its main branch) as one download, unpacks it in a temporary
# folder in /userdata, installs from there and deletes the download.
# Only when this script sits in a full copy of the repository (a git clone)
# does it install that copy instead (for testing changes).
# LUNA_REPO / LUNA_BRANCH pick another repository or branch.
# LUNA_REF=v1.0.4 installs that tagged version instead (a git tag, no zip):
# for anyone who wants a fixed version, such as a HippOS catalog entry.
REPO="${LUNA_REPO:-rmach89/luna-batocera-hippos}"
BRANCH="${LUNA_BRANCH:-main}"
if [ -n "$LUNA_REF" ]; then
    case "$LUNA_REF" in *[!A-Za-z0-9._-]*) fail "LUNA_REF must be a tag such as v1.0.4." ;; esac
    TARBALL="${LUNA_TARBALL_URL:-https://codeload.github.com/$REPO/tar.gz/refs/tags/$LUNA_REF}"
    BRANCH="tag $LUNA_REF"
else
    TARBALL="${LUNA_TARBALL_URL:-https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH}"
fi
if [ -n "$STANDALONE" ]; then
    command -v curl >/dev/null 2>&1 || fail "curl is needed to download Amazon Luna and wasn't found."
    command -v tar  >/dev/null 2>&1 || fail "tar is needed to unpack Amazon Luna and wasn't found."
    if [ -n "$LUNA_REF" ]; then say "Downloading Amazon Luna $LUNA_REF from github.com/$REPO..."; else say "Downloading the newest Amazon Luna from github.com/$REPO ($BRANCH)..."; fi
    TMPD="$(mktemp -d "$USERDATA/.luna-download.XXXXXX" 2>/dev/null)" || fail "Couldn't make a folder in $USERDATA to download into."
    trap 'rm -rf "$TMPD"' EXIT
    if ! curl -fL -m 900 --retry 2 --progress-bar -o "$TMPD/luna.tar.gz" "$TARBALL"; then
        fail "Couldn't download Amazon Luna from GitHub (no internet, or GitHub isn't answering). Nothing was installed."
    fi
    mkdir -p "$TMPD/x" && tar -xzf "$TMPD/luna.tar.gz" -C "$TMPD/x" 2>/dev/null \
        || fail "The download couldn't be unpacked. Nothing was installed."
    rm -f "$TMPD/luna.tar.gz"
    PKG="$(dirname "$(find "$TMPD/x" -maxdepth 2 -name install.sh | head -n1)")"
    [ -f "$PKG/install.sh" ] && [ -f "$PKG/system/add-ons/luna/app.asar" ] \
        || fail "The download didn't look like Amazon Luna. Nothing was installed."
    say "Got v$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$PKG/system/add-ons/luna/app-source/package.json" | head -n1). Installing..."
    # questions go to this terminal even when the script was piped into bash
    if [ -n "$ASK" ] && [ -z "$BUA" ] && [ ! -t 0 ] && ( : < /dev/tty ) 2>/dev/null; then
        LUNA_FROM_GITHUB=1 bash "$PKG/install.sh" < /dev/tty
    else
        LUNA_FROM_GITHUB=1 bash "$PKG/install.sh"
    fi
    exit $?
fi
THIS_VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/system/add-ons/luna/app-source/package.json" 2>/dev/null | head -n1)"
[ -z "$LUNA_FROM_GITHUB" ] && say "Installing v${THIS_VERSION:-?} from the folder $ROOT (not downloading)."
# the unzipped folder older versions used: no longer needed
OLD_PKG="$USERDATA/Amazon Luna"
if [ "$ROOT" != "$OLD_PKG" ] && [ -f "$OLD_PKG/install.sh" ] && [ -f "$OLD_PKG/system/add-ons/luna/app.asar" ]; then
    rm -rf "$OLD_PKG" && say "Removed the old unzipped package folder $OLD_PKG (no longer needed)."
fi

if [ "$OS" = hippos ]; then
    say "Installing on HippOS $(head -n1 "${LUNA_HIPPOS_VERSION:-/usr/share/hippos/version}" 2>/dev/null): everything goes in /userdata."
else
    say "Installing on Batocera: nothing is saved into its system area; a service puts the F1 shortcuts and carousel art back at every boot."
fi
say "Copying files into place..."
mkdir -p "$FILES" "$LOGDIR" || fail "Could not create folders."
# reinstalling after an uninstall that kept the sign-ins and profiles
if [ -f "$FILES/KEPT-FOR-REINSTALL.txt" ]; then
    rm -f "$FILES/KEPT-FOR-REINSTALL.txt"
    say "Found your kept sign-ins, profiles and settings; using them."
fi
# copy the package files, but keep an existing config.json (your settings)
for f in "$ROOT/system/add-ons/luna/"*; do
    name="$(basename "$f")"
    if [ "$name" = "config.json" ] && [ -f "$FILES/config.json" ]; then
        say "Keeping your existing config.json."
        # an old default for the return-to-carousel wait becomes the new one
        sed -i -E 's/("return_to_carousel_delay": *)(1\.1|0\.8|0\.4)([,}[:space:]])/\10.3\3/' "$FILES/config.json" 2>/dev/null
        continue
    fi
    cp -rf "$f" "$FILES/" || fail "Could not copy $name."
done
# fix Windows line endings on the installer, in case the files were copied from a PC
tr -d '\r' < "$FILES/Install-AmazonLuna.sh" > "$FILES/Install-AmazonLuna.sh.tmp" \
    && mv "$FILES/Install-AmazonLuna.sh.tmp" "$FILES/Install-AmazonLuna.sh"

# Launch Single Game (optional): picking Amazon Luna in the carousel
# opens the app straight away instead of showing its game list first.
# Asked here; LUNA_SINGLE_LAUNCH=yes or =no answers it ahead of time.
SINGLE="${LUNA_SINGLE_LAUNCH:-}"
if [ -z "$SINGLE" ]; then
    # optional on both systems: off unless you ask for it. Installing again
    # keeps what you chose before (luna already in launchsingle.systems).
    SINGLE=no
    tr -d '\r' 2>/dev/null < "$USERDATA/system/launchsingle.systems" | grep -qx '[[:space:]]*luna[[:space:]]*' && SINGLE=yes
    if [ "$OS" = hippos ]; then
        # nothing asked on HippOS: no Launch Single Game (LUNA_SINGLE_LAUNCH=yes adds it)
        SINGLE=no
        say "HippOS: Launch Single Game is left off (run the install command with LUNA_SINGLE_LAUNCH=yes before bash to add it)."
    elif [ -n "$BUA" ]; then
        if ask_bua "Launch Single Game (optional)" "With it, picking Amazon Luna in the carousel opens the app straight away, and closing the app takes you back to the carousel. Without it, you see Amazon Luna's list first and press A on it. It only acts on Amazon Luna; your other systems behave as before. Amazon Luna works the same either way.

Install Launch Single Game?"; then SINGLE=yes; else SINGLE=no; fi
    elif can_ask; then
        cat <<'SINGLE_EOF'

------------------------------------------------------------------------
 Launch Single Game (optional)
------------------------------------------------------------------------
 What it is: a small add-on for EmulationStation. When you pick a system
 in the carousel that holds exactly one game, it starts that game for you
 instead of showing a list with one entry in it.

 With it (Yes):
   - Pick Amazon Luna in the carousel: the app opens straight away.
   - Close the app: you're back on the carousel.

 Without it (No):
   - Pick Amazon Luna in the carousel: you see its list, with one
     entry, "Amazon Luna". Press A on it to open the app.
   - Close the app: you're back on that list (B goes to the carousel).

 Good to know:
   - It only acts on the systems named in
     /userdata/system/launchsingle.systems. This installer adds just
     luna, so your other systems behave as before. If you already use
     Launch Single Game for other systems, they're left as they are.
   - With Settings > Batocera game list turned on, the Luna list
     holds your cloud games, so single launch is switched off for it
     automatically while the list is on, whichever you choose here.
   - It's entirely up to you; Amazon Luna works the same either
     way. Pressing Enter keeps what you have now (No on a first install).
   - Changed your mind? Run this installer again and answer the other
     way. Your sign-ins and settings are kept.
------------------------------------------------------------------------
SINGLE_EOF
        if [ "$SINGLE" = yes ]; then
            read -r -p "Keep Launch Single Game? [Y/n] " a
            case "$a" in n|N|no|NO) SINGLE=no ;; esac
        else
            read -r -p "Install Launch Single Game? [y/N] " a
            case "$a" in y|Y|yes|YES) SINGLE=yes ;; esac
        fi
    fi
fi
case "$SINGLE" in no|n|N|NO|0|false) SINGLE=no ;; *) SINGLE=yes ;; esac
if [ "$SINGLE" = yes ]; then
    say "Installing Amazon Luna and Launch Single Game (downloads about 100 MB the first time, unless Electron is already on this device)..."
else
    say "Installing Amazon Luna without Launch Single Game (downloads about 100 MB the first time, unless Electron is already on this device)..."
fi
LUNA_SINGLE_LAUNCH="$SINGLE" bash "$FILES/Install-AmazonLuna.sh"
cat "$LOGDIR/luna-install.log" 2>/dev/null
[ -f "$FILES/Uninstall-AmazonLuna.sh" ] || fail "Amazon Luna didn't install; see above."

if [ -x "$FILES/runtime/electron" ]; then
    # check the same way the app runs: BUA's libraries if BUA is
    # installed, otherwise the stand-in printing library
    if [ -d "$USERDATA/system/add-ons/.dep" ]; then
        libpath="$USERDATA/system/add-ons/.dep"
    else
        libpath="$FILES/lib/$ARCH"
    fi
    missing="$(LD_LIBRARY_PATH="$libpath" ldd "$FILES/runtime/electron" 2>/dev/null | grep 'not found')"
    if [ -n "$missing" ]; then
        say "Warning: this system is missing libraries the app needs:"
        echo "$missing"
        # nothing is installed into the system: on HippOS, say which Debian
        # packages hold them, so it can be reported to HippOS
        if [ "$OS" = hippos ]; then
            pkgs="$(printf '%s\n' "$missing" | awk '{print $1}' | while read -r lib; do debian_package "$lib"; done | sort -u | tr '\n' ' ')"
            [ -n "${pkgs// }" ] && say "On HippOS these are in the Debian packages: $pkgs- please report this at https://github.com/$REPO/issues"
        fi
    else
        say "The newest browser engine is installed."
    fi
else
    say "The browser engine will download the first time you launch Amazon Luna."
fi

# HippOS runs EmulationStation and the app as its own user (1000:100), not
# root: when this installer was run as root (sudo, or SSH as root), the
# files it made are handed to that user, as HippOS does for its launchers.
if [ "$OS" = hippos ] && [ "$(id -u)" = 0 ]; then
    OWNER="${LUNA_OWNER:-1000:100}"
    for p in "$FILES" "$USERDATA/roms/luna" "$USERDATA/system/configs/emulationstation" \
             "$USERDATA/.local/share/applications" "$USERDATA/system/.local/share/applications" \
             "$USERDATA/system/launchsingle.systems" "$LOGDIR"/luna-*.log; do
        [ -e "$p" ] && chown -R "$OWNER" "$p" 2>/dev/null
    done
    say "Files handed to HippOS's user ($OWNER)."
fi

echo
say "Done. Amazon Luna appears in the carousel after EmulationStation restarts."
if [ -z "$BUA" ] && can_ask; then
    say "To see it, restart EmulationStation from Main Menu > Quit > Restart EmulationStation."
    read -r -p "Press Enter to exit the installer. " _
fi
exit 0
