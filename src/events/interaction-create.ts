import { ButtonStyle, ChannelType, ComponentType, GatewayDispatchEvents, InteractionType, MessageFlags, PermissionFlagsBits, RESTJSONErrorCodes, SelectMenuDefaultValueType, TextInputStyle, type APIModalInteractionResponseCallbackData, type RESTPostAPIChannelMessageJSONBody } from "discord-api-types/v10";
import type { EventHandler } from "./events";
import type { HoneypotConfig } from "../utils/db";
import { honeypotWarningMessage, defaultHoneypotWarningMessage, defaultHoneypotUserDMMessage, defaultLogActionMessage, honeypotUserDMMessage, defaultHoneypotUserDMMessageReinvitePart } from "../utils/messages";
import { channelWarmerExperiment, randomChannelNameExperiment } from "../cron/experiments";
import getBadWords from "../utils/bad-words.macro" with { type: "macro" };
import { CUSTOM_EMOJI, CUSTOM_EMOJI_ID } from "../utils/constants";
import { getDmChannelCache, getGuildInfo, removeFromDeleteMessageCache, setDmChannelCache, setSubscribedChannelCache } from "../utils/cache";
import { DiscordAPIError } from "@discordjs/rest";
import { styleText } from "node:util";

const hasPermission = (permissions: bigint, permission: bigint) => (permissions & permission) === permission;

const badWords = getBadWords() as any as Awaited<ReturnType<typeof getBadWords>>;
const containsBadWord = (text: string): string | null => {
    const inputWords = text.toLowerCase().replace(/[^a-z0-9]/gi, ' ').split(/\W+/).filter(Boolean);
    return inputWords.find(word => badWords.includes(word)) || null;
}


const handler: EventHandler<GatewayDispatchEvents.InteractionCreate> = {
    event: GatewayDispatchEvents.InteractionCreate,
    handler: async ({ data: interaction, api, applicationId, redis, db }) => {
        const guildId = interaction.guild_id;
        const userId = interaction.member?.user.id || interaction.user?.id;
        if (!userId) return console.error("No user ID found in interaction, skipping????");
        const userContextHash = Bun.hash(guildId + applicationId + userId).toString(16);

        try {
            // slash command handler: show modal
            if (guildId && interaction.type === InteractionType.ApplicationCommand && interaction.data.name === "honeypot") {
                let config = await db.getConfig(guildId);
                config ||= {
                    guild_id: guildId,
                    honeypot_channel_id: null,
                    honeypot_msg_id: null,
                    log_channel_id: null,
                    action: 'softban',
                    experiments: []
                };

                const modal: APIModalInteractionResponseCallbackData = {
                    title: "Honeypot",
                    custom_id: `honeypot_config_modal:${userContextHash}`,
                    components: [
                        {
                            type: ComponentType.Label,
                            label: "Honeypot Channel",
                            description: "Any message sent in this channel will cause the author to be kicked/banned from server",
                            component: {
                                type: ComponentType.ChannelSelect,
                                custom_id: "honeypot_channel",
                                min_values: 1,
                                max_values: 1,
                                placeholder: "#honeypot",
                                channel_types: [ChannelType.GuildText],
                                default_values: config.honeypot_channel_id ? [{ id: config.honeypot_channel_id, type: SelectMenuDefaultValueType.Channel }] : [],
                                required: true,
                            }
                        },
                        {
                            type: ComponentType.Label,
                            label: "Log Channel",
                            description: "The channel to log events (ie kicks/bans that the bot actioned)",
                            component: {
                                type: ComponentType.ChannelSelect,
                                custom_id: "log_channel",
                                min_values: 0,
                                max_values: 1,
                                placeholder: "#mod-log",
                                channel_types: [ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread],
                                default_values: config.log_channel_id ? [{ id: config.log_channel_id, type: SelectMenuDefaultValueType.Channel }] : [],
                                required: false,
                            }
                        },
                        {
                            type: ComponentType.Label,
                            label: "Action",
                            description: "What should the bot do to message author?",
                            component: {
                                type: ComponentType.RadioGroup,
                                custom_id: "honeypot_action",
                                options: [
                                    { label: "Softban (kick)", value: "softban", description: "Bans & unbans to delete last 1hr of messages", default: config.action === "softban" || (config.action as any) === "kick" || !config.action },
                                    { label: "Ban", value: "ban", description: "Permanently bans the user to also delete last 1hr of messages", default: config.action === "ban" },
                                    { label: "Disabled", value: "disabled", /*description: "Don’t do anything",*/ default: config.action === "disabled" }
                                ],
                                required: true,
                            }
                        },
                        {
                            type: ComponentType.Label,
                            label: "Experiments",
                            // description: "Some optional experimental features to try out",
                            component: {
                                type: ComponentType.StringSelect,
                                custom_id: "honeypot_experiments",
                                placeholder: "Select experiments to enable",
                                options: [
                                    // { label: "Forward Message", value: "forward-message", description: "Forward the triggered message to the log channel", default: config.experiments.includes("forward-message") },
                                    { label: "Reinvite", value: "reinvite", description: "In the DM message give an invite code to rejoin (recommended)", default: config.experiments.includes("reinvite") },
                                    { label: "Timeout First", value: "timeout-first", description: "Timeout users (for 1hr) before banning/softbanning", default: config.experiments.includes("timeout-first") },
                                    // { label: "Timeout for Typing", value: "timeout-for-typing", description: "Timeout users (for 10sec) who are typing in the honeypot channel", default: config.experiments.includes("timeout-for-typing") },
                                    { label: "Channel Warmer", value: "channel-warmer", description: "Keep the honeypot channel active (every day)", default: config.experiments.includes("channel-warmer") },
                                    { label: "Random Channel Name", value: "random-channel-name", description: "Randomize the honeypot channel name (every day)", default: config.experiments.includes("random-channel-name") },
                                    { label: "No Warning Msg", value: "no-warning-msg", description: "Don’t include a warning message in the #honeypot channel", default: config.experiments.includes("no-warning-msg") },
                                    { label: "No DM", value: "no-dm", description: "Don’t DM the user that they triggered the honeypot", default: config.experiments.includes("no-dm") },
                                    { label: "Only More Recent Delete", value: "only-recent-delete", description: "Only delete last 15min of messages (instead of 1hr)", default: config.experiments.includes("only-recent-delete") },
                                    { label: "Random Channel Name (Chaos)", value: "random-channel-name-chaos", description: "Randomise the honeypot channel name with random characters (every day)", default: config.experiments.includes("random-channel-name-chaos") },
                                ],
                                min_values: 0,
                                max_values: 8,
                                required: false,
                            }
                        }
                    ]
                };
                await api.interactions.createModal(interaction.id, interaction.token, modal);
                return;
            }

            // modal submit handler: update config from modal values
            else if (guildId && interaction.type === InteractionType.ModalSubmit && interaction.data.custom_id === `honeypot_config_modal:${userContextHash}`) {
                const newConfig: HoneypotConfig = {
                    guild_id: guildId,
                    honeypot_channel_id: null,
                    honeypot_msg_id: null,
                    log_channel_id: null,
                    action: 'softban',
                    experiments: []
                }

                for (const label of interaction.data.components) {
                    if (label.type !== ComponentType.Label) continue;
                    const c = (label).component ?? label;
                    if (!c) continue;

                    if (c.type === ComponentType.ChannelSelect) {
                        if (c.custom_id === "honeypot_channel" && Array.isArray(c.values) && c.values.length > 0) newConfig.honeypot_channel_id = c.values[0]!;
                        if (c.custom_id === "log_channel" && Array.isArray(c.values) && c.values.length > 0) newConfig.log_channel_id = c.values[0]!;
                    }
                    if (c.type === ComponentType.RadioGroup) {
                        if (c.custom_id === "honeypot_action" && c.value) {
                            if (["kick", "ban", "disabled"].includes(c.value)) newConfig.action = c.value as any;
                        }
                    }
                    if (c.type === ComponentType.StringSelect) {
                        if (c.custom_id === "honeypot_experiments" && Array.isArray(c.values)) {
                            for (const val of c.values) {
                                if (["no-warning-msg", "no-dm", "random-channel-name", "random-channel-name-chaos", "channel-warmer", "forward-message", "reinvite", "timeout-first", "only-recent-delete"].includes(val)) {
                                    newConfig.experiments.push(val as any);
                                }
                            }
                        }
                    }
                }

                // shouldn’t happen, but just in case
                if (!newConfig.honeypot_channel_id) {
                    await api.interactions.reply(interaction.id, interaction.token, {
                        content: "Honeypot channel is required! No changes have been made.",
                        allowed_mentions: {},
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                const prevConfig = await db.getConfig(guildId);
                const honeypotChanged = newConfig.honeypot_channel_id !== prevConfig?.honeypot_channel_id;
                const logChanged = newConfig.log_channel_id !== prevConfig?.log_channel_id;
                const actionChanged = newConfig.action !== prevConfig?.action;

                // pretty reasonable requests to ensure user can even do said actions
                {
                    const resolvedChannel = interaction.data.resolved?.channels?.[newConfig.honeypot_channel_id];
                    const requiredPerms = PermissionFlagsBits.SendMessages | PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ManageMessages | PermissionFlagsBits.ManageChannels;
                    if (honeypotChanged && !hasPermission(BigInt(resolvedChannel?.permissions || "0"), requiredPerms)) {
                        await api.interactions.reply(interaction.id, interaction.token, {
                            content: `You don’t have enough permissions to set the honeypot channel to <#${newConfig.honeypot_channel_id}>. You need the following permissions in that channel: Send Messages, View Channel, Manage Messages, Manage Channels.\n-# No settings have been changed.`,
                            allowed_mentions: {},
                            flags: MessageFlags.Ephemeral,
                        });
                        return;
                    }

                    const resolvedLogChannel = newConfig.log_channel_id ? interaction.data.resolved?.channels?.[newConfig.log_channel_id] : null;
                    const logRequiredPerms = PermissionFlagsBits.SendMessages | PermissionFlagsBits.ViewChannel;
                    if (logChanged && newConfig.log_channel_id && !hasPermission(BigInt(resolvedLogChannel?.permissions || "0"), logRequiredPerms)) {
                        await api.interactions.reply(interaction.id, interaction.token, {
                            content: `You don’t have enough permissions to set the log channel to <#${newConfig.log_channel_id}>. You need the following permissions in that channel: Send Messages, View Channel.\n-# No settings have been changed.`,
                            allowed_mentions: {},
                            flags: MessageFlags.Ephemeral,
                        });
                        return;
                    }

                    const memberPerms = interaction.member?.permissions
                    const banEvents = ["ban", "softban"];
                    // check ban permissions even if the action didn’t change, because any new channel moved to can suddenly ban people
                    if (banEvents.includes(newConfig.action) && memberPerms && !hasPermission(BigInt(memberPerms), PermissionFlagsBits.BanMembers)) {
                        await api.interactions.reply(interaction.id, interaction.token, {
                            content: `You need the Ban Members permission to set the honeypot action to "${newConfig.action}".\n-# No settings have been changed.`,
                            allowed_mentions: {},
                            flags: MessageFlags.Ephemeral,
                        });
                        return;
                    }
                    if (banEvents.includes(newConfig.action) && !hasPermission(BigInt(interaction.app_permissions), PermissionFlagsBits.BanMembers)) {
                        await api.interactions.reply(interaction.id, interaction.token, {
                            content: `I need the Ban Members permission to set the honeypot action to "${newConfig.action}".\n-# No settings have been changed.`,
                            allowed_mentions: {},
                            flags: MessageFlags.Ephemeral,
                        });
                        return;
                    }

                    if (newConfig.experiments.includes("reinvite")) {
                        if (memberPerms && !hasPermission(BigInt(memberPerms), PermissionFlagsBits.CreateInstantInvite)) {
                            await api.interactions.reply(interaction.id, interaction.token, {
                                content: `You need the Create Instant Invite permission to enable the "Reinvite" experiment.\n-# No settings have been changed.`,
                                allowed_mentions: {},
                                flags: MessageFlags.Ephemeral,
                            });
                            return;
                        }
                        if (!hasPermission(BigInt(interaction.app_permissions), PermissionFlagsBits.CreateInstantInvite)) {
                            await api.interactions.reply(interaction.id, interaction.token, {
                                content: `I need the Create Instant Invite permission to enable the "Reinvite" experiment.\n-# No settings have been changed.`,
                                allowed_mentions: {},
                                flags: MessageFlags.Ephemeral,
                            });
                            return;
                        }
                    }

                    if (newConfig.experiments.includes("timeout-first")) {
                        if (memberPerms && !hasPermission(BigInt(memberPerms), PermissionFlagsBits.ModerateMembers)) {
                            await api.interactions.reply(interaction.id, interaction.token, {
                                content: `You need the Timeout Members permission to enable the "Timeout First" experiment.\n-# No settings have been changed.`,
                                allowed_mentions: {},
                                flags: MessageFlags.Ephemeral,
                            });
                            return;
                        }
                        if (!hasPermission(BigInt(interaction.app_permissions), PermissionFlagsBits.ModerateMembers)) {
                            await api.interactions.reply(interaction.id, interaction.token, {
                                content: `I need the Timeout Members permission to enable the "Timeout First" experiment.\n-# No settings have been changed.`,
                                allowed_mentions: {},
                                flags: MessageFlags.Ephemeral,
                            });
                            return;
                        }
                    }

                    // if any other actions added in future, add their equivalent permission checks here
                }

                // if honeypot channel changed or current honeypot msg is invalid, create new honeypot message
                // otherwise try to edit it with latest data
                // but if either fail, then let user know its broken sadly
                let msgId: string | null = null;
                if (!newConfig.experiments.includes("no-warning-msg")) {
                    const count = await db.getModeratedCount(guildId);
                    const customMessages = await db.getHoneypotMessages(guildId);
                    const messageBody = honeypotWarningMessage(count, newConfig.action, customMessages?.warning_message);
                    try {
                        if (honeypotChanged || !prevConfig?.honeypot_msg_id) {
                            const msg = await api.channels.createMessage(
                                newConfig.honeypot_channel_id,
                                messageBody
                            );
                            msgId = msg.id;
                        } else if (prevConfig?.honeypot_msg_id) {
                            try {
                                await api.channels.editMessage(
                                    newConfig.honeypot_channel_id,
                                    prevConfig.honeypot_msg_id,
                                    messageBody
                                );
                            } catch {
                                const msg = await api.channels.createMessage(
                                    newConfig.honeypot_channel_id,
                                    messageBody
                                );
                                msgId = msg.id;
                            }
                        } else {
                            console.log("No previous honeypot message ID found to edit.");
                        }
                    } catch (err) {
                        if (err instanceof DiscordAPIError && (err.code == RESTJSONErrorCodes.MissingAccess || err.code == RESTJSONErrorCodes.MissingPermissions)) {
                            console.log(styleText("dim", `Error creating/editing honeypot message (interaction handler): ${err}`));
                            await api.interactions.reply(interaction.id, interaction.token, {
                                content: `I don't have access to the honeypot channel <#${newConfig.honeypot_channel_id}>. Please make sure I have access to that channel and try again (both View Channel and Send Messages permissions).\n-# No settings have been changed.`,
                                allowed_mentions: {},
                                flags: MessageFlags.Ephemeral,
                            });
                        } else {
                            console.log(`Error creating/editing honeypot message (interaction handler): ${err}`);
                            await api.interactions.reply(interaction.id, interaction.token, {
                                content: `There was a problem setting up the honeypot channel to <#${newConfig.honeypot_channel_id}>. Please check my permissions and try again.\n-# No settings have been changed.`,
                                allowed_mentions: {},
                                flags: MessageFlags.Ephemeral,
                            });
                        }
                        return;
                    }
                } else if (prevConfig?.honeypot_msg_id && prevConfig?.honeypot_channel_id) {
                    // they didn’t want honeypot msg, so delete old one if exists
                    api.channels.deleteMessage(
                        prevConfig.honeypot_channel_id,
                        prevConfig.honeypot_msg_id,
                    ).catch(() => null);
                    newConfig.honeypot_msg_id = null;
                }

                if (logChanged && newConfig.log_channel_id) {
                    try {
                        await api.channels.createMessage(newConfig.log_channel_id, {
                            content: `Honeypot is set up in <#${newConfig.honeypot_channel_id}>! This current channel will log honeypot events.`,
                            allowed_mentions: {},
                        });
                    } catch (err) {
                        // clean up just created honeypot message if log channel fails (because user might think it's fully set up otherwise)
                        if (msgId) {
                            api.channels.deleteMessage(newConfig.honeypot_channel_id, msgId, { reason: "Cleaning up honeypot message after log channel setup failure" }).catch(() => null);
                        }

                        if (err instanceof DiscordAPIError && (err.code == RESTJSONErrorCodes.MissingAccess || err.code == RESTJSONErrorCodes.MissingPermissions)) {
                            console.log(styleText('dim', `Error sending test message to log channel (interaction handler): ${err}`));
                            await api.interactions.reply(interaction.id, interaction.token, {
                                content: `I don't have access to the log channel <#${newConfig.log_channel_id}>. Please make sure I have access to that channel and try again (both View Channel and Send Messages permissions).\n-# No settings have been changed.`,
                                allowed_mentions: {},
                                flags: MessageFlags.Ephemeral,
                            });
                        } else {
                            console.log(`Error sending test message to log channel (interaction handler): ${err}`);
                            await api.interactions.reply(interaction.id, interaction.token, {
                                content: `There was a problem sending test message to the log channel <#${newConfig.log_channel_id}>. Please check my permissions and try again.\n-# No settings have been changed.`,
                                flags: MessageFlags.Ephemeral,
                                allowed_mentions: {},
                            });
                        }
                        return;
                    }
                }

                if (newConfig.experiments.includes("reinvite") && (!prevConfig?.experiments.includes("reinvite") || honeypotChanged)) {
                    try {
                        const invite = await api.channels.createInvite(newConfig.honeypot_channel_id, {
                            max_age: 0, // never
                            max_uses: 0, // unlimited
                            unique: false,
                        }, {
                            reason: "Creating invite for reinvite experiment",
                            signal: AbortSignal.timeout(1_000),
                        });
                        await db.setReinvite(guildId, invite.code);
                    } catch (err) {
                        // clean up just created honeypot message if making invite fails (because user might think it's fully set up otherwise)
                        if (msgId) {
                            api.channels.deleteMessage(newConfig.honeypot_channel_id, msgId, { reason: "Cleaning up honeypot message after reinvite experiment failure" }).catch(() => null);
                        }

                        const errorCode = err instanceof DiscordAPIError ? err.code : null;
                        if (errorCode === RESTJSONErrorCodes.MaximumNumberOfInvitesReached) {
                            console.log(styleText("dim", `Error creating invite for reinvite experiment: ${err}`));
                            await api.interactions.reply(interaction.id, interaction.token, {
                                content: `There are too many invites in your server to make one for <#${newConfig.honeypot_channel_id}>. Please delete some existing invites and try again.\n-# No settings have been changed.`,
                                allowed_mentions: {},
                                flags: MessageFlags.Ephemeral,
                            });
                        } else if (errorCode === RESTJSONErrorCodes.MissingAccess || errorCode === RESTJSONErrorCodes.MissingPermissions) {
                            console.log(styleText("dim", `Error creating invite for reinvite experiment: ${err}`));
                            await api.interactions.reply(interaction.id, interaction.token, {
                                content: `I don't have permission to create invites in the honeypot channel <#${newConfig.honeypot_channel_id}>. Please make sure I have the Create Invite permission in that channel and try again.\n-# No settings have been changed.`,
                                allowed_mentions: {},
                                flags: MessageFlags.Ephemeral,
                            });
                        } else {
                            console.log(`Error fetching invite for reinvite experiment: ${err}`);
                            await api.interactions.reply(interaction.id, interaction.token, {
                                content: `There was a problem fetching the invite code for the "Reinvite" experiment. Please check my permissions and try again.\n-# No settings have been changed.`,
                                allowed_mentions: {},
                                flags: MessageFlags.Ephemeral,
                            });
                        }
                        return;
                    }
                    const messages = await db.getHoneypotMessages(guildId);
                    if (messages.dm_message && !messages.dm_message?.includes(defaultHoneypotUserDMMessageReinvitePart)) {
                        const newDmMessage = messages.dm_message + defaultHoneypotUserDMMessageReinvitePart;
                        await db.setHoneypotMessages(guildId, {
                            ...messages,
                            dm_message: newDmMessage,
                        });
                    }
                } else if (!newConfig.experiments.includes("reinvite") && prevConfig?.experiments.includes("reinvite")) {
                    await db.setReinvite(guildId, false);
                    const messages = await db.getHoneypotMessages(guildId);
                    if (messages.dm_message?.includes(defaultHoneypotUserDMMessageReinvitePart)) {
                        const newDmMessage = messages.dm_message.replace(defaultHoneypotUserDMMessageReinvitePart, "");
                        await db.setHoneypotMessages(guildId, {
                            ...messages,
                            dm_message: newDmMessage,
                        });
                    }
                }

                await db.setConfig({
                    ...(prevConfig || {}),
                    ...newConfig,
                    honeypot_msg_id: (newConfig.experiments.includes("no-warning-msg") && !newConfig.honeypot_msg_id)
                        ? null
                        : (msgId || newConfig.honeypot_msg_id || prevConfig?.honeypot_msg_id || null),
                });
                await api.interactions.reply(interaction.id, interaction.token, {
                    content: `Honeypot config updated!\n-# - Channel: <#${newConfig.honeypot_channel_id}>\n-# - Log Channel: ${newConfig.log_channel_id ? `<#${newConfig.log_channel_id}>` : '*(Not set)*'}\n-# - Action: **${newConfig.action}**${newConfig.experiments.length > 0 ? `\n-# - Experiments: ${newConfig.experiments.map(e => `\`${e}\``).join(", ")}` : ''}`,
                    allowed_mentions: {},
                });
                if (redis) setSubscribedChannelCache(guildId, [newConfig.honeypot_channel_id], redis);

                if (msgId && prevConfig?.honeypot_msg_id && prevConfig?.honeypot_channel_id) {
                    await api.channels.deleteMessage(
                        prevConfig.honeypot_channel_id,
                        prevConfig.honeypot_msg_id,
                        { reason: "Honeypot channel changed, so cleaning up old honeypot message" }
                    ).catch(() => null);
                }

                // run any experiments that were just enabled immediately to show user it works
                if (!prevConfig?.experiments.includes("channel-warmer") && newConfig.experiments.includes("channel-warmer")) {
                    try {
                        await channelWarmerExperiment(api, guildId, newConfig.honeypot_channel_id!)
                    } catch (err) {
                        api.channels.createMessage(newConfig.log_channel_id || newConfig.honeypot_channel_id, {
                            content: `There was a problem sending a message to the <#${newConfig.honeypot_channel_id}> channel for the "Channel Warmer" experiment. Please check my permissions.`,
                            allowed_mentions: {},
                        }).catch(() => null);
                    }
                }
                if (
                    (!prevConfig?.experiments.includes("random-channel-name") && newConfig.experiments.includes("random-channel-name"))
                    || (!prevConfig?.experiments.includes("random-channel-name-chaos") && newConfig.experiments.includes("random-channel-name-chaos"))
                ) {
                    try {
                        await randomChannelNameExperiment(api, guildId, newConfig.honeypot_channel_id!, newConfig.experiments.includes("random-channel-name-chaos"))
                    } catch (err) {
                        api.channels.createMessage(newConfig.log_channel_id || newConfig.honeypot_channel_id, {
                            content: `There was a problem updating the <#${newConfig.honeypot_channel_id}> channel for the "Random Channel Name" experiment. Please check my permissions.`,
                            allowed_mentions: {},
                        }).catch(() => null);
                    }
                }
                return;
            }

            function getDmMessage(config: HoneypotConfig | null, guild: Awaited<ReturnType<typeof getGuildInfo>> | null): string {
                let msg = defaultHoneypotUserDMMessage;
                if (config?.experiments?.includes("reinvite")) {
                    msg += defaultHoneypotUserDMMessageReinvitePart;
                }
                if (guild?.isDiscoverable) {
                    msg = msg.replace(" **{{server:name}}** ", " **{{server:name:linked}}** ");
                }
                return msg;
            }
            // slash command handler: show modal
            if (guildId && interaction.type === InteractionType.ApplicationCommand && interaction.data.name === "honeypot-messages") {
                const [messages, config, guild] = await Promise.all([
                    db.getHoneypotMessages(guildId),
                    db.getConfig(guildId),
                    getGuildInfo(api, guildId, AbortSignal.timeout(500), redis).catch(() => null)
                ]);

                const modal: APIModalInteractionResponseCallbackData = {
                    title: "Honeypot's Messages",
                    custom_id: `honeypot_messages_modal:${userContextHash}`,
                    components: [
                        {
                            type: ComponentType.TextDisplay,
                            content: "Set custom messages for the honeypot bot:\n" +
                                "-# - You can use the variables in your messages shown in template/default text\n" +
                                "-# - If you leave the textbox empty, then it'll reset to default\n" +
                                "-# - Make sure to keep the messages clear and informative!"
                        },
                        {
                            type: ComponentType.Label,
                            label: "Honeypot Warning",
                            description: "This is the message shown in the honeypot channel",
                            component: {
                                type: ComponentType.TextInput,
                                custom_id: "honeypot_warning",
                                style: TextInputStyle.Paragraph,
                                min_length: 10,
                                max_length: 1500,
                                required: false,
                                value: messages?.warning_message || defaultHoneypotWarningMessage,
                            },
                        },
                        {
                            type: ComponentType.Label,
                            label: "Honeypot DM Message",
                            description: "This is the message sent to users via DM when they trigger the honeypot",
                            component: {
                                type: ComponentType.TextInput,
                                custom_id: "honeypot_dm_message",
                                style: TextInputStyle.Paragraph,
                                min_length: 10,
                                max_length: 1000,
                                required: false,
                                value: messages?.dm_message || getDmMessage(config, guild),
                            },
                        },
                        {
                            type: ComponentType.Label,
                            label: "Log Message",
                            description: "This is the message shown in the log channel",
                            component: {
                                type: ComponentType.TextInput,
                                custom_id: "log_message",
                                style: TextInputStyle.Paragraph,
                                min_length: 10,
                                max_length: 500,
                                required: false,
                                value: messages?.log_message || defaultLogActionMessage,
                            },
                        },
                        {
                            type: ComponentType.Label,
                            label: "Reset All Messages",
                            description: "Nothing you changed here will persist. This will reset all messages to their default values.",
                            component: {
                                type: ComponentType.Checkbox,
                                custom_id: "reset_messages",
                                default: false
                            },
                        },
                    ]
                };
                await api.interactions.createModal(interaction.id, interaction.token, modal);
                return;
            }

            // modal submit handler: update config from modal values
            else if (guildId && interaction.type === InteractionType.ModalSubmit && interaction.data.custom_id === `honeypot_messages_modal:${userContextHash}`) {
                const [config, guild] = await Promise.all([
                    db.getConfig(guildId),
                    getGuildInfo(api, guildId, AbortSignal.timeout(500), redis).catch(() => null)
                ]);

                const newMessages: Awaited<ReturnType<typeof db.getHoneypotMessages>> = {
                    dm_message: null,
                    warning_message: null,
                    log_message: null,
                }
                let reset = false;

                for (const label of interaction.data.components) {
                    if (label.type !== ComponentType.Label) continue;
                    const c = (label).component ?? label;
                    if (!c || reset) continue;

                    if (c.type === ComponentType.TextInput) {
                        if (c.custom_id === "honeypot_warning" && c.value.length) {
                            if (c.value !== defaultHoneypotWarningMessage) newMessages.warning_message = c.value;
                        }
                        if (c.custom_id === "honeypot_dm_message" && c.value.length) {
                            if (c.value !== defaultHoneypotUserDMMessage && c.value !== getDmMessage(config, guild)) newMessages.dm_message = c.value;
                        }
                        if (c.custom_id === "log_message" && c.value.length) {
                            if (c.value !== defaultLogActionMessage) newMessages.log_message = c.value;
                        };
                    }
                    if (c.type === ComponentType.Checkbox) {
                        if (c.custom_id === "reset_messages" && c.value) {
                            reset = true;
                            newMessages.dm_message = null;
                            newMessages.warning_message = null;
                            newMessages.log_message = null;
                        }
                    }
                }

                // test that the messages are "safe" with rudimentary checks for bad words
                const warningMsgSus = newMessages.warning_message ? containsBadWord(newMessages.warning_message) : false;
                const dmMsgSus = newMessages.dm_message ? containsBadWord(newMessages.dm_message) : false;
                const logMsgSus = newMessages.log_message ? containsBadWord(newMessages.log_message) : false;
                if (warningMsgSus || dmMsgSus || logMsgSus) {
                    await api.interactions.reply(interaction.id, interaction.token, {
                        content: `One or more of your messages contain words that are not allowed on Discord. Please remove any inappropriate language and try again.\n-# No changes have been saved.`,
                        allowed_mentions: {},
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                // honeypot log should contain {{user:mention}}, so its not fully a free for all
                const logMsgMustIncludeOneOf = ["{{user:mention}}", "{{user:ping}}", "{{user:id}}"];
                if (newMessages.log_message && !logMsgMustIncludeOneOf.some(variable => newMessages.log_message!.includes(variable))) {
                    await api.interactions.reply(interaction.id, interaction.token, {
                        content: `The log message must contain the variable \`{{user:mention}}\` to show the user that triggered the honeypot. Please include that variable in your log message and try again.\n-# No changes have been saved.`,
                        allowed_mentions: {},
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                if (config?.honeypot_channel_id && config?.honeypot_msg_id) {
                    const guildModeratedCount = await db.getModeratedCount(guildId);
                    try {
                        await api.channels.editMessage(
                            config.honeypot_channel_id,
                            config.honeypot_msg_id,
                            honeypotWarningMessage(guildModeratedCount, config.action, newMessages.warning_message)
                        );
                    } catch (err) {
                        if (err instanceof DiscordAPIError && (err.code == RESTJSONErrorCodes.MissingAccess || err.code == RESTJSONErrorCodes.MissingPermissions)) {
                            console.log(styleText('dim', `Error updating honeypot warning message (interaction handler): ${err}`));
                            await api.interactions.reply(interaction.id, interaction.token, {
                                content: `I don't have access to the honeypot channel <#${config.honeypot_channel_id}> to update the warning message. Please make sure I have access to that channel and try again (both View Channel and Send Messages permissions).\n-# Your custom messages have not been saved.`,
                                allowed_mentions: {},
                                flags: MessageFlags.Ephemeral,
                            });
                        } else {
                            console.log(`Error updating honeypot warning message (interaction handler): ${err}`);
                            await api.interactions.reply(interaction.id, interaction.token, {
                                content: `There was a problem updating the honeypot warning message in <#${config.honeypot_channel_id}>. Please check my permissions.\n-# Your custom messages have not been saved.`,
                                allowed_mentions: {},
                                flags: MessageFlags.Ephemeral,
                            });
                        }
                        return
                    }
                }

                await api.interactions.reply(interaction.id, interaction.token, {
                    flags: MessageFlags.IsComponentsV2,
                    components: [
                        {
                            type: ComponentType.TextDisplay,
                            content: "**Honeypot messages updated!**",
                        },
                        {
                            type: ComponentType.TextDisplay,
                            content: newMessages.warning_message ? "Warning Message" : "Warning Message: *(Using default)*",
                        },
                        newMessages.warning_message && {
                            type: ComponentType.Container,
                            components: [
                                {
                                    type: ComponentType.TextDisplay,
                                    content: newMessages.warning_message
                                }
                            ],
                        },
                        {
                            type: ComponentType.TextDisplay,
                            content: newMessages.dm_message ? "DM Message" : "DM Message: *(Using default)*",
                        },
                        newMessages.dm_message && {
                            type: ComponentType.Container,
                            components: [
                                {
                                    type: ComponentType.TextDisplay,
                                    content: newMessages.dm_message
                                }
                            ],
                        },
                        {
                            type: ComponentType.TextDisplay,
                            content: newMessages.log_message ? "Log Message" : "Log Message: *(Using default)*",
                        },
                        newMessages.log_message && {
                            type: ComponentType.Container,
                            components: [
                                {
                                    type: ComponentType.TextDisplay,
                                    content: newMessages.log_message
                                }
                            ],
                        },
                    ].filter(e => !!e),

                    allowed_mentions: {},
                } as RESTPostAPIChannelMessageJSONBody);

                const existingMessages = await db.getHoneypotMessages(guildId);
                await db.setHoneypotMessages(guildId, newMessages);

                if (newMessages.dm_message && existingMessages?.dm_message !== newMessages.dm_message) {
                    const timeout = AbortSignal.timeout(10_000);
                    const userId = (interaction.user || interaction.member?.user)?.id;
                    if (userId) {
                        try {
                            const server = await getGuildInfo(api, guildId, timeout, redis);
                            let dmChannel = redis && await getDmChannelCache(userId, redis);
                            if (!dmChannel) {
                                ({ id: dmChannel } = await api.users.createDM(userId, { signal: timeout }));
                                if (redis) setDmChannelCache(userId, dmChannel, redis);
                            }
                            const reinviteCode = config?.experiments.includes("reinvite") && await db.getReinvite(guildId);
                            await api.channels.createMessage(
                                dmChannel,
                                honeypotUserDMMessage(
                                    config?.action || "softban",
                                    server.name ?? guildId!,
                                    server.isDiscoverable ? `https://discord.com/servers/${guildId}` : undefined,
                                    `https://discord.com/channels/${guildId}/${config?.honeypot_channel_id || ""}/${config?.honeypot_msg_id || ""}`,
                                    reinviteCode ? `https://discord.gg/${reinviteCode}` : null,
                                    false,
                                    newMessages.dm_message,
                                    true
                                ),
                                { signal: timeout }
                            );
                        } catch (err) {
                            console.log(`Error sending example DM message: ${err}`);
                        }
                    }
                }

                return;
            }

            // dm command to show stats
            else if (interaction.type === InteractionType.ApplicationCommand && interaction.data.name === "stats") {
                const { totalGuilds, totalModerated } = await db.getStats();
                const userId = (interaction.user || interaction.member?.user)?.id
                const userModeratedCount = userId ? await db.getUserModeratedCount(userId) : 0;

                await api.interactions.reply(interaction.id, interaction.token, {
                    flags: MessageFlags.IsComponentsV2,
                    allowed_mentions: {},
                    components: [
                        {
                            type: ComponentType.Container,
                            components: [
                                {
                                    type: ComponentType.TextDisplay,
                                    content: [
                                        `## ${CUSTOM_EMOJI} Honeypot Bot Statistics ${CUSTOM_EMOJI}`,
                                        "",
                                        `Total servers: \`${totalGuilds.toLocaleString()}\``,
                                        `Total moderations: \`${totalModerated.toLocaleString()}\``,
                                        `Times you've been #honeypot'd: \`${(userModeratedCount || 0).toLocaleString()}\``,
                                    ].join("\n"),
                                },
                                {
                                    type: ComponentType.TextDisplay,
                                    content: "-# Thank you for using [Honeypot Bot](https://discord.com/discovery/applications/1450060292716494940) to keep your servers safe from unwanted bots!"
                                },
                                {
                                    type: ComponentType.ActionRow,
                                    components: [
                                        {
                                            type: ComponentType.Button,
                                            url: `https://discord.com/oauth2/authorize?client_id=${interaction.application_id}`,
                                            style: ButtonStyle.Link,
                                            label: "Invite Bot",
                                            emoji: { name: "honeypot", id: CUSTOM_EMOJI_ID }
                                        },
                                        {
                                            type: ComponentType.Button,
                                            url: "https://discord.gg/BanFeVWyFP",
                                            style: ButtonStyle.Link,
                                            label: "Support Server"
                                        },
                                        {
                                            type: ComponentType.Button,
                                            url: "https://riskymh.dev",
                                            style: ButtonStyle.Link,
                                            label: "riskymh.dev"
                                        },
                                    ]
                                },
                            ],
                        },
                    ]
                });
            }

            // into welcome command to allow early deleting
            else if (guildId && interaction.type === InteractionType.MessageComponent && interaction.data.custom_id === "delete_intro_message") {
                if (!interaction.member?.permissions || !hasPermission(BigInt(interaction.member.permissions), PermissionFlagsBits.ManageMessages)) {
                    await api.interactions.reply(interaction.id, interaction.token, {
                        content: "You need the Manage Messages permission to delete this message.",
                        allowed_mentions: {},
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                await api.channels.deleteMessage(interaction.message.channel_id, interaction.message.id).catch(() => null);
                await api.interactions.deferMessageUpdate(interaction.id, interaction.token).catch(() => null);
                if (redis) removeFromDeleteMessageCache(interaction.message.channel_id, interaction.message.id, redis).catch(() => null);
            }

            // easy unban button
            else if (guildId && interaction.type === InteractionType.MessageComponent && interaction.data.custom_id.startsWith("unban:")) {
                if (!interaction.member?.permissions || !hasPermission(BigInt(interaction.member.permissions), PermissionFlagsBits.BanMembers)) {
                    await api.interactions.reply(interaction.id, interaction.token, {
                        content: "You need the Ban Members permission to unban this user.",
                        allowed_mentions: {},
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }
                if (!interaction.app_permissions || !hasPermission(BigInt(interaction.app_permissions), PermissionFlagsBits.BanMembers)) {
                    await api.interactions.reply(interaction.id, interaction.token, {
                        content: "I need the Ban Members permission to unban this user.",
                        allowed_mentions: {},
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                const messageAge = Date.now() - new Date(interaction.message.timestamp).getTime();
                if (messageAge > 24 * 60 * 60 * 1000) {
                    await api.interactions.reply(interaction.id, interaction.token, {
                        content: "This unban button has expired because it's been more than 24 hours since the user was banned. Please use the regular bans tab in member settings.",
                        allowed_mentions: {},
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                const userIdToUnban = interaction.data.custom_id.slice("unban:".length);

                try {
                    await api.guilds.unbanUser(guildId, userIdToUnban, { reason: `Unbanned by @${interaction.member.user.username} using the unban button in the honeypot log message` });
                } catch (err) {
                    if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownBan) {
                        await api.interactions.reply(interaction.id, interaction.token, {
                            content: "This user is not currently banned.",
                            allowed_mentions: {},
                            flags: MessageFlags.Ephemeral,
                        });
                        return;
                    }

                    console.log(`Error unbanning user: ${err}`);
                    await api.interactions.reply(interaction.id, interaction.token, {
                        content: "There was a problem unbanning the user. Please check my permissions and try again.",
                        allowed_mentions: {},
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                await api.interactions.reply(interaction.id, interaction.token, {
                    content: `User <@${userIdToUnban}> has been unbanned by <@${interaction.member.user.id}>!`,
                    allowed_mentions: {},
                });
            }

            return;
        } catch (err) {
            let interactionInfo = "";
            if (interaction.type === InteractionType.ApplicationCommand) {
                interactionInfo = `/${interaction.data.name}`;
            } else if (interaction.type === InteractionType.MessageComponent) {
                interactionInfo = `msg ${interaction.data.custom_id.split(":")[0]}`;
            } else if (interaction.type === InteractionType.ModalSubmit) {
                interactionInfo = `modal ${interaction.data.custom_id.split(":")[0]}`;
            }
            console.error(`Error with InteractionCreate handler [${interactionInfo}]: ${err}`);
        }
    }
};

export default handler;
