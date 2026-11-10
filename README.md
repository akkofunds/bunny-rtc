# Bunny RTC

A small, static, one-server chat app. Open Bunny RTC, then use **Invite friends** to copy the shared server link. Everyone opening that link joins the same single `#general` channel; it works on static hosting such as GitHub Pages without a separate application server.

## Run locally

Serve this folder over HTTP (for example, with VS Code Live Server or `python -m http.server 8080`) and open `http://localhost:8080`. The browser's `file://` mode does not support the secure WebSocket connection.

## Publish

Upload the contents of this folder to a static web host and share its URL with friends. All users of this build share one channel. To use GitHub Pages, place the files in the site's published root or a subfolder and share the resulting page URL.

## Chat behavior

- Messages are retained by the public MQTT broker so people joining later can see recent chat. The app keeps the newest 100 messages.
- The online list uses expiring presence pings.
- The invite link contains an unguessable room key in its URL fragment. Anyone with the invite can join; do not post passwords, personal information, or anything private.
- Chat is not end-to-end encrypted. The public MQTT broker carries the messages and may inspect them.
- The public broker is a best-effort free service, so availability and stored history are not guaranteed.
