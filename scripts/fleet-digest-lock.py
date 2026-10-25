#!/usr/bin/env python3
"""Hold a kernel lock in the actual digest writer; exec preserves its descriptor."""
import fcntl
import os
import stat
import sys

lock_path, executable, *arguments = sys.argv[1:]
fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
if not stat.S_ISREG(os.fstat(fd).st_mode):
    raise SystemExit('Digest lock must be a regular file')
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    raise SystemExit(75)
os.set_inheritable(fd, True)
environment = dict(os.environ, SUTURA_DIGEST_LOCK_FD=str(fd))
os.execve(executable, [executable, *arguments], environment)
