#!/usr/bin/env node
/** pilight entry point: reads the environment and the lights file, then runs the service. */
import { loadConfig, ConfigError } from './config.js';
import { createService } from './service.js';
import { pathToFileURL } from 'node:url';

export async function main(env = process.env) {
  let config;
  try {
    config = loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`pilight: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }
  if (!config.apiKey) console.warn('pilight: PILIGHT_API_KEY is not set; write calls are open (development only)');
  const service = createService(config);
  const address = await service.start();
  console.log(`pilight listening on ${typeof address === 'object' ? `${address.address}:${address.port}` : address}, mode ${config.mode}, ${config.lights.length} light(s)`);
  const stop = async () => { await service.stop(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return service;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
