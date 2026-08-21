const fs = require('fs');
const p = 'bench/.probe.tmp';
fs.writeFileSync(p, Buffer.alloc(1024, 65));
const buf = Buffer.alloc(1024);
let opens = 0, t0 = Date.now();
while (Date.now() - t0 < 1000) {
  const fd = fs.openSync(p, 'r');
  fs.readSync(fd, buf, 0, 1024, 0);
  fs.closeSync(fd);
  opens++;
}
const fd = fs.openSync(p, 'r');
let reads = 0; t0 = Date.now();
while (Date.now() - t0 < 1000) { fs.readSync(fd, buf, 0, 1024, 0); reads++; }
fs.closeSync(fd); fs.unlinkSync(p);
console.log('opens/sec :', opens);
console.log('fd-reads/s:', reads);
console.log('ratio     :', (reads / opens).toFixed(1) + 'x');
console.log(opens >= 50000
  ? 'REGIME CLEAN - exclusion landed, W1 unfrozen'
  : 'STILL DEGRADED - exclusion not effective yet');
