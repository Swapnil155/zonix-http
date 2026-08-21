// T-1 baseline: zonix on node:http — the built dist, so the ratio answers the
// question a zonix user would ask: what does the turbo transport buy me?
const { default: zonix } = await import(process.env.ZONIX_ENTRY ?? "../../../../dist/index.js");

const app = zonix({ dev: false });

app.get("/", (req, res) => {
  res.json({ hello: "world" });
});

app.get("/echo", (req, res) => {
  setImmediate(() => res.json({ path: req.url }));
});

app.listen(Number(process.env.PORT || 3112), () => console.log("READY"));
