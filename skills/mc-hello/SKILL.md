---
name: mc-hello
description: Send a Hello message in Minecraft through the MC Claw bot. Use when the user wants the Minecraft bot to say hello, greet players, or send a chat message in the game.
---

# MC Hello

Make the Minecraft bot send a "Hello" message to all players in the game.

## How to use

Send a POST request to the bot service API:

```bash
curl -X POST http://localhost:3001/action \
  -H "Content-Type: application/json" \
  -d '{"type": "chat", "payload": {"message": "Hello! I am QClaw!"}}'
```

## API Details

- **Endpoint**: `POST http://localhost:3001/action`
- **Content-Type**: `application/json`
- **Body**: `{"type": "chat", "payload": {"message": "<message>"}}`
- **Success response**: `{"success": true, "action": "chat", "message": "<message>"}`

If the bot is not connected, the API returns HTTP 503 with `{"error": "Bot not connected"}`.
