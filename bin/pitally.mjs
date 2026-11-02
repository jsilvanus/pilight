#!/usr/bin/env node
import { runCli } from '../dist/cli.js';

runCli(process.argv.slice(2)).catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
