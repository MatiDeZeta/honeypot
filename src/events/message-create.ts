import { GatewayDispatchEvents, MessageReferenceType, type APIMessage } from "discord-api-types/v10";
import type { EventHandler } from "./events";
import type { API } from "@discordjs/core";
import type { API as API2 } from "@discordjs/core/http-only";
import { getDmChannelCache, getGuildInfo, getSubscribedChannelCache, setDmChannelCache, setSubscribedChannelCache } from "../utils/cache";
import { CUSTOM_EMOJI_ID } from "../utils/constants";
import { honeypotUserDMMessage, honeypotWarningMessage, logActionMessage } from "../utils/messages";

const handler: EventHandler<GatewayDispatchEvents.MessageCreate> = {
    event: GatewayDispatchEvents.MessageCreate,
    handler: async ({ data: message, api, applicationId, redis, db }) => {
        if (!message.guild_id) return;
        // if a user used a slash command, attribute it to the user instead of ignoring as its a bot msg
        if (message.interaction_metadata && message.author.id !== applicationId) {
            return await onMessage({
                userId: message.interaction_metadata.user.id,
                channelId: message.channel_id,
                guildId: message.guild_id,
                messageId: message.id
            }, api, db, redis);
        }

        // if it's a normal message, only trigger if it's not a bot (to avoid spam as we trust actual bots more)
        if (!message.author.bot) {
            return await onMessage({
                userId: message.author.id,
                channelId: message.channel_id,
                guildId: message.guild_id,
                messageId: message.id
            }, api, db, redis);
        }

        // if it's a bot message, still get the proxy to properly subscribe and avoid seeing the spam
        if (process.env.HAS_PROXY_WS && redis && message.guild_id) {
            const config = await db.getConfig(message.guild_id);
            if (!config || !config.action || config.honeypot_channel_id === message.channel_id) return;
            setSubscribedChannelCache(message.guild_id, [config.honeypot_channel_id || "none"], redis);
        }
    }
};

const onMessage = async (
    { userId, channelId, guildId, messageId, threadId }: { userId: string, channelId: string, guildId: string, messageId?: string, threadId?: string },
    api: API | API2,
    db: typeof import("../utils/db"),
    redis?: Bun.RedisClient
) => {
    try {
        if (!process.env.HAS_PROXY_WS && redis && !(await getSubscribedChannelCache(guildId, redis))?.includes(channelId)) return;

        const config = await db.getConfig(guildId);
        if (!config || !config.action) return;
        if (channelId !== config.honeypot_channel_id) {
            if (redis) setSubscribedChannelCache(guildId, [config.honeypot_channel_id || "none"], redis);
            return;
        }

        // just for the fun of it to acknowledge it saw the message
        let emojiReact = null as null | Promise<any>
        if (messageId) emojiReact = api.channels.addMessageReaction(
            channelId,
            messageId,
            `honeypot:${CUSTOM_EMOJI_ID}`,
            // this really doesn’t matter, so lets not have it get stuck in ratelimit queue if bot gets enough usage
            { signal: AbortSignal.timeout(1000) }
        ).catch(() => null);

        if (config.action === 'disabled') return;

        // let forwardPromise = null as null | Promise<any>;
        // if (config.experiments.includes("forward-message") && config.log_channel_id && messageId) {
        //     // intentionally not awaited as in theory we can do DM and this at same time (and avoid extra wait-time)
        //     forwardPromise = api.channels.createMessage(config.log_channel_id, {
        //         message_reference: {
        //             type: MessageReferenceType.Forward,
        //             channel_id: channelId,
        //             message_id: messageId,
        //             guild_id: guildId,
        //         }
        //     }).catch(err => console.log(`Failed to forward message to log channel: ${err}`));
        // }

        const customMessages = await db.getHoneypotMessages(guildId);

        // should DM user first before banning so that discord has less reason to block it
        let dmMessage: APIMessage | null = null;
        let isOwner = false;
        try {
            const timeout = AbortSignal.timeout(2500);
            const guild = await getGuildInfo(api, guildId, timeout, redis).catch(() => null);
            isOwner = guild?.ownerId === userId;
            if (!config.experiments.includes("no-dm")) {
                let dmChannel = redis && await getDmChannelCache(userId, redis);
                if (!dmChannel) {
                    ({ id: dmChannel } = await api.users.createDM(userId, { signal: timeout }));
                    if (redis) setDmChannelCache(userId, dmChannel, redis);
                }
                const link = `https://discord.com/channels/${guildId}/${channelId}/${config.honeypot_msg_id || messageId || ""}`;
                const dmContent = honeypotUserDMMessage(
                    config.action,
                    guild?.name ?? guildId!,
                    guild?.vanityInviteCode ? `https://discord.gg/${guild.vanityInviteCode}` : undefined,
                    link,
                    isOwner,
                    customMessages?.dm_message
                );
                dmMessage = await api.channels.createMessage(dmChannel, dmContent, { signal: timeout })
            }
        } catch (err) {
            /* Ignore DM errors (user has DMs closed, etc.) */
            console.log(`Failed to send DM to user: ${err}`)
        }

        // we prob will win the delete before the ban, so no point delaying the ban to wait for msg to create (and not the biggest deal if it fails)
        // if (forwardPromise) await forwardPromise;

        let failed = false;
        if (!isOwner) try {
            if (config.action === 'ban') {
                // Ban: permanent ban, delete last 1 hour of messages
                await api.guilds.banUser(
                    guildId,
                    userId,
                    { delete_message_seconds: 3600 },
                    { reason: "Triggered honeypot -> ban" }
                );
            } else if (config.action === 'softban' || config.action === 'kick') {
                // Kick: kick but via ban/unban, delete last 1 hour of messages
                await api.guilds.banUser(
                    guildId,
                    userId,
                    { delete_message_seconds: 3600 },
                    { reason: "Triggered honeypot -> softban (kick) 1/4" }
                );
                // await Bun.sleep(150)
                await api.guilds.unbanUser(
                    guildId,
                    userId,
                    { reason: "Triggered honeypot -> softban (kick) 2/4" }
                );

                // https://github.com/discord/discord-api-docs/issues/8360
                // sometimes banning doesn't actually remove messages - maybe doing it again later helps
                (async () => {
                    await Bun.sleep(10_000)
                    await api.guilds.banUser(
                        guildId,
                        userId,
                        { delete_message_seconds: 3600 },
                        { reason: "Triggered honeypot -> softban (kick) 3/4", signal: AbortSignal.timeout(25_000) }
                    );
                    await api.guilds.unbanUser(
                        guildId,
                        userId,
                        { reason: "Triggered honeypot -> softban (kick) 4/4", signal: AbortSignal.timeout(25_000) }
                    );
                })().catch(err =>
                    console.log(`Failed to double softban user (probably not an issue): ${err}`)
                );
            } else {
                console.error("Unknown action in honeypot config:", config.action);
                failed = true;
            }
        } catch (err) {
            console.log(`Failed to ${config.action} user: ${err}`);
            failed = true;
        } else {
            // server owner cannot be banned/kicked by anyone
            failed = true;
        };
        if (!failed && !isOwner) {
            await db.logModerateEvent(guildId, userId);
            redis?.publish("moderate_event", "");
        }

        try {
            if (config.log_channel_id && !failed && !isOwner) {
                await api.channels.createMessage(config.log_channel_id,
                    logActionMessage(userId, config.honeypot_channel_id, config.action, customMessages?.log_message)
                );
            } else if (isOwner) {
                await api.channels.createMessage(config.log_channel_id || config.honeypot_channel_id, {
                    content: `⚠️ User <@${userId}> triggered the honeypot, but they are the **server owner** so I cannot ${config.action} them.\n-# In anycase **ensure my role is higher** than people’s highest role and that I have **ban members** permission so I can ${config.action} for actual cases.`,
                    // allowed_mentions: {},
                });
            } else if (failed) {
                await api.channels.createMessage(config.log_channel_id || config.honeypot_channel_id, {
                    content: `⚠️ User <@${userId}> triggered the honeypot, but I **failed** to ${config.action} them.\n-# Please check my permissions to **ensure my role is higher** than their highest role and that I have **ban members** permission.`,
                    allowed_mentions: {},
                });
                await emojiReact;
            }
        } catch (err) {
            // somewhat chance the channel is deleted or the bot lost perms to send messages there
            console.log(`Failed to send log message (MessageCreate handler): ${err}`);
        }

        if (config.honeypot_msg_id && !config.experiments.includes("no-warning-msg")) try {
            const moderatedCount = await db.getModeratedCount(guildId);
            await api.channels.editMessage(
                config.honeypot_channel_id,
                config.honeypot_msg_id,
                honeypotWarningMessage(moderatedCount, config.action, customMessages?.warning_message)
            );
        } catch (err) { console.log(`Failed to update honeypot message: ${err}`); }

    } catch (err) {
        console.error(`Error with MessageCreate handler: ${err}`);
    }
};


export default handler;
