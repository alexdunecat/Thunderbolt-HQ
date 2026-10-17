// Гражданское радио: разбор ссылок YouTube, команды пульта и доступ по триггеру «Внешний мир».
const root = process.argv[2];
globalThis.Application = class {};
globalThis.Hooks = { on() {}, once() {} };
globalThis.foundry = { utils: { mergeObject: Object.assign, deepClone: o => JSON.parse(JSON.stringify(o)) } };
const pilot = (key, owner) => ({ type: "pilot", items: [{ type: "trigger", system: { key } }], testUserPermission: u => u.id === owner });
const actors = [pilot("outside", "p1"), pilot("ace", "p2")];
globalThis.game = { actors: { filter: f => actors.filter(f) } };
const R = await import(`${root}/module/civil-radio.mjs`);

for (const s of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42", "youtu.be/dQw4w9WgXcQ?si=x", "https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123abc",
  "https://www.youtube.com/playlist?list=PLxyz_9", "https://youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ", "https://vimeo.com/123", "привет"])
  console.log(s, "→", JSON.stringify(R.parseYouTube(s)));

let s = { rev: 0, queue: [], cur: -1, li: 0, playing: false, t0: 0, pos: 0 };
const show = (label, st, t) => console.log(label.padEnd(10), `cur=${st.cur} li=${st.li} ${st.playing ? "играет" : "стоит"} pos=${R.expectedPos(st, t).toFixed(1)}`, st.queue.map(e => e.id).join(","));
const a = { id: "a", v: "aaaaaaaaaaa" }, b = { id: "b", v: "bbbbbbbbbbb" }, l = { id: "l", list: "PL1", v: null };
s = R.applyCommand(s, { op: "add", entry: a }, 1000); show("add a", s, 1000);
s = R.applyCommand(s, { op: "add", entry: b }, 2000); show("add b", s, 31000);
s = R.applyCommand(s, { op: "pause" }, 31000); show("pause", s, 90000);
s = R.applyCommand(s, { op: "play" }, 90000); show("play", s, 100000);
s = R.applyCommand(s, { op: "add", entry: l, now: true }, 101000); show("add l now", s, 101000);
s = R.applyCommand(s, { op: "next" }, 102000, { length: 3, index: 0 }); show("next в pl", s, 103000);
s = R.applyCommand(s, { op: "listIndex" }, 104000, { index: 2, time: 1.5 }); show("pl сам", s, 104000);
s = R.applyCommand(s, { op: "next" }, 105000, { length: 3, index: 2 }); show("next конец", s, 105000);
s = R.applyCommand(s, { op: "jump", id: "b" }, 106000); show("jump b", s, 116000);
s = R.applyCommand(s, { op: "prev" }, 116000); show("prev >5с", s, 116000);
s = R.applyCommand(s, { op: "remove", id: "a" }, 117000); show("remove a", s, 117000);
s = R.applyCommand(s, { op: "remove", id: "b" }, 118000); show("remove b", s, 118000);
s = R.applyCommand(s, { op: "clear" }, 119000); show("clear", s, 119000);
s = R.applyCommand(s, { op: "next" }, 120000); show("next пусто", s, 120000);

console.log("доступ:", ["gm", "p1", "p2"].map(id => `${id}=${R.canControl({ id, isGM: id === "gm" })}`).join(" "));
