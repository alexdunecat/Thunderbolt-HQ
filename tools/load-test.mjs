// Загрузка системы с заглушками Foundry: ловит ошибки импорта и init до выпуска. Запуск: node tools/load-test.mjs
const F = class { constructor(...a) { this.a = a; } };
const hooks = {};
const mk = name => class { static get defaultOptions() { return { classes: ["sheet"] }; } };
Object.assign(globalThis, {
  foundry: { data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } },
    abstract: { TypeDataModel: class {} }, utils: { mergeObject: (a, b) => ({ ...a, ...b }), hasProperty: () => false, getProperty: () => 0, deepClone: x => structuredClone(x) } },
  Actor: class {}, Item: class {}, Combat: class {}, ActorSheet: mk(), ItemSheet: mk(), JournalSheet: mk(), Dialog: class {}, JournalEntry: class {},
  Hooks: { once: (n, f) => (hooks[n] ??= []).push(f), on: (n, f) => (hooks[n] ??= []).push(f) },
  CONFIG: { Actor: { dataModels: {} }, Item: { dataModels: {} }, Combat: {} },
  Actors: { unregisterSheet() {}, registerSheet(s, c, o) { console.log("sheet", s, c.name, o.label); } },
  Items: { unregisterSheet() {}, registerSheet(s, c, o) { console.log("sheet", s, c.name, o.label); } },
  DocumentSheetConfig: { registerSheet(d, s, c, o) { console.log("sheet", s, c.name, o.label); } },
  game: { settings: { register() {}, get: () => "shtab" }, i18n: { localize: x => x } },
  CONST: { TOKEN_DISPOSITIONS: {}, GRID_TYPES: {}, DRAWING_FILL_TYPES: {}, TOKEN_DISPLAY_MODES: {} },
  document: { body: { dataset: {} } }, ui: { windows: {} }
});
const root = new URL("..", import.meta.url).pathname;
await import(root + "module/thunderbolt.mjs");
for (const f of hooks.init ?? []) f();
console.log("init ok; dataModels:", Object.keys(CONFIG.Actor.dataModels), Object.keys(CONFIG.Item.dataModels), "hooks:", Object.keys(hooks).join(","));
