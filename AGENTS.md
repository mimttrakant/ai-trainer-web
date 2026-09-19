# Project workflow

- After completing each major feature or topic, verify the work and save it as a
  local Git commit named `Phase N: <description>`. Continue numbering from Git
  history. The user has requested these checkpoints to make rollback easier.
- Stage only files belonging to that phase. Preserve unrelated user changes;
  do not discard or silently mix them into a feature commit.
- Report the phase number, commit hash, and verification result to the user.
- Do not push commits to a remote unless the user requests it.
- Keep secrets, datasets, generated model weights, checkpoints, and test output
  out of commits. A code checkpoint does not back up the database or model files.
