import { GatewayDispatchEvents } from "discord-api-types/v10";
import type { EventHandler } from "./events";
import { setSubscribedChannelCache } from "../utils/cache";

const handler: EventHandler<GatewayDispatchEvents.ChannelDelete> = {
    event: GatewayDispatchEvents.ChannelDelete,
    handler: async ({ data: channel, api, applicationId, redis, db }) => {
        const { guild_id: guildId, id: channelId } = channel;
        if (!guildId) return;
        try {
            await db.unsetHoneypotChannel(guildId, channelId);
            await db.unsetLogChannel(guildId, channelId);
            if (redis) {
                const channels = await db.getChannels(guildId);
                setSubscribedChannelCache(guildId, channels.length > 0 ? channels.map(c => c.channel_id) : ["none"], redis);
            }
        } catch (err) {
            console.error(`Error with ChannelDelete handler: ${err}`);
        }
    }
};

export default handler;
