#!/usr/bin/env node

import { main } from './main';

main({
  stderr: process.stderr,
  stdout: process.stdout,
  args: process.argv.slice(2),
});
