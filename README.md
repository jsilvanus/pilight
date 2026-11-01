# pilight

Tally light service for the Pi. Each light (a lamp per camera) shows one of four things:

- **manual**: a colour set by hand through the API or CLI, with blinking if wanted;
- **atem**: camera tally from the ATEM (PGM when the camera's input is on program, PRV on preview, OFF otherwise);
- **encoder**: LIVE while the Monarch HDX encoder streams, OFF otherwise;
- **youtube**: LIVE / OFF from the YouTube status that pitube reports to pigateway.

pilight talks only to [pigateway](https://github.com/jsilvanus/pigateway) (read-only polling of `/api/v1/atem`, `/api/v1/encoder`, `/api/v1/youtube`). Lamps are driven through outputs: Tally-MA over UDP, a webhook, or the console. The core (states, looks, readings, the light with its deadman) is vendored from [stream-light](https://github.com/jsilvanus/stream-light) (MIT) and widened with the `PGM`/`PRV`/`LIVE`/`MANUAL` vocabulary and per-reading looks.

## Run

```sh
npm test                 # Node 24, no dependencies
cp .env.example .env     # then: set -a; . ./.env; set +a
cp config/lights.example.json config/lights.json
npm start                # or: node bin/pilight.mjs start
```

Lights live in `PILIGHT_LIGHTS` (default `config/lights.json`). Each light has an `id`, an `atemInput`, an optional `encoder` (`any`, `encoder1`, `encoder2`), a `look` override per state, and its `outputs`.

## API and CLI

[openapi/openapi.json](openapi/openapi.json) describes the API; a test fails when it and the served routes differ. Reads are open; writes need `Authorization: Bearer $PILIGHT_API_KEY` (or `X-Api-Key`).

```sh
pilight help
pilight set-mode --json '{"mode":"atem"}'
pilight set-light-manual --id cam1 --json '{"color":"#ff8000","blink":true}'
pilight get-status
```

## Status

Not verified against real hardware: the Tally-MA lamp, the ATEM, the Monarch encoder states (the encoder rule looks for "stream" in the encoder state text) and YouTube. The tests use fakes. The lamp's USB setup is deferred.
