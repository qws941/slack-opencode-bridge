import { App } from "@slack/bolt";

import { config } from "./config.js";
import { registerActionHandler } from "./handlers/action.js";
import { registerCommandHandler } from "./handlers/command.js";
import { registerMentionHandler } from "./handlers/mention.js";
import { registerMessageHandler } from "./handlers/message.js";
import { registerReactionHandler } from "./handlers/reaction.js";
import type { HandlerDependencies } from "./types.js";

export function createApp(dependencies: HandlerDependencies): App {
  const app = new App({
    token: config.SLACK_BOT_TOKEN,
    signingSecret: config.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: config.SLACK_APP_TOKEN,
  });

  registerMentionHandler(app, dependencies);
  registerMessageHandler(app, dependencies);
  registerReactionHandler(app, dependencies);
  registerActionHandler(app, dependencies);
  registerCommandHandler(app, dependencies);

  return app;
}
