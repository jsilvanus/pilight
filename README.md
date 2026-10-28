# pilight

Tally light controller service and CLI for **Tally-Ma Wireless Tally Lights**, designed for the Raspberry Pi production ecosystem.

## Protocol Scope & Architecture

- **mDNS Hostnames with IP Fallback**: By default, targets resolve to mDNS hostnames (`tally01.local` through `tally08.local`). If an mDNS name lookup fails or is unavailable on the network, `pilight` automatically fails over to the configured fallback IP (e.g. `192.168.1.70`, `192.168.1.89`).
- **HTTP for Solid Tally States**: All solid tally updates (`/PGM`, `/PRV`, `/NONE`), color cues (`/COLOR`), brightness, hold data (`/HOLDDATA`), and talent calls (`/CALL`) are sent over HTTP.
- **UDP for Multi-Status Segments & Animations**: The 29-byte binary protocol on port `21324` (`0x02 0x05 [9 x RGB]`) is used for:
  - **Free Segmenting**: Splitting the 9 LEDs into 2 or 3 custom groups to display concurrent statuses (e.g. YouTube stream, ATEM recording, and projector status on one light).
  - **Camera Director / PTZ Cues**: Directional animations (pan left, pan right, zoom in, zoom out) and operator-only rear calls (LEDs 1 & 9).
  - **Moving Animations**: Multi-zone animated effects like rainbow streaming.
- **PiGateway Integration**: Subscribes to `pigateway` SSE (`http://localhost:3100/api/v1/events`), automatically driving lights from ATEM cuts, encoder status, YouTube live status, and Atlona matrix routes.

---

## Installation & Build

Requires **Node.js >= 22**.

```sh
npm install
npm run build
npm test
```

---

## CLI Usage

Run directly with `node bin/pilight.mjs` or `npm run cli -- <command>`:

Target can be specified as a friendly name (`tally01`, `cam1`), a unit number (`1`, `2`), an mDNS hostname (`tally01.local`), or a direct IP address:

```sh
# Standard tally states (HTTP by default, mDNS with IP fallback)
pilight set tally01 pgm                 # Sends HTTP /PGM
pilight set 1 pgm                       # Unit number shortcut -> tally01.local
pilight set tally02 prv                 # Sends HTTP /PRV to tally02.local
pilight set tally01 off                 # Sends HTTP /NONE
pilight set tally01 #FF8800             # Sends HTTP /COLOR?HEX=FF8800

# Camera Director / PTZ Cues (UDP animations)
pilight cue 1 pan-left                  # Flashes leftward LEDs to cue camera pan left
pilight cue 1 pan-right                 # Flashes rightward LEDs to cue camera pan right
pilight cue 1 zoom-in                   # Expanding pulse to cue zoom in
pilight cue 1 zoom-out                  # Contracting pulse to cue zoom out
pilight cue 1 operator-call             # Flashes rear LEDs (1 & 9) for operator attention

# Diagnostic: Cycle through all 9 LEDs
pilight cycle 1                         # Sequentially lights up LEDs 1..9 in Red, Green, Amber

# Operator call & hold data (HTTP)
pilight call tally01                    # Flashes white 3x via HTTP /CALL
pilight hold tally01 1                  # Suppresses external server updates via HTTP /HOLDDATA?H=1
pilight brightness tally01 high         # Sets brightness via HTTP /HIGH

# Moving animations (Strictly UDP port 21324)
pilight rainbow tally01 --duration 5 --fps 20

# Start HTTP REST API daemon
pilight serve --port 3200
```

---

## Free Segmenting (Multi-Status Lights)

Each light's 9 LEDs can be freely segmented into 2 or 3 groups. For example:
- **LEDs 0, 1, 2 (1..3)**: YouTube Streaming status (**Red** = Live, **Amber** = Buffering, **Off** = Idle)
- **LEDs 3, 4, 5 (4..6)**: ATEM / Matrox Recording status (**Red** = Recording, **Off** = Idle)
- **LEDs 6, 7, 8 (7..9)**: Projector status (**Cyan** = On, **Off** = Standby)

### Segment Configuration Example
```json
POST /api/v1/lights/tally01/segments
{
  "segments": [
    { "id": "stream", "name": "YouTube Stream", "leds": [0, 1, 2], "facet": { "type": "youtube-stream" } },
    { "id": "rec", "name": "ATEM Recording", "leds": [3, 4, 5], "facet": { "type": "atem-recording" } },
    { "id": "proj", "name": "Main Projector", "leds": [6, 7, 8], "facet": { "type": "projector", "projector": 1 } }
  ]
}
```

---

## HTTP REST API

When running the service daemon (`npm start` or `pilight serve` on default port `3200`):

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Healthcheck |
| `GET` | `/api/v1/status` | Service status, device counts & states |
| `GET` | `/api/v1/lights` | List all registered tally lights |
| `POST` | `/api/v1/lights` | Register / configure a tally light (`host` defaults to mDNS, optional `fallbackIp`) |
| `GET` | `/api/v1/lights/:id` | Get light status (includes `activeTarget` and `segments`) |
| `DELETE` | `/api/v1/lights/:id` | Remove a tally light |
| `POST` | `/api/v1/lights/:id/state` | Set solid tally mode or color (HTTP) |
| `POST` | `/api/v1/lights/:id/cue` | Send camera PTZ cue (`pan-left`, `pan-right`, `zoom-in`, `zoom-out`, `operator-call`) |
| `POST` | `/api/v1/lights/:id/segments` | Configure free LED segments on light |
| `POST` | `/api/v1/lights/:id/segments/:segmentId` | Update color of a single segment (UDP) |
| `POST` | `/api/v1/lights/:id/animation/rainbow` | Start moving rainbow animation (**UDP**) |
| `POST` | `/api/v1/lights/:id/animation/frame` | Stream a single 29-byte 9-zone animation frame (**UDP**) |
| `POST` | `/api/v1/lights/:id/animation/stop` | Stop active animation/cue and revert to baseline |
| `POST` | `/api/v1/lights/:id/call` | Trigger flash call (HTTP `/CALL`) |
| `POST` | `/api/v1/lights/:id/hold` | Set HOLDDATA flag (HTTP `/HOLDDATA`) |
| `POST` | `/api/v1/lights/:id/brightness` | Set brightness (HTTP `/LOW`, `/MEDIUM`, `/HIGH`) |
| `POST` | `/api/v1/telemetry` | Update system telemetry snapshot (ATEM, YouTube, Matrox, Projectors, Atlona) |
| `GET` | `/api/v1/telemetry` | Get current telemetry snapshot |
| `POST` | `/api/v1/batch` | Batch update multiple lights (HTTP) |
| `GET` | `/api/v1/events` | Server-Sent Events (SSE) stream for real-time UI/integration |

---

## Environment Variables

- `PILIGHT_PORT`: HTTP server listen port (default `3200`).
- `PILIGHT_HOST`: HTTP server bind host (default `0.0.0.0`).
- `PIGATEWAY_URL`: URL to connect to `pigateway` SSE (e.g. `http://127.0.0.1:3100`).
- `PILIGHT_CLOUD_BROKER`: Optional MQTT broker URL (e.g. `mqtt://jnsl.asuscomm.com:18069`).
- `PILIGHT_DEVICES`: Optional JSON array of initial devices to register on startup.
