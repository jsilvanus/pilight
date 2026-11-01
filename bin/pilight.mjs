#!/usr/bin/env node
// Installed as `pilight`: the generated CLI (see cli/cli.mjs). `pilight start` runs the service.
import { main } from '../src/main.js';
import { run } from '../cli/cli.mjs';

if (process.argv[2] === "start") {
  await main();
} else {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    console.error(`pilight: ${err.message}`);
    process.exitCode = 2;
  });
}
