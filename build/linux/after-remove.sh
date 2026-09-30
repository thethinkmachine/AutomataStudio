#!/bin/bash

# Delete the link to the binary
# update-alternatives --remove <name> <path>: 'path' must be the registered alternative binary,
# not the generic symlink — see https://man7.org/linux/man-pages/man1/update-alternatives.1.html
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

# Remove and unload apparmor profile.
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  # Unload the profile from the running kernel before deleting the file so the
  # policy is not left enforced until the next reboot.  Mirror the chroot guard
  # used in the after-install script — live AppArmor operations are not
  # meaningful inside a chroot.
  # https://wiki.debian.org/AppArmor/HowToUse
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi

# ── AutomataStudio: the `automata` command line ─────────────────────
# Everything above is electron-builder's own after-remove script, copied
# verbatim from app-builder-lib/templates/linux/after-remove.tpl, for the same
# reason as in after-install.sh. The link is removed only if it is still ours.
AUTOMATA_CLI='/opt/${sanitizedProductName}/resources/cli/automata'
AUTOMATA_LINK='/usr/local/bin/automata'
if [ -L "$AUTOMATA_LINK" ] && [ "$(readlink "$AUTOMATA_LINK")" = "$AUTOMATA_CLI" ]; then
  rm -f "$AUTOMATA_LINK"
fi
