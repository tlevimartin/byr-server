// server.js
import express from "express";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AGENT_ID = "agent_012UthwbzX4Gbn3AiaZYtXNf";
const ENVIRONMENT_ID = "env_01Tk7ham1eB96RirQqzTfjcD";
const VAULT_ID = "vlt_011CbuYmuZdexGteDMx7tChw";
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN; // xoxb-...

// Une session par utilisateur Slack (persistance dans la conversation)
const sessionsByUser = {};

async function getOrCreateSession(userId) {
  if (sessionsByUser[userId]) return sessionsByUser[userId];

  const session = await anthropic.beta.sessions.create({
    agent: AGENT_ID,
    environment_id: ENVIRONMENT_ID,
    vault_ids: [VAULT_ID],
    title: `BYR - Manager ${userId}`,
    // Décommentez si vous avez un Memory Store :
    // resources: [{ type: "memory_store", memory_store_id: "memstore_...", access: "read_write" }]
  });

  sessionsByUser[userId] = session.id;
  return session.id;
}

async function askBYR(sessionId, text) {
  // Envoyer le message
  await anthropic.beta.sessions.events.send(sessionId, {
    events: [{ type: "user.message", content: [{ type: "text", text }] }],
  });

  // Streamer la réponse
  let response = "";
  const stream = await anthropic.beta.sessions.events.stream(sessionId);
  for await (const event of stream) {
    if (event.type === "agent.message") {
      for (const block of event.content ?? []) {
        if (block.type === "text") response += block.text;
      }
    }
    if (
      event.type === "session.status_idle" &&
      event.stop_reason?.type !== "requires_action"
    )
      break;
  }
  return response;
}

async function postToSlack(channel, text) {
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel, text }),
  });
}

// Endpoint Slack Events
app.post("/slack/events", async (req, res) => {
  const { type, challenge, event } = req.body;

  // Vérification Slack lors de l'installation
  if (type === "url_verification") return res.json({ challenge });

  // Ignorer les messages du bot lui-même
  if (event?.bot_id) return res.sendStatus(200);

  if (event?.type === "message" || event?.type === "app_mention") {
    res.sendStatus(200); // Répondre à Slack immédiatement

    const userId = event.user;
    const text = event.text?.replace(/<@[^>]+>/g, "").trim(); // Retirer la mention @BYR
    const channel = event.channel;

    try {
      const sessionId = await getOrCreateSession(userId);
      const reply = await askBYR(sessionId, text);
      await postToSlack(channel, reply);
    } catch (err) {
      console.error(err);
      await postToSlack(channel, "❌ Une erreur est survenue, réessayez.");
    }
  } else {
    res.sendStatus(200);
  }
});

app.listen(3000, () => console.log("BYR server running on port 3000"));