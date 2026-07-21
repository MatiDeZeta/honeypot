import { type RESTPostAPIChannelMessageJSONBody, MessageFlags, ComponentType, ButtonStyle, type APIUser, type APIComponentInContainer } from "discord-api-types/v10";
import type { HoneypotConfig } from "./db";

export function honeypotWarningMessage(
  moderatedCount: number = 0,
  action: HoneypotConfig["action"] = 'softban',
  customText?: string | null
): RESTPostAPIChannelMessageJSONBody {
  const actionTextMap = {
    ban: { text: 'an immediate ban', label: 'Bans' },
    softban: { text: 'a softban', label: 'Kicks' },
    kick: { text: 'a softban', label: 'Kicks' },
    disabled: { text: 'no action (honeypot is disabled)', label: 'Triggers' }
  };
  const { text: actionText, label: labelText } = actionTextMap[action] || actionTextMap.ban!;
  const { text: messageText, imageUrls } = customText ? extractPossibleImages(customText) : { text: null, imageUrls: null };

  return {
    flags: MessageFlags.IsComponentsV2,
    allowed_mentions: {},
    components: [
      {
        type: ComponentType.Container,
        components: ([
          (messageText || !imageUrls) ? {
            type: ComponentType.Section,
            components: [
              {
                type: ComponentType.TextDisplay,
                content: messageText?.replace(/\{\{action(:text)?\}\}/g, actionText)
                  || `## NO ENVÍES MENSAJES EN ESTE CANAL\n\nEste canal se utiliza para detectar bots de spam. Cualquier mensaje que se envíe aquí dará lugar a **${actionText}**.`
              }
            ],
            accessory: {
              type: ComponentType.Thumbnail,
              media: {
                url: "https://honeypot.riskymh.dev/honeypot.png"
              }
            }
          } as const : null,
          (imageUrls && imageUrls.length > 0) ? {
            type: ComponentType.MediaGallery,
            items: imageUrls.map(url => ({ media: { url } }))
          } as const : null,
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.Button,
                style: ButtonStyle.Secondary,
                label: `${labelText}: ${moderatedCount.toLocaleString()}`,
                custom_id: "moderated_count_button",
                // disabled: true,
                emoji: { name: "🍯" }
              }
            ]
          }
        ] satisfies (APIComponentInContainer | null)[]).filter(e => !!e),
      },
    ]
  };
}

export const defaultHoneypotWarningMessage = "## NO ENVÍES MENSAJES EN ESTE CANAL\n\nEste canal se utiliza para detectar bots de spam. Cualquier mensaje que se envíe aquí dará lugar a **{{action:text}}**.";

const pastTenseActionText = {
  ban: 'banned',
  kick: 'kicked',
  softban: 'kicked',
  disabled: '???it is disabled???'
} as const
export function honeypotUserDMMessage(action: HoneypotConfig["action"], guildName: string, discoverableLink: string | undefined, link: string, reinviteUrl: string | null, isAdmin = false, customText?: string | null): RESTPostAPIChannelMessageJSONBody {
  const actionText = pastTenseActionText[action] || '???unknown action???';
  const { text: messageText, imageUrls } = customText ? extractPossibleImages(customText) : { text: null, imageUrls: null };
  return {
    flags: MessageFlags.IsComponentsV2,
    allowed_mentions: {},
    components: [
      {
        type: ComponentType.Container,
        accent_color: 0xFFD700,
        components: [
          ...(!imageUrls || messageText ? [{
            type: ComponentType.Section,
            components: [
              {
                type: ComponentType.TextDisplay,
                content: messageText
                  ?.replace(/\{\{action(:text)?\}\}/g, actionText)
                  .replace(/\{\{server:name:?\}\}/g, guildName)
                  .replace(/\{\{server:name:linked\}\}/g, discoverableLink ? `[${guildName}](${discoverableLink})` : guildName)
                  .replace(/\{\{honeypot:channel:link\}\}/g, link)
                  .replace(/\{\{server:public-link\}\}/g, discoverableLink || "https://discord.com/servers")
                  .replace(/\{\{reinvite:link\}\}/g, reinviteUrl || "<invite link not available>")
                  || (`## Honeypot Triggered\n\nYou have been **${actionText}** from **${discoverableLink ? `[${guildName}](${discoverableLink})` : guildName}** for sending a message in the [honeypot](${link}) channel.`
                    + (reinviteUrl ? `\n\nOnce you have sorted out how your account spammed, you can rejoin via ${reinviteUrl}` : "")
                  )
              },
              ...((!imageUrls || imageUrls.length == 0) ? [
                {
                  type: ComponentType.TextDisplay,
                  content: `-# This is an automated message. Replies are not monitored.`
                },
              ] as const : []),
            ],
            accessory: {
              type: ComponentType.Thumbnail,
              media: {
                url: "https://honeypot.riskymh.dev/honeypot.png"
              }
            }
          }] : []),
          ...((imageUrls && imageUrls.length > 0) ? [
            {
              type: ComponentType.MediaGallery,
              items: imageUrls.map(url => ({ media: { url } }))
            },
            {
              type: ComponentType.TextDisplay,
              content: `-# This is an automated message. Replies are not monitored.`
            },
          ] as const : []),
        ]
      },
      customText ? {
        type: ComponentType.TextDisplay,
        content: `-# This is a custom message from the owners of "${guildName}".`
      } : isAdmin ? {
        type: ComponentType.TextDisplay,
        content: `-# This is an example message: as an admin you can’t be ${actionText}.`
      } : null,
    ].filter(Boolean) as any[],
  };
}

export const defaultHoneypotUserDMMessage = "## Honeypot Triggered\n\nYou have been **{{action:text}}** from **{{server:name}}** for sending a message in the [honeypot]({{honeypot:channel:link}}) channel.";
export const defaultHoneypotUserDMMessageReinvitePart = "\n\nOnce you have sorted out how your account spammed, you can rejoin via {{reinvite:link}}";

export function logActionMessage(userId: string, honeypotChannelId: string, action: HoneypotConfig["action"], customText?: string | null, moderatedCount: number = 0): RESTPostAPIChannelMessageJSONBody {
  const actionText = pastTenseActionText[action] || '???unknown action???';
  const text = customText
    ?.replace(/\{\{user:id\}\}/g, userId)
    .replace(/\{\{user(:ping|:mention)?\}\}/g, `<@${userId}>`)
    .replace(/\{\{action(:text)?\}\}/g, actionText)
    .replace(/\{\{honeypot:channel(:mention|:ping)?\}\}/g, `<#${honeypotChannelId}>`)
    .replace(/\{\{honeypot:moderation-count\}\}/g, moderatedCount.toLocaleString())
    || `<@${userId}> was ${actionText} for triggering the honeypot in <#${honeypotChannelId}>\n-# User ID: \`${userId}\``

  if (action !== 'ban') {
    return {
      allowed_mentions: {},
      content: text
    };
  }

  return {
    allowed_mentions: {},
    flags: MessageFlags.IsComponentsV2,
    components: [
      {
        type: ComponentType.Section,
        components: [
          {
            type: ComponentType.TextDisplay,
            content: text
          }
        ],
        accessory: {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          label: "Unban",
          custom_id: `unban:${userId}`,
        }
      }
    ]
  }
}

export const defaultLogActionMessage = "{{user:mention}} was {{action:text}} for triggering the honeypot in {{honeypot:channel:mention}}\n-# User ID: `{{user:id}}`";


const imageUrlRegex = /^https:\/\/[^\s\/]+\.[a-zA-Z]{2,}\/[^\s?#]*\.(?:png|jpg|jpeg|gif|webp|avif|mp4|mov)(?:[?#][^\s]*)?$/i;
function extractPossibleImages(text: string): { text: string | null, imageUrls: string[] | null } {
  if (!text) return { text: null, imageUrls: null };
  const lines = text.split("\n");
  const imageUrls: string[] = [];
  let consumed = 0;
  for (const raw of lines.toReversed()) {
    const line = raw.trim();
    if (!line) { consumed++; continue; }
    if (!imageUrlRegex.test(line)) break;
    imageUrls.push(line);
    consumed++;
  }
  if (imageUrls.length > 0) {
    const newText = lines.slice(0, lines.length - consumed).join("\n").trim();
    return { text: newText || null, imageUrls: imageUrls.reverse() };
  }
  return { text, imageUrls: null };
}
