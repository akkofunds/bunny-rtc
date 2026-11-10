# Bunny RTC

Bunny RTC is one shared public chat room. Everyone who visits the GitHub Pages website joins the same room automatically. There are no separate servers, room codes, or channels. Share the website address with friends.

## Run locally

Serve this folder over HTTP (for example, with VS Code Live Server or `python -m http.server 8080`) and open `http://localhost:8080`. The browser’s `file://` mode does not support secure WebSocket connections.

## Publish

Upload the contents of this folder to a static web host. GitHub Pages works without a separate application server.

## Chat behavior

- Messages are retained by the public MQTT broker so everyone can see recent chat. The app keeps the newest 100 messages.
- The online count uses expiring presence pings and is best effort.
- This is a public room with no sign-in. Anyone who knows the website address can read and post messages.
- Chat is not end-to-end encrypted. Do not post passwords or personal information.
- The free public broker is best effort, so availability and stored history are not guaranteed. If the connection drops, Bunny RTC retries and shows a reconnect button.
