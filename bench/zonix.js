// Hello-world JSON server. Same route, same payload, in all three benchmarks.
import zonix from "../dist/index.js";

const app = zonix({ dev: false });

app.get("/", (req, res) => {
  res.json({ hello: "world" });
});

app.listen(Number(process.env.PORT ?? 3001), () => {
  process.send?.("ready");
});
