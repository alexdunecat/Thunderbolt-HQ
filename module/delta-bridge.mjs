/* Правка актёра несвязанного токена (все NPC на сцене) приходит в Foundry как updateActorDelta.
   Чтобы проверки системы (сторона, Doom, сваливание, эскадрильи) работали и для таких токенов, мост
   повторяет её как updateActor с актёром токена, если Foundry сама не прислала updateActor на то же изменение. */
const seen = new Set();
const keyOf = (actor, change) => `${actor?.uuid}|${JSON.stringify(change?.system ?? {})}|${JSON.stringify(change?.prototypeToken ?? {})}`;

Hooks.on("updateActor", (actor, change) => {
  const k = keyOf(actor, change);
  seen.add(k);
  setTimeout(() => seen.delete(k), 1000);
});

Hooks.on("updateActorDelta", (delta, change, options, userId) => {
  const actor = delta.parent?.actor;
  if (!actor || !change?.system) return;
  const k = keyOf(actor, change);
  setTimeout(() => {
    if (seen.has(k)) return;
    Hooks.callAll("updateActor", actor, change, { ...options, tbBridged: true }, userId);
  }, 0);
});
