#!/usr/bin/env pwsh
# Register a Windows Scheduled Task that runs cleanup-worktrees.ps1 weekly.
#
# Usage (run once, no elevation needed — task runs as the current user):
#   pwsh -NoProfile -File scripts/install-cleanup-task.ps1
#
# Manual run:    Start-ScheduledTask -TaskName 'ClaudeWorktreeCleanup-ynab-spending-dashboard'
# Inspect logs:  Get-Content "$env:LOCALAPPDATA\ynab-cleanup-worktrees.log" -Tail 50
# Remove task:   Unregister-ScheduledTask -TaskName 'ClaudeWorktreeCleanup-ynab-spending-dashboard' -Confirm:$false

[CmdletBinding()]
param(
  [string]$TaskName  = "ClaudeWorktreeCleanup-ynab-spending-dashboard",
  [string]$ScriptPath = (Join-Path $PSScriptRoot "cleanup-worktrees.ps1"),
  [string]$RunAtTime = "03:00",
  [string]$DayOfWeek = "Sunday"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $ScriptPath)) { throw "cleanup script not found: $ScriptPath" }
$ScriptPath = (Resolve-Path $ScriptPath).Path

# Resolve pwsh path explicitly — the WindowsApps shim works in user Task Scheduler
# context, but a fully-qualified path avoids surprises if PATH gets mangled.
$pwshExe = (Get-Command pwsh -ErrorAction SilentlyContinue)?.Source
if (-not $pwshExe) { $pwshExe = "pwsh.exe" }

$action = New-ScheduledTaskAction -Execute $pwshExe `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $DayOfWeek -At $RunAtTime

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopOnIdleEnd `
  -ExecutionTimeLimit ([TimeSpan]::FromMinutes(10))

# Interactive logon = runs in the user's session (when logged in). No elevation,
# inherits the user's git credentials and HOME so `git fetch` works.
$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive

$task = New-ScheduledTask `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Weekly cleanup of merged Claude worktrees in ynab-spending-dashboard"

Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null

Write-Host "Registered: $TaskName"
Write-Host "  Runs:    $DayOfWeek $RunAtTime (when logged in)"
Write-Host "  Script:  $ScriptPath"
Write-Host "  Logs:    $env:LOCALAPPDATA\ynab-cleanup-worktrees.log"
Write-Host ""
Write-Host "Trigger now: Start-ScheduledTask -TaskName '$TaskName'"
