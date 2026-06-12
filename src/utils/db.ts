import { SQL } from "bun";

export type HoneypotConfig = {
  guild_id: string;
  honeypot_channel_id: string | null;
  honeypot_msg_id: string | null;
  log_channel_id: string | null;
  action: 'softban' | 'ban' | 'disabled';
  experiments: ("no-warning-msg" | "no-dm" | "random-channel-name" | "random-channel-name-chaos" | "channel-warmer" | "forward-message" | "reinvite" | "timeout-first" | "only-recent-delete")[]
};

export const db = new SQL(process.env.DATABASE_URL || "sqlite://honeypot.sqlite", {
  readonly: process.env.DATABASE_READONLY === "true" ? true : undefined,
});

interface Migration {
  version: number;
  name: string;
  up: (tx: SQL) => Promise<void>;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: "initial",
    up: async (tx) => {
      await tx`
CREATE TABLE IF NOT EXISTS honeypot_config (
  guild_id TEXT PRIMARY KEY,
  honeypot_channel_id TEXT,
  honeypot_msg_id TEXT,
  log_channel_id TEXT,
  action TEXT NOT NULL DEFAULT 'softban',
  experiments TEXT DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS honeypot_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (guild_id) REFERENCES honeypot_config(guild_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS honeypot_messages (
  guild_id TEXT PRIMARY KEY,
  warning_message TEXT,
  dm_message TEXT,
  log_message TEXT,
  FOREIGN KEY (guild_id) REFERENCES honeypot_config(guild_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS honeypot_reinvite (
  guild_id TEXT PRIMARY KEY,
  invite TEXT,
  FOREIGN KEY (guild_id) REFERENCES honeypot_config(guild_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_honeypot_events_guild_id ON honeypot_events(guild_id);
CREATE INDEX IF NOT EXISTS idx_honeypot_events_user_id ON honeypot_events(user_id);
CREATE INDEX IF NOT EXISTS idx_honeypot_events_speed ON honeypot_events(timestamp, guild_id);
`;
    },
  },
];

export async function initDb() {
  if (db.options.adapter === "sqlite") {
    try {
      await db`PRAGMA foreign_keys = ON;`;
      await db`PRAGMA journal_mode = WAL;`;
      await db`PRAGMA busy_timeout = 5000;`;
      await db`PRAGMA wal_autocheckpoint = 1000;`;
      await db`PRAGMA synchronous = NORMAL;`;
    } catch (err) {
      console.error("Failed to set PRAGMA settings:", err);
    }
  }

  await db`CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`;

  const applied: { version: number }[] = await db`SELECT version FROM _migrations ORDER BY version ASC`.catch(() => [])
  const appliedSet = new Set(applied.map(r => r.version));

  for (const m of migrations) {
    if (appliedSet.has(m.version)) continue;
    try {
      await db.transaction(async (tx) => {
        await m.up(tx);
        await tx`INSERT INTO _migrations (version, name) VALUES (${m.version}, ${m.name})`;
      });
      if (appliedSet.size > 0) {
        console.log(`[db migrate] ${m.version}: ${m.name} applied`);
      }
    } catch (err) {
      console.error(`[db migrate] ${m.version}: ${m.name} failed:`, err);
      throw err;
    }
  }
}

export async function getConfig(guild_id: string): Promise<HoneypotConfig | null> {
  const [row] = await db`SELECT * FROM honeypot_config WHERE guild_id = ${guild_id}`;
  if (!row) return null;
  return {
    guild_id: row.guild_id,
    honeypot_channel_id: row.honeypot_channel_id,
    honeypot_msg_id: row.honeypot_msg_id ?? null,
    log_channel_id: row.log_channel_id ?? null,
    action: ['softban', 'ban', 'disabled'].includes(row.action) ? row.action : 'softban',
    experiments: JSON.parse(row.experiments || '[]'),
  };
}

export async function setConfig(config: HoneypotConfig) {
  await db`
    INSERT INTO honeypot_config (guild_id, honeypot_channel_id, honeypot_msg_id, log_channel_id, action, experiments)
    VALUES (${config.guild_id}, ${config.honeypot_channel_id}, ${config.honeypot_msg_id}, ${config.log_channel_id}, ${config.action}, ${JSON.stringify(config.experiments || [])})
    ON CONFLICT(guild_id) DO UPDATE SET
      honeypot_channel_id=excluded.honeypot_channel_id,
      honeypot_msg_id=excluded.honeypot_msg_id,
      log_channel_id=excluded.log_channel_id,
      action=excluded.action,
      experiments=excluded.experiments
  `;
}

export async function deleteConfig(guild_id: string) {
  await db`DELETE FROM honeypot_config WHERE guild_id = ${guild_id}`;
}

export async function logModerateEvent(guild_id: string, user_id: string) {
  await db`INSERT INTO honeypot_events (guild_id, user_id) VALUES (${guild_id}, ${user_id})`;
}

export async function getModeratedCount(guild_id: string): Promise<number> {
  const [row] = await db`SELECT COUNT(*) as count FROM honeypot_events WHERE guild_id = ${guild_id}`;
  return row.count as number;
}

export async function unsetHoneypotChannel(guildId: string, channelId: string) {
  await db`UPDATE honeypot_config SET honeypot_channel_id = NULL, honeypot_msg_id = NULL WHERE guild_id = ${guildId} AND honeypot_channel_id = ${channelId}`;
}

export async function unsetLogChannel(guildId: string, channelId: string) {
  await db`UPDATE honeypot_config SET log_channel_id = NULL WHERE guild_id = ${guildId} AND log_channel_id = ${channelId}`;
}

export async function unsetHoneypotMsg(guildId: string, messageId: string) {
  // dont get write lock if its not the same msg
  const row = await db`SELECT honeypot_msg_id FROM honeypot_config WHERE guild_id = ${guildId} AND honeypot_msg_id = ${messageId}`;
  if (row.length === 0) return;

  await db`UPDATE honeypot_config SET honeypot_msg_id = NULL WHERE guild_id = ${guildId} AND honeypot_msg_id = ${messageId}`;
}

export async function unsetHoneypotMsgs(guildId: string, messageIds: string[]) {
  // dont get write lock if none of the msgs match
  const row = await db`SELECT honeypot_msg_id FROM honeypot_config WHERE guild_id = ${guildId} AND honeypot_msg_id IN ${db(messageIds)}`;
  if (row.length === 0) return;

  await db`UPDATE honeypot_config SET honeypot_msg_id = NULL WHERE guild_id = ${guildId} AND honeypot_msg_id IN ${db(messageIds)}`;
}

export async function getStats(): Promise<{ totalGuilds: number; totalModerated: number; }> {
  const [result] = await db`SELECT (SELECT COUNT(*) FROM honeypot_config) AS config_count, (SELECT COUNT(*) FROM honeypot_events) AS event_count;`;
  return {
    totalGuilds: result.config_count,
    totalModerated: result.event_count,
  };
}

export async function getUserModeratedCount(user_id: string): Promise<number> {
  const [row] = await db`SELECT COUNT(*) as count FROM honeypot_events WHERE user_id = ${user_id}`;
  return row.count as number;
}

export async function getGuildsWithExperiment(experiment: HoneypotConfig["experiments"][number]): Promise<HoneypotConfig[]> {
  const rows = await db`SELECT * FROM honeypot_config WHERE experiments LIKE '%' || ${experiment} || '%'`;
  return rows.map((row: any) => ({
    guild_id: row.guild_id,
    honeypot_channel_id: row.honeypot_channel_id,
    honeypot_msg_id: row.honeypot_msg_id ?? null,
    log_channel_id: row.log_channel_id ?? null,
    action: ['softban', 'ban', 'disabled'].includes(row.action) ? row.action : 'softban',
    experiments: JSON.parse(row.experiments || '[]'),
  }));
}
export async function getHoneypotMessages(guild_id: string): Promise<{ warning_message: string | null; dm_message: string | null; log_message: string | null; }> {
  const [row] = await db`SELECT * FROM honeypot_messages WHERE guild_id = ${guild_id}`;
  if (!row) {
    return {
      warning_message: null,
      dm_message: null,
      log_message: null,
    };
  }
  return {
    warning_message: row.warning_message,
    dm_message: row.dm_message,
    log_message: row.log_message,
  };
}

export async function setHoneypotMessages(guild_id: string, messages: { warning_message?: string | null; dm_message?: string | null; log_message?: string | null; }) {
  if (messages.warning_message === null && messages.dm_message === null && messages.log_message === null) {
    await db`DELETE FROM honeypot_messages WHERE guild_id = ${guild_id}`;
    return;
  }
  await db`
    INSERT INTO honeypot_messages (guild_id, warning_message, dm_message, log_message)
    VALUES (${guild_id}, ${messages.warning_message}, ${messages.dm_message}, ${messages.log_message})
    ON CONFLICT(guild_id) DO UPDATE SET
      warning_message=excluded.warning_message,
      dm_message=excluded.dm_message,
      log_message=excluded.log_message
  `;
}


export async function getReinvite(guild_id: string): Promise<string | null> {
  const [row] = await db`SELECT invite FROM honeypot_reinvite WHERE guild_id = ${guild_id}`;
  if (!row) return null;
  return row.invite;
}

export async function setReinvite(guild_id: string, invite: string | false) {
  if (!invite) {
    await db`DELETE FROM honeypot_reinvite WHERE guild_id = ${guild_id}`;
    return;
  }
  await db`
    INSERT INTO honeypot_reinvite (guild_id, invite)
    VALUES (${guild_id}, ${invite})
    ON CONFLICT(guild_id) DO UPDATE SET
      invite=excluded.invite
  `;
}


export async function getFullStats(): Promise<{
  guilds: number;
  moderations: number;
  last7dModerations: number;
  last7dEngagedGuilds: number;
  dailyStats: { date: string; moderations: number; engagedGuilds: number; }[];
}> {
  const now = new Date();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(now.getUTCDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().replace('T', ' ').substring(0, "YYYY-MM-DD HH:mm:ss".length);

  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setUTCDate(now.getUTCDate() - 14);
  const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().substring(0, "YYYY-MM-DD".length) + ' 00:00:00';

  const todayStartStr = now.toISOString().substring(0, "YYYY-MM-DD".length) + ' 00:00:00';

  const [[meta], events] = await Promise.all([
    db`
      SELECT
        (SELECT COUNT(*) FROM honeypot_config) AS guilds,
        (SELECT COUNT(*) FROM honeypot_events) AS moderations
    `,
    db`
      SELECT timestamp, guild_id
      FROM honeypot_events
      WHERE timestamp >= ${fourteenDaysAgoStr}
      ORDER BY timestamp ASC;
    `,
  ]);

  let last7dModerations = 0;
  const last7dGuilds = new Set<string>();
  const dailyMap = new Map<string, { moderations: number; guilds: Set<string> }>();

  for (const row of events) {
    const ts = row.timestamp;
    // skip events older than 14 days since they are irrelevant too old
    if (ts < fourteenDaysAgoStr) continue;

    if (ts >= sevenDaysAgoStr) {
      last7dModerations++;
      if (row.guild_id) last7dGuilds.add(row.guild_id);
    }

    // skip todays events for daily stats since the day isnt over yet
    if (ts >= todayStartStr) continue;

    const date = ts.slice(0, "YYYY-MM-DD".length);

    let day = dailyMap.get(date);
    if (!day) {
      day = { moderations: 0, guilds: new Set() };
      dailyMap.set(date, day);
    }

    day.moderations++;
    if (row.guild_id) day.guilds.add(row.guild_id);
  }

  return {
    guilds: meta.guilds,
    moderations: meta.moderations,
    last7dModerations,
    last7dEngagedGuilds: last7dGuilds.size,
    dailyStats: Array.from(dailyMap.entries())
      .map(([date, v]) => ({
        date,
        moderations: v.moderations,
        engagedGuilds: v.guilds.size,
      })),
  };
}
