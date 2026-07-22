
<h1 align="center">
  <a href="https://discord.com/discovery/applications/1450060292716494940" target="_blank">
    <img src="https://honeypot.riskymh.dev/honeypot.png" alt="Emoji de honeypot" width="84">
  </a>
  <br>
  Bot de Discord Honeypot
</h1>

> Un bot de Discord que detecta y elimina automáticamente bots de spam al vigilar un canal dedicado `#honeypot`.

## Uso

1. [**Invita el bot**](https://discord.com/oauth2/authorize?client_id=1450060292716494940) a tu servidor con los permisos adecuados (Banear miembros, Gestionar canales, etc.).
2. Al unirse, el bot creará un canal `#honeypot`, o puedes configurarlo con `/honeypot`.
3. Configura el canal de registros, la acción (softban, baneo o silencio) y, si lo deseas, los roles exentos con el comando `/honeypot`.
4. Asegúrate de que el rol más alto del bot esté por encima de cualquier rol autoasignable (de color o de mención).
5. Cualquier usuario que escriba en el canal honeypot será baneado, silenciado o expulsado, y la acción quedará registrada.
> [**ⓘ**](https://honeypot.riskymh.dev/docs/setup-guide) **Nota:** El softban es la opción predeterminada (banea y desbanea) para que Discord borre los mensajes recientes. El silencio aplica 24 h sin expulsar del servidor.

<details>
<summary><strong>Información adicional</strong></summary>
  
### ¿Por qué usar un bot honeypot?

Los spammers y las cuentas comprometidas suelen atacar todos los canales a la vez, sobre todo desde cuentas que ya están dentro del servidor. Este bot facilita detectar y retirar esas cuentas de forma automática. Cuando alguien escribe en el canal honeypot, el bot actúa de inmediato: lo retira y borra sus mensajes antes de que el spam se propague. Así ahorras tiempo a los moderadores, reduces la exposición de la comunidad al spam y mantienes el servidor en buen estado.

> *«El bot que no debería existir»* — alguien, probablemente

### Experimentos

Opciones que puedes activar para dificultar aún más a los bots [**ⓘ**](https://honeypot.riskymh.dev/docs/configuration#experiments)

1. 💡 **Reenviar mensaje:** Envía el mensaje incriminatorio al canal de registros.
2. **Reinvitar:** Incluye en el mensaje directo un enlace para volver a unirse.
3. **Sin mensaje de aviso:** No incluye un mensaje de advertencia en el canal `#honeypot`.
4. **Sin MD:** No envía un mensaje directo al usuario que activó el honeypot.
5. **Mantener canal activo:** Mantiene activo el canal honeypot (cada día).
6. **Nombre aleatorio de canal:** Aleatoriza el nombre del canal honeypot (cada día).
7. **Nombre aleatorio de canal (caos):** Aleatoriza el nombre del canal honeypot con caracteres aleatorios (cada día).
8. ⚙️ **Recrear canal:** Vuelve a crear el canal honeypot (cada día).
9. **Aplicar silencio primero:** Antes de banear o expulsar, silencia al usuario durante 1 h (persiste si vuelve a unirse).
10. 💡 **Solo borrado reciente:** En lugar de borrar la última hora, solo borra los últimos 15 minutos.
11. 💡 **Varios honeypots:** Crea varios canales honeypot para aumentar las posibilidades de detección.
12. ⚙️ **Asegurar borrado de mensajes:** Busca y borra mensajes residuales de usuarios moderados 2 minutos después de la moderación.

<sub>

**Leyenda:** 💡 funciones recomendadas · ⚙️ avanzadas; úsalas solo si detectas problemas (puede hacer falta ver 1 o más baneos)

</sub>

### Extras de configuración

- **Roles exentos** — los miembros con estos roles no activan el honeypot (útil para el personal sin necesidad de ser administrador).
- **Acciones** — softban (predeterminado), baneo, silencio (24 h) o desactivado.

### Próximas funciones sugeridas

1. **Purga ampliada de residuos** — limpieza entre canales tras una detección (amplía «asegurar borrado de mensajes»).
2. **Lista compartida opcional** — sincronización voluntaria de identificadores de usuarios ya detectados (sensible en materia de privacidad).

### Consejos para maximizar la eficacia del bot honeypot

[**ⓘ**](https://honeypot.riskymh.dev/docs/tips) Para mejores resultados, coloca el canal *#honeypot* cerca del inicio de la lista de canales del servidor: los bots de spam recientes suelen atacar los primeros canales disponibles. Valora renombrar el *canal trampa* a algo menos previsible, como *#pls-dont-chat-here*, para eludir bots automatizados que excluyen el nombre *«honeypot»*. Asegúrate siempre de que el rol del bot esté por encima de los roles habituales de miembro; así tendrá autoridad para retirar cuentas problemáticas. Explora las funciones experimentales para reforzar la defensa frente a tácticas nuevas y disfruta de una comunidad más limpia y segura: ¡adiós a los bots indeseados! 🎉

</details>

[Más información...](https://honeypot.riskymh.dev/docs)

## Primeros pasos (desarrollo)

- [Bun](https://bun.sh/) (v1.3+)
- Token del bot de Discord (variable de entorno `DISCORD_TOKEN`)

```bash
$ bun install
$ bun start # o `bun dev`
```

## Ejecutar el bot por tu cuenta

* [Plantilla de Railway](https://railway.com/deploy/honeypot?referralCode=risky&utm_medium=integration&utm_source=template&utm_campaign=generic)
* `bun run start`
* `docker compose up -d` (imagen `ghcr.io/riskymh/honeypot`)

O bien usa la versión alojada invitándolo a tu servidor: [enlace de invitación](https://discord.com/oauth2/authorize?client_id=1450060292716494940)


<sub>

---
© [RiskyMH](https://riskymh.dev) 2026

</sub>
