# Puts the automata command line's folder on the user's PATH, or takes it off.
# Run by the installer (build/installer.nsh) on install and on uninstall.
#
# It edits HKCU\Environment directly rather than through
# [Environment]::SetEnvironmentVariable, because that call reads PATH with its
# %VARIABLES% already expanded and writes it back as a plain string — which
# flattens every %USERPROFILE%\… entry the user had into a fixed path. Here the
# value is read unexpanded and written back with the kind it already had.
#
# Adding is idempotent (the folder is never listed twice, whatever its case or
# trailing backslash), and removing takes out only this folder. The installer
# broadcasts WM_SETTINGCHANGE afterwards, so terminals opened from then on see
# the change without signing out.
#
# -Key exists for testing against a scratch key instead of the real one.

param(
  [Parameter(Mandatory = $true)][string]$Dir,
  [switch]$Remove,
  [string]$Key = 'Environment'
)

$ErrorActionPreference = 'Stop'

$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($Key)
try {
  $had = $k.GetValueNames() -contains 'Path'
  $old = if ($had) { [string]$k.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { '' }
  $kind = if ($had) { $k.GetValueKind('Path') } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }

  $want = $Dir.Trim().TrimEnd('\')
  $keep = @($old -split ';' | Where-Object { $_.Trim() -and ($_.Trim().TrimEnd('\') -ine $want) })
  if (-not $Remove) { $keep += $want }
  $new = $keep -join ';'

  if ($new -ne $old) {
    if ($new) { $k.SetValue('Path', $new, $kind) }
    elseif ($had) { $k.DeleteValue('Path', $false) }
  }
} finally {
  $k.Close()
}
