import { type RESTPostAPIChannelMessageJSONBody, MessageFlags, ComponentType, ButtonStyle, type APIUser, type APIComponentInContainer } from "discord-api-types/v10";
import type { HoneypotConfig } from "./db";

export function honeypotWarningMessage(
  moderatedCount: number = 0,
  action: HoneypotConfig["action"] = 'softban',
  customText?: string | null
): RESTPostAPIChannelMessageJSONBody {
  const actionTextMap = {
    ban: { text: 'un baneo inmediato', label: 'Baneos' },
    softban: { text: 'un softban', label: 'Expulsiones' },
    kick: { text: 'un softban', label: 'Expulsiones' },
    disabled: { text: 'ninguna acción (honeypot está desactivado)', label: 'Activaciones' }
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
                  || `## No envíes mensajes en este canal\n\nEste canal se utiliza para detectar bots de spam. Cualquier mensaje que se envíe aquí dará lugar a **${actionText}**.`
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

export const defaultHoneypotWarningMessage = "## No envíes mensajes en este canal\n\nEste canal se utiliza para detectar bots de spam. Cualquier mensaje que se envíe aquí dará lugar a **{{action:text}}**.";

const pastTenseActionText = {
  ban: 'baneado',
  kick: 'expulsado',
  softban: 'expulsado',
  disabled: '???está desactivado???'
} as const
export function honeypotUserDMMessage(action: HoneypotConfig["action"], guildName: string, discoverableLink: string | undefined, link: string, reinviteUrl: string | null, isAdmin = false, customText?: string | null): RESTPostAPIChannelMessageJSONBody {
  const actionText = pastTenseActionText[action] || '???acción desconocida???';
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
                  || (`## Honeypot activado\n\nHas sido **${actionText}** de **${discoverableLink ? `[${guildName}](${discoverableLink})` : guildName}** por enviar un mensaje en el canal de [honeypot](${link}).`
                    + (reinviteUrl ? `\n\nCuando hayas resuelto cómo tu cuenta envió spam, puedes volver a unirte desde ${reinviteUrl}` : "")
                  )
              },
              ...((!imageUrls || imageUrls.length == 0) ? [
                {
                  type: ComponentType.TextDisplay,
                  content: `-# Este es un mensaje automático. Las respuestas no se supervisan.`
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
              content: `-# Este es un mensaje automático. Las respuestas no se supervisan.`
            },
          ] as const : []),
        ]
      },
      customText ? {
        type: ComponentType.TextDisplay,
        content: `-# Este es un mensaje personalizado de los propietarios de "${guildName}".`
      } : isAdmin ? {
        type: ComponentType.TextDisplay,
        content: `-# Este es un mensaje de ejemplo: como administrador no puedes ser ${actionText}.`
      } : null,
    ].filter(Boolean) as any[],
  };
}

export const defaultHoneypotUserDMMessage = "## Honeypot activado\n\nHas sido **{{action:text}}** de **{{server:name}}** por enviar un mensaje en el canal de [honeypot]({{honeypot:channel:link}}).";
export const defaultHoneypotUserDMMessageReinvitePart = "\n\nCuando hayas resuelto cómo tu cuenta envió spam, puedes volver a unirte desde {{reinvite:link}}";

export function logActionMessage(userId: string, honeypotChannelId: string, action: HoneypotConfig["action"], customText?: string | null, moderatedCount: number = 0): RESTPostAPIChannelMessageJSONBody {
  const actionText = pastTenseActionText[action] || '???acción desconocida???';
  const text = customText
    ?.replace(/\{\{user:id\}\}/g, userId)
    .replace(/\{\{user(:ping|:mention)?\}\}/g, `<@${userId}>`)
    .replace(/\{\{action(:text)?\}\}/g, actionText)
    .replace(/\{\{honeypot:channel(:mention|:ping)?\}\}/g, `<#${honeypotChannelId}>`)
    .replace(/\{\{honeypot:moderation-count\}\}/g, moderatedCount.toLocaleString())
    || `<@${userId}> fue ${actionText} por activar el honeypot en <#${honeypotChannelId}>\n-# ID del usuario: \`${userId}\``

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
          label: "Desbanear",
          custom_id: `unban:${userId}`,
        }
      }
    ]
  }
}

export const defaultLogActionMessage = "{{user:mention}} fue {{action:text}} por activar el honeypot en {{honeypot:channel:mention}}\n-# ID del usuario: `{{user:id}}`";


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
