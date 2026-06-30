import { PermissionFlagsBits } from "discord-api-types/v10";

export function getDiscordDate(discordId: string | bigint): Date {
    const idBigInt = BigInt(discordId);
    const discordEpochOffset = idBigInt >> 22n;
    const unixTimestampMs = discordEpochOffset + 1420070400000n;
    return new Date(Number(unixTimestampMs));
}

export function hasPermission(permissions: bigint, permissionBit: bigint) {
    return (permissions & permissionBit) === permissionBit
        || (permissions & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator;
}

export function slowflakeToBase64(slowflake: string | bigint): string {
    const slowflakeBigInt = BigInt(slowflake);
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setBigUint64(0, slowflakeBigInt, false);
    const uint8Array = new Uint8Array(buffer);
    return btoa(String.fromCharCode(...uint8Array)).replace(/=+$/, '');
}

export function base64ToSlowflake(base64: string): bigint {
    const binaryString = atob(base64);
    const uint8Array = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        uint8Array[i] = binaryString.charCodeAt(i);
    }
    return new DataView(uint8Array.buffer).getBigUint64(0, false);
}
