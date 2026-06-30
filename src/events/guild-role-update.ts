import { GatewayDispatchEvents, PermissionFlagsBits } from "discord-api-types/v10";
import type { EventHandler } from "./events";
import { setGuildInfoCache, getGuildInfo } from "../utils/cache";
import { hasPermission } from "../utils/tools";

const handler: EventHandler<GatewayDispatchEvents.GuildRoleUpdate> = {
    event: GatewayDispatchEvents.GuildRoleUpdate,
    handler: async ({ data: role, api, applicationId, redis, db }) => {
        const cache = await getGuildInfo<false>(api, role.guild_id, "no-fetch", redis);
        const roleIsAdmin = hasPermission(BigInt(role.role.permissions), PermissionFlagsBits.Administrator);
        const cacheHasRole = cache?.adminRoles?.includes(role.role.id) ?? false;

        if (!cache || roleIsAdmin !== cacheHasRole) {
            const guild = await api.guilds.get(role.guild_id);
            setGuildInfoCache(role.guild_id, guild, redis);
        }
    }
};

export default handler;
