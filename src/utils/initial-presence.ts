import { ActivityType, PresenceUpdateStatus } from "discord-api-types/v10";

const initialPresence = {
    since: null,
    activities: [
        {
            name: "#matidzinahoneypot",
            state: "ok ok ok ok ok ok",
            type: ActivityType.Custom,
        }
    ],
    status: PresenceUpdateStatus.Online,
    afk: false,
}

export default initialPresence;
