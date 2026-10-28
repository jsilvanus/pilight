# pilight

Tally light controller service and CLI for **Tally-Ma Wireless Tally Lights**, designed for the Raspberry Pi production ecosystem.

## Protocol Scope & Addressing

- **mDNS Hostnames with IP Fallback**: By default, targets resolve to mDNS hostnames (`tally01.local`, `tally02.local`). If an mDNS name lookup fails or is unavailable on the network, `pilight` automatically fails over to the configured fallback IP (e.g. `192.168.1.70`, `192.168.1.89`).
- **HTTP is the Default Interface**: All tally status updates (`/PGM`, `/PRV`, `/NONE`), color cues (`/COLOR`), brightness, hold data (`/HOLDDATA`), and operator calls (`/CALL`) are sent over HTTP.
- **UDP is Strictly Reserved for Moving Animations**: The 29-byte binary protocol on port `21324` (`0x02 0x05 [9 x RGB]`) is used exclusively for high-rate frame streaming and multi-zone animations (such as the rotating rainbow effect).
- **Cloud Mode (MQTT)**: Optional integration with the Tally-Ma cloud protocol (states: 0=Off, 1=Program, 2=Preview, 3=Recording, 4=Streaming) via configurable broker.

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
# Standard tally states (HTTP to tally01.local by default, fallback to 192.168.1.70)
pilight set tally01 pgm                 # Sends HTTP /PGM
pilight set 1 pgm                       # Unit number shortcut -> tally01.local
pilight set tally02 prv                 # Sends HTTP /PRV to tally02.local
pilight set 2 prv                       # Unit number shortcut -> tally02.local
pilight set tally01 off                 # Sends HTTP /NONE
pilight set tally01 #FF8800             # Sends HTTP /COLOR?HEX=FF8800

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

## HTTP REST API

When running the service daemon (`npm start` or `pilight serve` on default port `3200`):

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Healthcheck |
| `GET` | `/api/v1/status` | Service status, device counts & states |
| `GET` | `/api/v1/lights` | List all registered tally lights |
| `POST` | `/api/v1/lights` | Register / configure a tally light (`host` defaults to mDNS, optional `fallbackIp`) |
| `GET` | `/api/v1/lights/:id` | Get light status (includes `activeTarget`) |
| `DELETE` | `/api/v1/lights/:id` | Remove a tally light |
| `POST` | `/api/v1/lights/:id/state` | Set tally mode or color (HTTP) |
| `POST` | `/api/v1/lights/:id/call` | Trigger flash call (HTTP `/CALL`) |
| `POST` | `/api/v1/lights/:id/hold` | Set HOLDDATA flag (HTTP `/HOLDDATA`) |
| `POST` | `/api/v1/lights/:id/brightness` | Set brightness (HTTP `/LOW`, `/MEDIUM`, `/HIGH`) |
| `POST` | `/api/v1/lights/:id/animation/rainbow` | Start moving rainbow animation (**UDP**) |
| `POST` | `/api/v1/lights/:id/animation/frame` | Stream a single 9-zone animation frame (**UDP**) |
| `POST` | `/api/v1/lights/:id/animation/stop` | Stop active animation and revert |
| `POST` | `/api/v1/batch` | Batch update multiple lights (HTTP) |
| `GET` | `/api/v1/events` | Server-Sent Events (SSE) stream for real-time UI/integration |

---

## Environment Variables

- `PILIGHT_PORT`: HTTP server listen port (default `3200`).
- `PILIGHT_HOST`: HTTP server bind host (default `0.0.0.0`).
- `PILIGHT_CLOUD_BROKER`: Optional MQTT broker URL (e.g. `mqtt://jnsl.asuscomm.com:18069`).
- `PILIGHT_DEVICES`: Optional JSON array of initial devices to register on startup.
