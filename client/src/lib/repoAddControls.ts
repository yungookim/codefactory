export function getRepoAddControlsOpen(userOverride: boolean | null, repoCount: number): boolean {
  if (userOverride !== null) {
    return userOverride;
  }

  return repoCount === 0;
}
