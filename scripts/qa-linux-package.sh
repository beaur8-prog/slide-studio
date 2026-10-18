#!/usr/bin/env bash
# Destructive install/remove checks are confined to a disposable CI runner.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "$(id -u)" != 0 && "$(uname -s)" == Linux ]] || { echo 'Disposable non-root Linux CI required'; exit 1; }
deb="$(realpath "$1")"
[[ "${EXPECTED_DEB_SHA256:-}" =~ ^[a-f0-9]{64}$ && "${EXPECTED_APP_VERSION:-}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
printf '%s  %s\n' "$EXPECTED_DEB_SHA256" "$deb" | sha256sum --check
! dpkg-query -W slide-studio >/dev/null 2>&1 || { echo 'Pre-existing package; refusing to overwrite'; exit 1; }
[[ ! -e /opt/slide-studio && ! -e /usr/bin/slide-studio && ! -e /usr/share/applications/slide-studio.desktop && ! -e /usr/share/icons/hicolor/512x512/apps/slide-studio.png ]]
[[ -n "${XDG_CONFIG_HOME:-}" && ! -e "$XDG_CONFIG_HOME/Slide Studio" ]]
out="$PWD/qa/results/linux-native"
mkdir -p "$out" "$XDG_CONFIG_HOME/Slide Studio"
printf 'Keep autosave profile\n' > "$XDG_CONFIG_HOME/Slide Studio/qa-sentinel.txt"
dpkg-deb --info "$deb" > "$out/deb-info.txt"
dpkg-deb --contents "$deb" > "$out/deb-files.txt"
[[ "$(dpkg-deb -f "$deb" Package)" == slide-studio && "$(dpkg-deb -f "$deb" Architecture)" == amd64 && "$(dpkg-deb -f "$deb" Version)" == "$EXPECTED_APP_VERSION" ]]
sudo apt-get install -y "$deb"
[[ "$(stat -c '%u:%g:%a' /opt/slide-studio/chrome-sandbox)" == 0:0:4755 ]]
desktop-file-validate /usr/share/applications/slide-studio.desktop
ldd /opt/slide-studio/slide-studio > "$out/ldd.txt"
! grep -q 'not found' "$out/ldd.txt"
[[ "$(readlink /usr/bin/slide-studio)" == /opt/slide-studio/slide-studio ]]
unpacked="$(mktemp -d "$RUNNER_TEMP/slide-linux-payload.XXXXXX")"
dpkg-deb --extract "$deb" "$unpacked"
diff -qr "$unpacked/opt/slide-studio" /opt/slide-studio
# Openbox supplies real fullscreen behavior on the Xvfb display.
xvfb-run -a -s '-screen 0 1920x1080x24' dbus-run-session -- bash -c 'openbox > "$RUNNER_TEMP/slide-openbox.log" 2>&1 & node scripts/qa-installed-linux.cjs'
# Reinstall the same package and verify the complete payload again.
sudo dpkg -i "$deb"
diff -qr "$unpacked/opt/slide-studio" /opt/slide-studio
[[ "$(cat "$XDG_CONFIG_HOME/Slide Studio/qa-sentinel.txt")" == 'Keep autosave profile' ]]
# dpkg must remove only its own payload, not unrelated local files/documents.
sudo sh -c 'printf "Keep unrelated file\n" > /opt/slide-studio/qa-unrelated.txt'
sudo apt-get remove -y slide-studio
[[ ! -e /opt/slide-studio/slide-studio && ! -e /usr/bin/slide-studio && ! -e /usr/share/applications/slide-studio.desktop && ! -e /usr/share/icons/hicolor/512x512/apps/slide-studio.png ]]
[[ "$(cat /opt/slide-studio/qa-unrelated.txt)" == 'Keep unrelated file' ]]
[[ "$(cat "$XDG_CONFIG_HOME/Slide Studio/qa-sentinel.txt")" == 'Keep autosave profile' ]]
rm -rf "$unpacked"
printf '{"install":true,"payloadHashes":true,"rootOwnedSandbox4755":true,"desktopEntry":true,"sharedLibraries":true,"nativeApp":true,"reinstall":true,"uninstall":true,"profilePreserved":true,"unrelatedFilePreserved":true}\n' > "$out/package.json"
