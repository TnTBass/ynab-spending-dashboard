#!/usr/bin/env pwsh
# Remove Claude-managed worktrees whose branches have been fully merged into
# origin/main and whose working trees are clean. Safe to run any time:
#
#   - Touches only worktrees under .claude/worktrees/ with branches matching claude/*
#   - Skips dirty working trees (anything `git status --porcelain` reports)
#   - Skips unmerged branches (anything not an ancestor of origin/main)
#   - Refuses to delete a worktree the script is currently running from
#
# Logs every decision to %LOCALAPPDATA%\ynab-cleanup-worktrees.log.
#
# Usage:
#   pwsh -NoProfile -File scripts/cleanup-worktrees.ps1            # actually remove
#   pwsh -NoProfile -File scripts/cleanup-worktrees.ps1 -DryRun    # report only

[CmdletBinding()]
param(
  [string]$RepoRoot = (& git -C (Split-Path -Parent $PSScriptRoot) rev-parse --show-toplevel 2>$null),
  [string]$LogPath  = (Join-Path $env:LOCALAPPDATA "ynab-cleanup-worktrees.log"),
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot -or -not (Test-Path $RepoRoot)) {
  throw "Could not resolve repo root from $PSScriptRoot"
}
$RepoRoot = (Resolve-Path $RepoRoot).Path

function Log($msg) {
  $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $LogPath -Value $line
  Write-Host $line
}

Log "=== Cleanup starting (repo=$RepoRoot, dry-run=$DryRun) ==="

# Refresh origin/main so "is merged" judgments reflect the remote, not stale local refs.
& git -C $RepoRoot fetch --quiet origin main 2>&1 | Out-Null

# Parse `git worktree list --porcelain`. Output is groups of key/value lines separated
# by blank lines:
#   worktree <abs-path>
#   HEAD <sha>
#   branch refs/heads/<name>     (omitted for detached HEAD)
$worktrees = @()
$current   = @{}
foreach ($line in (& git -C $RepoRoot worktree list --porcelain)) {
  if ($line -eq "") {
    if ($current.Count -gt 0) { $worktrees += [pscustomobject]$current; $current = @{} }
    continue
  }
  $kv = $line -split " ", 2
  $current[$kv[0]] = if ($kv.Count -gt 1) { $kv[1] } else { $true }
}
if ($current.Count -gt 0) { $worktrees += [pscustomobject]$current }

$cwdResolved = (Resolve-Path .).Path
$removed = 0; $kept = 0

foreach ($wt in $worktrees) {
  $path = $wt.worktree
  if (-not $path) { continue }
  $pathResolved = (Resolve-Path $path -ErrorAction SilentlyContinue).Path
  if (-not $pathResolved) { continue }

  # Skip the primary worktree (the bare repo / main checkout)
  if ($pathResolved -eq $RepoRoot) { continue }

  # Only operate on Claude-managed worktrees
  if ($pathResolved -notmatch '\.claude[\\/]worktrees[\\/]') {
    Log "SKIP (non-claude path): $pathResolved"
    $kept++; continue
  }

  # Refuse to remove the directory we're running inside
  if ($pathResolved -eq $cwdResolved -or $cwdResolved.StartsWith($pathResolved + [IO.Path]::DirectorySeparatorChar)) {
    Log "SKIP (script is running inside this worktree): $pathResolved"
    $kept++; continue
  }

  $branch = if ($wt.branch) { ($wt.branch -replace '^refs/heads/', '') } else { '' }
  if (-not $branch) {
    Log "SKIP (detached HEAD): $pathResolved"
    $kept++; continue
  }
  if ($branch -notmatch '^claude/') {
    Log "SKIP (non-claude branch '$branch'): $pathResolved"
    $kept++; continue
  }

  # Working tree clean?
  $dirty = & git -C $pathResolved status --porcelain 2>$null
  if ($dirty) {
    Log "SKIP (dirty): $pathResolved"
    $kept++; continue
  }

  # Branch fully merged into origin/main?
  & git -C $RepoRoot merge-base --is-ancestor $branch origin/main 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Log "SKIP (unmerged): $pathResolved ($branch)"
    $kept++; continue
  }

  if ($DryRun) {
    Log "WOULD REMOVE: $pathResolved ($branch)"
    $removed++; continue
  }

  & git -C $RepoRoot worktree remove $pathResolved 2>&1 | ForEach-Object { Log "  git: $_" }
  if ($LASTEXITCODE -ne 0) { Log "FAIL (worktree remove): $pathResolved"; $kept++; continue }
  & git -C $RepoRoot branch -D $branch 2>&1 | ForEach-Object { Log "  git: $_" }
  Log "REMOVED: $pathResolved ($branch)"
  $removed++
}

& git -C $RepoRoot worktree prune
Log "=== Done. removed=$removed kept=$kept ==="
